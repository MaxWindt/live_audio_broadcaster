var getChannelsId = setInterval(function () {
  console.log("get_channels");
  let val = { Key: "get_channels" };
  wsSend(val);
}, 1000);

// Module-level: survive across initializeSubscriber() reinvocations on WS reconnect
var _visibilityHandler = null;
var _stopConnectionLoss = null;
var _loadingTimer = null;
var _reloadPillTimer = null;
var _currentChannelName = null;
var _liveEdgeInterval = null;
// Stable mode's self-healing buffer: how much headroom (seconds) the
// live-edge catch-up keeps ahead of playback. Starts lean; each stall
// ratchets it up (see onStableStall) so a shaky connection settles at
// whatever latency it actually needs instead of reloading repeatedly.
var _stableTargetMargin = 1.5;

// "Stable mode": opt-in HTTP fallback (see settings panel). Plays a plain
// <audio src> MP3 stream instead of WebRTC - higher latency, but mobile OSes
// treat it as real background audio, so it's less likely to die when the
// screen turns off. Read once per load; toggling it triggers a page reload.
var _stableMode = localStorage.getItem("lab_stable_mode") === "1";

// --- Keepalive tone (WebRTC mode only) ---
// The browser doesn't treat an <audio srcObject=MediaStream> the way it
// treats plain progressive playback, so a WebRTC tab can lose audio focus
// and get suspended in the background even though audio is genuinely
// playing. Chrome's silence detector inspects the raw digital signal
// (threshold ~-72dBFS), not what the speaker can reproduce, so a real but
// inaudible tone keeps the tab marked "audible" without adding any latency
// to the actual voice. 20Hz is below what phone speakers/earbuds can
// reproduce at all; -37dBFS clears the silence threshold with margin.
// Ultrasonic is deliberately avoided - it's audible as a whine to many
// listeners/headphones and gets *more* audible on real hardware, not less.
var _keepaliveUrl = null;

function keepaliveUrl() {
  if (_keepaliveUrl) return _keepaliveUrl;

  // 8kHz/mono is plenty for a 20Hz tone and keeps this small (160KB vs
  // 2.9MB at 48kHz). 10s = exactly 200 cycles (8000/20), so the loop wraps
  // sample-accurately with no click - and clears Chrome's ~5s "transient
  // audio" cutoff, below which it ducks rather than holding audio focus.
  const rate = 8000, seconds = 10, hz = 20, amp = 0.02;
  const samples = rate * seconds;
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const ascii = function (off, s) {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);        // fmt chunk size
  view.setUint16(20, 1, true);         // PCM
  view.setUint16(22, 1, true);         // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);  // byte rate
  view.setUint16(32, 2, true);         // block align
  view.setUint16(34, 16, true);        // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);

  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * amp * 32767), true);
  }

  _keepaliveUrl = URL.createObjectURL(new Blob([view.buffer], { type: "audio/wav" }));
  return _keepaliveUrl;
}

function startKeepalive() {
  // Stable mode already plays a real <audio src> - it IS what this imitates.
  if (_stableMode) return;

  const ka = document.getElementById("keepalive");
  if (!ka || !ka.paused) return; // idempotent
  if (!ka.src) ka.src = keepaliveUrl();
  ka.play().catch(function () {
    // No user activation yet (auto-connect path) - retry on the first tap.
    document.addEventListener("click", startKeepalive, { once: true });
  });
}

function stopKeepalive() {
  const ka = document.getElementById("keepalive");
  if (ka) ka.pause();
}

// Material Icons render their glyph as literal ligature text (e.g. "language"),
// which leaks into textContent. Strip .material-icons children before reading
// a channel button's visible label so that text doesn't end up in the UI.
function getChannelLabel(buttonElement) {
  const clone = buttonElement.cloneNode(true);
  clone.querySelectorAll(".material-icons").forEach((el) => el.remove());
  return clone.textContent.trim();
}

// --- Media Session (lock screen "Now Playing" + tells mobile OS this tab is an active audio player) ---
function setupMediaSession(audio) {
  if (!("mediaSession" in navigator)) return;

  // Absolute path required - a relative "favicon.ico" resolves against the
  // current page URL and can 404, which silently drops the whole metadata
  // registration on some Android Chrome builds.
  navigator.mediaSession.metadata = new MediaMetadata({
    title: _currentChannelName || "Live Audio Stream",
    artist: "Babelcast",
    artwork: [{ src: "/favicon.ico", sizes: "32x32", type: "image/x-icon" }],
  });

  navigator.mediaSession.setActionHandler("play", function () {
    audio.play().catch(() => {});
  });
  navigator.mediaSession.setActionHandler("pause", function () {
    audio.pause();
  });

  // This is a live stream - no seeking or track navigation, hide those controls
  ["seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"].forEach(
    function (action) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch (e) {
        // Action not supported by this browser, ignore
      }
    }
  );
}

function initializeSubscriber() {
  // --- Wake Lock (prevents Android from stopping audio via energy saving) ---
  var wakeLock = null;

  async function requestWakeLock() {
    if ("wakeLock" in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        // Track system-initiated releases (battery saver, lock screen) so re-acquire works
        wakeLock.addEventListener("release", function () {
          wakeLock = null;
        });
      } catch (err) {
        console.log("Wake lock error:", err.message);
      }
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().then(() => { wakeLock = null; });
    }
  }

  // Remove previous handler before re-registering (prevents listener accumulation on WS reconnect)
  if (_visibilityHandler) {
    document.removeEventListener("visibilitychange", _visibilityHandler);
  }
  _visibilityHandler = function () {
    if (document.visibilityState === "visible") {
      // Re-acquire lock (system releases it on screen-off / battery saver)
      if (wakeLock === null) {
        const audio = document.getElementById("audio");
        if (audio && !audio.paused) requestWakeLock();
      }
      // Kick the audio pipeline after the tab returns to foreground
      const audio = document.getElementById("audio");
      if (audio && !audio.paused) audio.play().catch(() => {});
    }
  };
  document.addEventListener("visibilitychange", _visibilityHandler);

  // --- Loading timeout (auto-reload if spinner stays visible too long) ---
  // NOTE: _loadingTimer / _reloadPillTimer are module-level so they survive
  // ws.onclose → initializeSubscriber() reinvocations and can always be canceled.

  function showReloadPill() {
    document.getElementById("reload-pill").classList.remove("hidden");
  }

  function hideReloadPill() {
    document.getElementById("reload-pill").classList.add("hidden");
  }

  function startLoadingTimeout() {
    clearLoadingTimeout();
    _reloadPillTimer = setTimeout(showReloadPill, 3000);
    _loadingTimer = setTimeout(function () {
      console.log("Loading timeout reached, reloading...");
      window.location.reload();
    }, 4000);
  }

  function clearLoadingTimeout() {
    if (_loadingTimer) {
      clearTimeout(_loadingTimer);
      _loadingTimer = null;
    }
    if (_reloadPillTimer) {
      clearTimeout(_reloadPillTimer);
      _reloadPillTimer = null;
    }
    hideReloadPill();
  }

  function updateChannels(channels) {
    let channelsEle = document.querySelector("#channels div");
    channelsEle.innerHTML = "";

    if (channels.length > 0) {
      clearInterval(getChannelsId);
      document.getElementById("nochannels").classList.add("hidden");
      // Helper function to assign a rank to each channel
      function getChannelRank(channel) {
        if (/live|original/i.test(channel)) return 1;
        if (/translation|uebersetzung/i.test(channel)) return 2;
        if (/english|englisch/i.test(channel)) return 3;
        return 4;
      }
      // Sort channels by rank
      channels.sort((a, b) => {
        const rankA = getChannelRank(a);
        const rankB = getChannelRank(b);
        return rankA - rankB;
      });

      channels.forEach((channel) => {
        let channelButton = document.createElement("a");
        channelButton.classList.add(
          "button",
          "mdl-button",
          "mdl-button--raised",
          "mdl-js-button",
          "mdl-js-ripple-effect"
        );
        channelButton.id = channel;

        // Set the innerHTML and icon based on the channel name
        if (/live|original/i.test(channel)) {
          channelButton.innerHTML =
            '<i class="material-icons">record_voice_over</i> <i id=btn_original>Original</i>';
        } else if (/translation|uebersetzung/i.test(channel)) {
          channelButton.innerHTML =
            '<i class="material-icons">translate</i> <i id=btn_translation>Translation</i>';
        } else {
          channelButton.innerHTML =
            '<i class="material-icons">language</i> ' + channel;
        }

        // Add event listener
        channelButton.addEventListener("click", function () {
          channelClick(this);
        });

        // Append the button to the channel list
        channelsEle.appendChild(channelButton);
      });
    }

    translate_text();
  }

  function channelClick(buttonElement) {
    if (buttonElement.classList.contains("playing")) {
      const audio = document.getElementById("audio");
      if (audio) {
        if (audio.paused) {
          audio.play();
        } else {
          audio.pause();
        }
      }
    } else {
      document.getElementById("play").classList.add("hidden");
      document.getElementById("spinner").classList.remove("hidden");
      startLoadingTimeout();

      // Remove 'playing' class from all channels
      document.querySelectorAll(".playing").forEach((el) => {
        el.classList.remove("playing");
      });

      // Add 'playing' class to this channel
      buttonElement.classList.add("playing");

      // Store display name for Media Session metadata (lock screen title)
      _currentChannelName = getChannelLabel(buttonElement) || buttonElement.id;

      // Connect to the selected channel
      let params = {};
      params.Channel = buttonElement.id;

      // Store the channel selection
      localStorage.setItem("lab_channel", params.Channel);

      // Start before the WebRTC audio element exists - if a platform (iOS)
      // only allows one playing element at a time, the one started first
      // loses, which should be the keepalive, never the actual voice.
      startKeepalive();

      if (_stableMode) {
        // No WebRTC session needed - just point <audio> at the HTTP stream.
        connectStable(params.Channel);
      } else {
        // Clean up existing connections properly, this will start a new connection
        triggerNewConnection();
      }
    }
  }

  function triggerNewConnection() {
    // Close any existing audio tracks
    const audio = document.getElementById("audio");
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
    closeWS();
  }

  function closeWS() {
    if (ws) {
      ws.close();
    }
  }

  function hardReload() {
    // Close the existing connections
    closeWS();
    window.location.reload(true);
  }

  // Reveals the channel picker and auto-connects to the previously selected
  // channel, if any. In normal mode this runs once the WebRTC preamble is
  // confirmed ("session_received"); in Stable mode there's no such preamble,
  // so it runs as soon as the WS is ready instead.
  function revealChannelsAndAutoConnect() {
    document.getElementById("channels").classList.remove("hidden");
    document.getElementById("block_buttons_layer").classList.add("hidden");
    document.getElementById("spinner").classList.add("hidden");
    clearLoadingTimeout();
    if (localStorage.getItem("lab_channel")) {
      var params = {
        Channel: localStorage.getItem("lab_channel"),
      };
      // Wait for the channel element to be available before adding the class and connecting
      var waitForElement = setInterval(() => {
        const channelElement = document.getElementById(params.Channel);
        if (channelElement) {
          channelElement.classList.add("playing");
          _currentChannelName = getChannelLabel(channelElement) || channelElement.id;
          document.getElementById("spinner").classList.remove("hidden");
          startLoadingTimeout();
          startKeepalive();
          if (_stableMode) {
            connectStable(params.Channel);
          } else {
            wsSend({
              Key: "connect_subscriber",
              Value: params,
            });
          }
          clearInterval(waitForElement);
        }
      }, 100);
      // Stop waiting after 5s if the channel button never appears
      setTimeout(() => clearInterval(waitForElement), 5000);
    }
  }

  ws.onmessage = function (e) {
    let wsMsg = JSON.parse(e.data);
    if ("Key" in wsMsg) {
      switch (wsMsg.Key) {
        case "info":
          debug("server info: " + wsMsg.Value);
          break;
        case "error":
          error("server error:", wsMsg.Value);
          document.getElementById("channels").classList.add("hidden");
          localStorage.removeItem("lab_channel");
          hardReload();
          break;
        case "sd_answer":
          startSession(wsMsg.Value);
          break;
        case "channels":
          updateChannels(wsMsg.Value);
          break;
        case "session_received": // Wait for confirmation from server
          revealChannelsAndAutoConnect();
          break;
        case "ice_candidate":
          pc.addIceCandidate(wsMsg.Value);
          break;
        case "channel_closed":
          error("channel '" + wsMsg.Value + "' closed by server");
          break;
      }
    }
  };

  ws.onclose = function () {
    console.log("websocket connection closed, restarting...");
    if (_stopConnectionLoss) { _stopConnectionLoss(); _stopConnectionLoss = null; }
    pc.close();
    document.getElementById("media").classList.add("hidden");
    clearInterval(getChannelsId);
    initializeCommon();
    initializeSubscriber();
  };

  // Creates a fresh <audio> element wired up with the same handlers
  // (play/pause button, wake lock, media session, stall detection) used by
  // both the WebRTC path (srcObject) and Stable mode (plain src URL).
  function createAudioElement() {
    const mediaContainer = document.getElementById("media");

    if (mediaContainer.innerHTML.trim() !== "") {
      mediaContainer.innerHTML = "";
    }

    let audio = document.createElement("audio");
    audio.id = "audio";
    audio.autoplay = true;
    audio.playsInline = true;
    mediaContainer.appendChild(audio);

    setupAudioHandlers(audio);
    setupMediaSession(audio);

    mediaContainer.classList.remove("hidden");
    document.getElementById("play").classList.remove("hidden");
    clearLoadingTimeout();

    return audio;
  }

  // Stable mode: point a plain <audio> element at the server's HTTP fallback
  // stream for this channel instead of negotiating WebRTC.
  function connectStable(channelName) {
    debug("stable mode: connecting to " + channelName);
    _stableTargetMargin = 1.5;
    let audio = createAudioElement();
    audio.src = "stream/" + encodeURIComponent(channelName);

    // The browser buffers ahead of what it's actually playing for a live
    // HTTP stream (this is part of what makes it background-safe), which
    // otherwise means playback keeps falling further behind live the whole
    // session. Periodically skip forward to near the buffered edge so it
    // stays close to "now" instead of slowly draining that backlog. The
    // tolerated gap and catch-up target both track _stableTargetMargin, so
    // a connection that's been stalling gets more headroom, not less.
    if (_liveEdgeInterval) clearInterval(_liveEdgeInterval);
    _liveEdgeInterval = setInterval(function () {
      if (audio.paused || audio.buffered.length === 0) return;
      let liveEdge = audio.buffered.end(audio.buffered.length - 1);
      if (liveEdge - audio.currentTime > _stableTargetMargin + 2) {
        audio.currentTime = Math.max(0, liveEdge - _stableTargetMargin);
      }
    }, 2000);
    audio.addEventListener("emptied", function () {
      clearInterval(_liveEdgeInterval);
    });
  }

  // Called when Stable mode's audio stalls. Unlike the WebRTC path, a stall
  // here is normal network jitter, not a dead connection - reloading would
  // just discard the buffer and restart cold. Instead, widen the buffer
  // margin so future playback tolerates more jitter before it can stall
  // again, and only fall back to reloading if it stays stuck much longer
  // (a real dead stream, not a blip).
  function onStableStall() {
    clearLoadingTimeout();
    _stableTargetMargin = Math.min(_stableTargetMargin + 0.5, 20);
    console.log("stable mode: stall detected, widening buffer target to " + _stableTargetMargin + "s");
    _reloadPillTimer = setTimeout(showReloadPill, 15000);
    _loadingTimer = setTimeout(function () {
      console.log("stable mode: stalled too long, reloading...");
      window.location.reload();
    }, 30000);
  }

  //
  // -------- WebRTC ------------
  //

  pc.ontrack = function (event) {
    debug("webrtc: ontrack");
    let audio = createAudioElement();
    audio.srcObject = event.streams[0];
  };

  function setupAudioHandlers(audio) {
    const playButton = document.getElementById("play");

    // Use onclick to replace any previous handler (prevents stacking on each ontrack event)
    playButton.onclick = function () {
      if (audio) {
        if (audio.paused) {
          audio.play().catch(() => {});
        } else {
          audio.pause();
        }
      }
    };

    // Stable mode: has playback gotten going at least once? Initial startup
    // buffering looks identical to a stall (currentTime stuck at 0,
    // onwaiting firing) but isn't one - only treat it as a real stall once
    // we've actually played smoothly before, so the buffer margin doesn't
    // get inflated before anything has actually gone wrong.
    var hasStartedPlaying = false;

    // currentTime-based stall detection: catches Android freezes that don't fire onwaiting
    var lastCurrentTime = null;
    var stallCheckInterval = setInterval(function () {
      if (!audio.paused && !audio.ended) {
        if (lastCurrentTime !== null && audio.currentTime === lastCurrentTime) {
          if (_stableMode) {
            if (hasStartedPlaying) onStableStall();
          } else {
            console.log("Audio stalled (currentTime frozen), reloading...");
            clearInterval(stallCheckInterval);
            window.location.reload();
            return;
          }
        }
        lastCurrentTime = audio.currentTime;
      } else {
        lastCurrentTime = null;
      }
    }, 3000);
    audio.addEventListener("emptied", function () { clearInterval(stallCheckInterval); });

    let pauseTimer = null;

    // Clear pause timer helper function
    function clearPauseTimer() {
      if (pauseTimer) {
        clearTimeout(pauseTimer);
        pauseTimer = null;
      }
    }

    // Function to handle long pause
    function handleLongPause() {
      // playButton.innerHTML = '<span class="material-icons">refresh</span>';
      playButton.onclick = function () {
        window.location.reload();
      };
    }

    // Audio state handlers
    audio.onended = function () {
      console.log("stream ended");
      releaseWakeLock();
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
      playButton.onclick = function () {
        window.location.reload();
      };
    };

    // Stop any previous loop before starting a new one (prevents accumulation on reconnect)
    if (_stopConnectionLoss) { _stopConnectionLoss(); }
    _stopConnectionLoss = detectConnectionLoss(() => {
      console.log("Connection lost!");
      playButton.innerHTML = '<span class="material-icons">refresh</span>';
      playButton.onclick = function () {
        window.location.reload();
      };
    });

    audio.onwaiting = function () {
      console.log("waiting for audio data");
      if (!audio.paused) {
        document.getElementById("spinner").classList.remove("hidden");
        if (_stableMode) {
          if (hasStartedPlaying) onStableStall();
        } else {
          startLoadingTimeout();
        }
      }
    };

    audio.oncanplaythrough = function () {
      hasStartedPlaying = true;
      document.getElementById("spinner").classList.add("hidden");
      clearLoadingTimeout();
    };

    audio.onerror = function () {
      console.log("error loading audio data");
      playButton.innerHTML = "error";
    };

    // Play/Pause button handlers
    audio.onplay = function () {
      playButton.innerHTML = '<i class="material-icons">pause</i>';
      clearPauseTimer(); // Clear timer when playing
      clearLoadingTimeout();
      requestWakeLock();
      startKeepalive();
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    };

    audio.onpause = function () {
      playButton.innerHTML = '<i class="material-icons">play_arrow</i>';
      document.getElementById("spinner").classList.add("hidden");
      // Start timer when paused
      clearPauseTimer(); // Clear any existing timer
      pauseTimer = setTimeout(handleLongPause, 60000); // 1 minute
      releaseWakeLock();
      stopKeepalive();
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    };

    // Set initial button state
    playButton.innerHTML = '<i class="material-icons">play_arrow</i>';
  }

  // Start loading timeout — covers both initial page load and WS reconnect.
  // The spinner is visible at this point; if we never reach pc.ontrack the pill/reload fires.
  startLoadingTimeout();

  if (!_stableMode) {
    pc.addTransceiver("audio");

    let f = () => {
      debug("webrtc: create offer");
      pc.createOffer()
        .then((d) => {
          debug("webrtc: set local description");
          pc.setLocalDescription(d);
          let val = { Key: "session_subscriber", Value: d };
          wsSend(val);
        })
        .catch(debug);
    };

    // Create offer if WS is ready, otherwise queue
    ws.readyState == WebSocket.OPEN ? f() : onWSReady.push(f);
  } else {
    // Stable mode has no WebRTC preamble to wait for - reveal the channel
    // picker (and auto-connect) as soon as the WS is up.
    ws.readyState == WebSocket.OPEN
      ? revealChannelsAndAutoConnect()
      : onWSReady.push(revealChannelsAndAutoConnect);
  }
}

// Call the initialization function
initializeSubscriber();
