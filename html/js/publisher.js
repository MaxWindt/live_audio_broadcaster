var audioTrack;
var mediaRecorder;
var recordedChunks = [];
var silenceStart = null;
var recording = false;
var stopAfterMinutesSilence = 60;
var reconnectTimeout = null;
var connectionLostTime = null;
var channelName = "";
var channelPassword = "";
var wasRecording = false;
var micEnabled = true;
var autoStopEnabled = true; // Add this line
var audioInitialized = false;

// Add a debug function
var debug = function (...args) {
  console.log(...args);
};

// Initialize audio context and get media after user interaction
function initializeAudio() {
  return new Promise((resolve, reject) => {
    try {
      // Create AudioContext
      window.AudioContext = window.AudioContext || window.webkitAudioContext;
      window.audioContext = new AudioContext();

      // Get media
      navigator.mediaDevices
        .getUserMedia(constraints)
        .then((stream) => {
          audioTrack = stream.getAudioTracks()[0];
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));

          // Set initial mic state
          audioTrack.enabled = micEnabled;

          const soundMeter = new SoundMeter(window.audioContext);
          soundMeter.connectToSource(stream, function (e) {
            if (e) {
              alert(e);
              reject(e);
              return;
            }

            try {
              mediaRecorder = new MediaRecorder(stream);
              debug(
                "MediaRecorder initialized with mimeType:",
                mediaRecorder.mimeType
              );

              mediaRecorder.ondataavailable = handleDataAvailable;
              mediaRecorder.onstop = handleStop;
              mediaRecorder.onerror = (event) =>
                debug("MediaRecorder error:", event);

              debug("MediaRecorder event handlers set up");
            } catch (error) {
              debug("Error setting up MediaRecorder:", error);
              reject(error);
              return;
            }

            // make the meter value relative to a sliding max
            let max = 0.0;
            setInterval(() => {
              let val = soundMeter.instant.toFixed(2);
              if (val > max) {
                max = val;
              }
              if (max > 0) {
                val = val / max;
              }
              signalMeter.value = val;

              // Updated silence check logic
              if (val < 0.03 && recording && autoStopEnabled) {
                if (!silenceStart) {
                  silenceStart = Date.now();
                  debug("Silence detected, starting timer");
                } else if (
                  Date.now() - silenceStart >
                  stopAfterMinutesSilence * 60 * 1000
                ) {
                  debug(
                    "Silence threshold reached, stopping and restarting recording"
                  );
                  stopRecording();
                  startRecording();
                  silenceStart = null;
                }
              } else {
                if (silenceStart) {
                  debug("Silence ended");
                }
                silenceStart = null;
              }
            }, 50);

            resolve(stream);
          });
        })
        .catch((error) => {
          debug("getUserMedia error:", error);
          reject(error);
        });
    } catch (e) {
      alert("Web Audio API not supported.");
      reject(e);
    }
  });
}

// Add event listeners for the new controls
document.addEventListener("DOMContentLoaded", function () {
  const silenceMinutesInput = document.getElementById("silence-minutes");
  const autoStopEnabledCheckbox = document.getElementById("auto-stop-enabled");

  // Initialize controls with current values
  silenceMinutesInput.value = stopAfterMinutesSilence;
  autoStopEnabledCheckbox.checked = autoStopEnabled;

  // Add event listeners
  silenceMinutesInput.addEventListener("change", function () {
    const value = parseInt(this.value);
    if (value >= 1 && value <= 180) {
      stopAfterMinutesSilence = value;
      debug("Updated silence threshold to", value, "minutes");
    } else {
      this.value = stopAfterMinutesSilence;
      debug("Invalid silence threshold value");
    }
  });

  autoStopEnabledCheckbox.addEventListener("change", function () {
    autoStopEnabled = this.checked;
    silenceMinutesInput.disabled = !this.checked;
    debug("Auto-stop recording", autoStopEnabled ? "enabled" : "disabled");
  });

  // Restore settings if any
  restoreSettings();
});

document.getElementById("reload").addEventListener("click", function () {
  // Store current settings before reload
  const currentSettings = {
    channel: channelName,
    password: channelPassword,
    micEnabled: audioTrack ? audioTrack.enabled : false,
    wasRecording: recording,
    autoStopEnabled: autoStopEnabled,
    stopAfterMinutesSilence: stopAfterMinutesSilence,
  };

  // Store settings in localStorage for persistence
  localStorage.setItem("babelcast_settings", JSON.stringify(currentSettings));

  // Reload the page
  window.location.reload(false);
});

document.getElementById("microphone").addEventListener("click", function () {
  toggleMic();
});

document.getElementById("record").addEventListener("click", function () {
  toggleRecording();
});

var toggleMic = function () {
  let micEle = document.getElementById("microphone");
  micEle.classList.toggle("icon-mute");
  micEle.classList.toggle("icon-mic");
  micEle.classList.toggle("on");
  audioTrack.enabled = micEle.classList.contains("icon-mic");
  micEnabled = audioTrack.enabled;
};

var toggleRecording = function () {
  debug("toggleRecording called, current recording state:", recording);
  if (recording) {
    stopRecording();
  } else {
    startRecording();
  }
};

var startRecording = function () {
  debug("startRecording called");
  if (!mediaRecorder) {
    debug("Error: mediaRecorder not initialized");
    return;
  }

  try {
    recordedChunks = [];
    mediaRecorder.start();
    recording = true;
    document.getElementById("record").innerText = "Stop Recording";
    debug("Recording started successfully");
  } catch (error) {
    debug("Error starting recording:", error);
  }
};

var stopRecording = function () {
  debug("stopRecording called");
  if (!mediaRecorder) {
    debug("Error: mediaRecorder not initialized");
    return;
  }

  try {
    mediaRecorder.stop();
    recording = false;
    document.getElementById("record").innerText = "Record";
    debug("Recording stopped successfully");
  } catch (error) {
    debug("Error stopping recording:", error);
  }
};

var handleDataAvailable = function (event) {
  debug("handleDataAvailable called, data size:", event.data.size);
  if (event.data.size > 0) {
    recordedChunks.push(event.data);
    debug("Chunk added, total chunks:", recordedChunks.length);
  }
};

var handleStop = function () {
  debug("handleStop called");
  try {
    var blob = new Blob(recordedChunks, {
      type: "audio/webm",
    });
    debug("Blob created, size:", blob.size);
    sendBlob(blob);
  } catch (error) {
    debug("Error creating blob:", error);
  }
};

var sendBlob = function (blob) {
  debug("sendBlob called, blob size:", blob.size);
  let date = new Date();
  let filename = `recording_${date.toISOString().slice(0, 10)}_${
    date.getHours() < 10 ? "0" + date.getHours() : date.getHours()
  }_${
    date.getMinutes() < 10 ? "0" + date.getMinutes() : date.getMinutes()
  }.webm`;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);

  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 0);
};

// Function to connect to a channel
var connectToChannel = function (channel, password) {
  if (!channel) return;

  document.getElementById("output").classList.remove("hidden");
  document.getElementById("input-form").classList.add("hidden");

  // Store these for potential reconnection
  channelName = channel;
  channelPassword = password || "";

  let params = {
    Channel: channelName,
    Password: channelPassword,
  };

  let val = { Key: "connect_publisher", Value: params };
  wsSend(val);
  document.getElementById("subtitle").innerText = params.Channel;
  console.log(`Connected to channel: ${params.Channel}`);
};

document.getElementById("input-form").addEventListener("submit", function (e) {
  e.preventDefault();

  // Show the spinner
  document.getElementById("spinner").classList.remove("hidden");
  // Hide the connect button
  document.getElementById("connect-button").classList.add("hidden");

  // Get values from form
  channelName = document.getElementById("channel").value;
  channelPassword = document.getElementById("password").value;

  // Initialize audio if not already initialized
  if (!audioInitialized) {
    initializeAudio()
      .then(() => {
        audioInitialized = true;

        // Create and send WebRTC offer
        pc.createOffer()
          .then((d) => {
            pc.setLocalDescription(d);
            let val = { Key: "session_publisher", Value: d };
            wsSend(val);

            // Now connect to the channel
            connectToChannel(channelName, channelPassword);
          })
          .catch((error) => {
            debug("Error creating offer:", error);
            document.getElementById("spinner").classList.add("hidden");
            document
              .getElementById("connect-button")
              .classList.remove("hidden");
          });
      })
      .catch((error) => {
        debug("Error initializing audio:", error);
        document.getElementById("spinner").classList.add("hidden");
        document.getElementById("connect-button").classList.remove("hidden");
        error(
          "Failed to access microphone. Please ensure you have given permission and try again."
        );
      });
  } else {
    // If audio is already initialized, just connect to the channel
    connectToChannel(channelName, channelPassword);
  }
});

// Function to restore settings after page reload or reconnection
var restoreSettings = function () {
  const savedSettings = localStorage.getItem("babelcast_settings");
  if (savedSettings) {
    try {
      const settings = JSON.parse(savedSettings);

      // Pre-fill form fields if we're still on the form
      if (
        document.getElementById("input-form").classList.contains("hidden") ===
        false
      ) {
        if (settings.channel) {
          document.getElementById("channel").value = settings.channel;
        }
        if (settings.password) {
          document.getElementById("password").value = settings.password;
        }
      }

      // Remember these for when the connection is established
      channelName = settings.channel || "";
      channelPassword = settings.password || "";
      wasRecording = settings.wasRecording || false;
      micEnabled = settings.micEnabled || true;

      // Restore auto-stop settings
      if (typeof settings.autoStopEnabled !== "undefined") {
        autoStopEnabled = settings.autoStopEnabled;
        document.getElementById("auto-stop-enabled").checked = autoStopEnabled;
      }
      if (typeof settings.stopAfterMinutesSilence !== "undefined") {
        stopAfterMinutesSilence = settings.stopAfterMinutesSilence;
        document.getElementById("silence-minutes").value =
          stopAfterMinutesSilence;
      }

      // Clear the settings to prevent unexpected auto-connections on manual page refreshes
      localStorage.removeItem("babelcast_settings");

      return settings;
    } catch (error) {
      debug("Error restoring settings:", error);
    }
  }
  return null;
};

ws.onmessage = function (e) {
  let wsMsg = JSON.parse(e.data);
  if ("Key" in wsMsg) {
    switch (wsMsg.Key) {
      case "info":
        debug("server info", wsMsg.Value);
        // Reset reconnection timer if we get any info message
        clearReconnectionTimer();
        break;
      case "error":
        error("server error", wsMsg.Value);
        document.getElementById("output").classList.add("hidden");
        document.getElementById("input-form").classList.remove("hidden");
        document.getElementById("spinner").classList.add("hidden");
        document.getElementById("connect-button").classList.remove("hidden");
        break;
      case "sd_answer":
        startSession(wsMsg.Value);
        break;
      case "ice_candidate":
        pc.addIceCandidate(wsMsg.Value);
        break;
    }
  }
};

ws.onclose = function () {
  debug("WS connection closed");
  // Start reconnection timeout if connection closes unexpectedly
  startReconnectionTimer();
  if (audioTrack) {
    audioTrack.stop();
  }
  pc.close();
};

// Function to handle reconnection timer
function startReconnectionTimer() {
  // Don't start a new timer if one is already running
  if (reconnectTimeout) return;

  connectionLostTime = Date.now();
  wasRecording = recording;

  // If there was an active recording, stop it
  if (recording) {
    stopRecording();
  }

  // Attempt to reconnect after a delay
  debug("Starting reconnection timer");
  reconnectTimeout = setTimeout(attemptReconnect, 5000);
}

// Function to clear the reconnection timer
function clearReconnectionTimer() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
    connectionLostTime = null;
    debug("Cleared reconnection timer");
  }
}

// Function to attempt reconnection
function attemptReconnect() {
  debug("Attempting to reconnect...");

  try {
    // Create a new WebSocket
    ws = new WebSocket(ws_uri);

    ws.onopen = function () {
      debug("Reconnection successful");

      // Initialize new peer connection
      pc = new RTCPeerConnection({
        iceServers: [
          {
            urls: "stun:stun.l.google.com:19302",
          },
        ],
      });

      // Set up event handlers
      pc.oniceconnectionstatechange = (e) => {
        debug("ICE state:", pc.iceConnectionState);
        switch (pc.iceConnectionState) {
          case "new":
          case "checking":
          case "failed":
          case "disconnected":
          case "closed":
            break;
          case "connected":
          case "completed":
            document.getElementById("spinner").classList.add("hidden");
            let cb = document.getElementById("connect-button");
            if (cb) {
              cb.classList.remove("hidden");
            }

            // If we have channel info, connect again
            if (channelName) {
              connectToChannel(channelName, channelPassword);
            }

            // If we were recording before, restart recording
            if (wasRecording && mediaRecorder && !recording) {
              setTimeout(startRecording, 1000);
            }

            // Restore microphone state
            if (audioTrack && micEnabled) {
              audioTrack.enabled = true;
              let micEle = document.getElementById("microphone");
              micEle.classList.remove("icon-mute");
              micEle.classList.add("icon-mic");
              micEle.classList.add("on");
            }
            break;
          default:
            debug("ice state unknown", e);
            break;
        }
      };

      pc.onicecandidate = (e) => {
        if (e.candidate && e.candidate.candidate !== "") {
          let val = { Key: "ice_candidate", Value: e.candidate };
          wsSend(val);
        }
      };

      // Re-establish the WebRTC connection
      initializeAudio()
        .then(() => {
          audioInitialized = true;
        })
        .catch((error) => {
          debug("Error re-initializing audio:", error);
        });

      // Update message handlers
      ws.onmessage = function (e) {
        let wsMsg = JSON.parse(e.data);
        if ("Key" in wsMsg) {
          switch (wsMsg.Key) {
            case "info":
              debug("server info", wsMsg.Value);
              // Reset reconnection timer if we get any info message
              clearReconnectionTimer();
              break;
            case "error":
              error("server error", wsMsg.Value);
              document.getElementById("output").classList.add("hidden");
              document.getElementById("input-form").classList.remove("hidden");
              document.getElementById("spinner").classList.add("hidden");
              document
                .getElementById("connect-button")
                .classList.remove("hidden");
              break;
            case "sd_answer":
              startSession(wsMsg.Value);
              break;
            case "ice_candidate":
              pc.addIceCandidate(wsMsg.Value);
              break;
          }
        }
      };

      ws.onclose = function () {
        debug("WS connection closed");
        // Start reconnection timeout if connection closes unexpectedly
        startReconnectionTimer();
        if (audioTrack) {
          audioTrack.stop();
        }
        pc.close();
      };
    };

    ws.onerror = function (error) {
      debug("Reconnection error:", error);
      // Try again after a delay
      reconnectTimeout = setTimeout(attemptReconnect, 5000);
    };
  } catch (error) {
    debug("Error during reconnection attempt:", error);
    // Try again after a delay
    reconnectTimeout = setTimeout(attemptReconnect, 5000);
  }
}

//
// -------- WebRTC ------------
//

const constraints = (window.constraints = {
  audio: {
    channels: 1,
    autoGainControl: true,
    echoCancellation: false,
    noiseSuppression: false,
  },
  video: false,
});

const signalMeter = document.querySelector("#microphone-meter meter");

pc.oniceconnectionstatechange = (e) => {
  debug("ICE state:", pc.iceConnectionState);
  switch (pc.iceConnectionState) {
    case "new":
    case "checking":
    case "failed":
      console.log("ICE state:", pc.iceConnectionState);
    case "disconnected":
      console.log("ICE state:", pc.iceConnectionState);
    case "closed":
      break;
    case "connected":
    case "completed":
      document.getElementById("spinner").classList.add("hidden");
      let cb = document.getElementById("connect-button");
      if (cb) {
        cb.classList.remove("hidden");
      }
      break;
    default:
      debug("ice state unknown", e);
      break;
  }
};
