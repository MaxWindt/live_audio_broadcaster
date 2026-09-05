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
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// stableStreamHandler serves a channel's "Stable mode" audio as a plain HTTP
// MP3 stream (GET /stream/{channel}), so mobile browsers treat it as real,
// background-safe audio the way they would an internet radio stream - unlike
// the low-latency WebRTC path. Higher latency by design; opt-in only.
func stableStreamHandler(w http.ResponseWriter, r *http.Request) {
	channelName := strings.TrimPrefix(r.URL.Path, "/stream/")
	if channelName == "" {
		http.NotFound(w, r)
		return
	}

	channel := reg.GetChannel(channelName)
	if channel == nil {
		http.Error(w, "channel not found", http.StatusNotFound)
		return
	}

	listenerID := uuid.NewString()
	ch, err := channel.Stable.Join(listenerID, channel.LocalTrack.Codec())
	if err != nil {
		slog.Error("stable mode unavailable", "channel", channelName, "err", err)
		http.Error(w, "stable mode unavailable", http.StatusServiceUnavailable)
		return
	}
	defer channel.Stable.Leave(listenerID)

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	// The server's WriteTimeout (main.go) would otherwise cut this
	// long-lived response off after httpTimeout; this stream has no
	// natural end while the listener is connected.
	if rc := http.NewResponseController(w); rc != nil {
		_ = rc.SetWriteDeadline(time.Time{})
	}

	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	for {
		select {
		case chunk, ok := <-ch:
			if !ok {
				return
			}
			if _, err := w.Write(chunk); err != nil {
				return
			}
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
