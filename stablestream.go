/*
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package main

import (
	"bufio"
	"errors"
	"io"
	"log/slog"
	"os/exec"
	"sync"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media/oggwriter"
)

// stableStreamBitrate is the MP3 bitrate used for "Stable mode": the opt-in,
// higher-latency HTTP fallback that plays as a plain <audio src> stream so
// mobile OSes treat it as real background audio (unlike the low-latency
// WebRTC path, which they don't). Voice-only, so a modest bitrate is plenty
// and keeps bandwidth roughly comparable to the WebRTC path.
const stableStreamBitrate = "64k"

// StableStream transcodes one channel's live Opus audio to MP3 via a single
// shared ffmpeg process and fans the encoded bytes out to any number of HTTP
// listeners, like an Icecast relay. Started lazily on the first listener,
// stopped once the last one leaves, so it costs nothing when unused.
type StableStream struct {
	mu        sync.Mutex
	ogg       *oggwriter.OggWriter
	stdin     io.WriteCloser
	cmd       *exec.Cmd
	listeners map[string]chan []byte
	running   bool
}

func NewStableStream() *StableStream {
	return &StableStream{listeners: make(map[string]chan []byte)}
}

// Join registers a new HTTP listener, starting ffmpeg if this is the first
// one. codec must describe the publisher's negotiated Opus codec.
func (s *StableStream) Join(id string, codec webrtc.RTPCodecCapability) (chan []byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		if err := s.start(codec); err != nil {
			return nil, err
		}
	}

	// Small and non-blocking on the send side (see pump): this bounds how
	// much stale audio can queue up behind a momentarily slow listener.
	ch := make(chan []byte, 8)
	s.listeners[id] = ch
	return ch, nil
}

// Leave removes a listener and stops ffmpeg once nobody is left listening.
func (s *StableStream) Leave(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ch, ok := s.listeners[id]; ok {
		delete(s.listeners, id)
		close(ch)
	}
	if len(s.listeners) == 0 {
		s.stop()
	}
}

// WriteRTP feeds one publisher RTP packet into the encoder, if running.
func (s *StableStream) WriteRTP(pkt *rtp.Packet) {
	s.mu.Lock()
	ogg := s.ogg
	s.mu.Unlock()
	if ogg == nil {
		return
	}
	if err := ogg.WriteRTP(pkt); err != nil {
		slog.Error("stablestream: oggwriter write error", "err", err)
	}
}

// Active reports whether ffmpeg is currently running, i.e. whether feeding
// it packets is worthwhile. Cheap enough to call per publisher RTP packet.
func (s *StableStream) Active() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

// start launches ffmpeg. Caller must hold s.mu.
func (s *StableStream) start(codec webrtc.RTPCodecCapability) error {
	if codec.MimeType != webrtc.MimeTypeOpus {
		return errors.New("stable mode requires an Opus publisher")
	}

	cmd := exec.Command("ffmpeg",
		"-loglevel", "error",
		// Skip ffmpeg's default (up to 5s) input analysis - the Ogg/Opus
		// header page declares everything ffmpeg needs, so this only
		// shortens the one-time startup delay when a channel's stream is
		// first spun up. Doesn't touch the (much larger, unavoidable)
		// client-side buffering a browser applies to a live HTTP stream.
		"-fflags", "nobuffer",
		"-flags", "low_delay",
		"-probesize", "4096",
		"-analyzeduration", "0",
		"-i", "pipe:0",
		"-vn",
		"-b:a", stableStreamBitrate,
		"-flush_packets", "1",
		"-f", "mp3",
		"pipe:1",
	)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	channels := codec.Channels
	if channels == 0 {
		channels = 2
	}
	clockRate := codec.ClockRate
	if clockRate == 0 {
		clockRate = 48000
	}
	ogg, err := oggwriter.NewWith(stdin, clockRate, channels)
	if err != nil {
		stdin.Close()
		_ = cmd.Process.Kill()
		return err
	}

	s.cmd = cmd
	s.stdin = stdin
	s.ogg = ogg
	s.running = true

	go s.pump(stdout)
	go func() {
		waitErr := cmd.Wait()

		s.mu.Lock()
		isCurrent := s.cmd == cmd
		s.mu.Unlock()
		if !isCurrent {
			// A newer generation (start() called again since) already
			// replaced this one - nothing to clean up here.
			return
		}

		if waitErr != nil {
			slog.Debug("stablestream: ffmpeg exited", "err", waitErr)
		}
		// ffmpeg died on its own (crashed, or was killed alongside us by
		// e.g. Ctrl+C hitting the whole process group). Without this,
		// Active() would keep reporting true and every subsequent
		// publisher RTP packet would fail to write and log an error.
		// Tear down cleanly and disconnect listeners instead.
		s.StopAll()
	}()

	return nil
}

// pump reads ffmpeg's MP3 output and fans it out to listeners, always
// favoring the freshest audio: if a listener's queue is full (it's fallen
// behind), its oldest queued chunk is dropped to make room rather than
// dropping the new one and leaving a growing backlog of stale audio queued
// ahead of it.
func (s *StableStream) pump(stdout io.ReadCloser) {
	r := bufio.NewReader(stdout)
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			s.mu.Lock()
			for _, ch := range s.listeners {
				select {
				case ch <- chunk:
				default:
					select {
					case <-ch:
					default:
					}
					select {
					case ch <- chunk:
					default:
					}
				}
			}
			s.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

// stop tears down ffmpeg. Caller must hold s.mu.
func (s *StableStream) stop() {
	if !s.running {
		return
	}
	if s.ogg != nil {
		s.ogg.Close()
	}
	if s.stdin != nil {
		s.stdin.Close()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	s.ogg = nil
	s.stdin = nil
	s.cmd = nil
	s.running = false
}

// StopAll force-disconnects every listener and stops ffmpeg. Used when the
// publisher disconnects, since there's no more audio to feed the encoder.
func (s *StableStream) StopAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, ch := range s.listeners {
		delete(s.listeners, id)
		close(ch)
	}
	s.stop()
}
