var audioTrack;
var mediaRecorder;
var recordedChunks = [];
var silenceStart = null;
var recording = false;
var stopAfterMinutesSilence = 1;

// Add a debug function
var debug = function (...args) {
  console.log(...args);
};

document.getElementById("reload").addEventListener("click", function () {
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

document.getElementById("input-form").addEventListener("submit", function (e) {
  e.preventDefault();

  document.getElementById("output").classList.remove("hidden");
  document.getElementById("input-form").classList.add("hidden");
  let params = {};

  params.Channel = document.getElementById("channel").value;
  params.Password = document.getElementById("password").value;
  let val = { Key: "connect_publisher", Value: params };
  wsSend(val);
  document.getElementById("subtitle").innerText = params.Channel;
  console.log(params.Channel);
});

ws.onmessage = function (e) {
  let wsMsg = JSON.parse(e.data);
  if ("Key" in wsMsg) {
    switch (wsMsg.Key) {
      case "info":
        debug("server info", wsMsg.Value);
        break;
      case "error":
        error("server error", wsMsg.Value);
        document.getElementById("output").classList.add("hidden");
        document.getElementById("input-form").classList.add("hidden");
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
  if (audioTrack) {
    audioTrack.stop();
  }
  pc.close();
};

//
// -------- WebRTC ------------
//

const constraints = (window.constraints = {
  audio: {
    channels: 2,
    autoGainControl: false,
    echoCancellation: false,
    noiseSuppression: false,
  },
  video: false,
});

try {
  window.AudioContext = window.AudioContext || window.webkitAudioContext;
  window.audioContext = new AudioContext();
} catch (e) {
  alert("Web Audio API not supported.");
}

const signalMeter = document.querySelector("#microphone-meter meter");

navigator.mediaDevices
  .getUserMedia(constraints)
  .then((stream) => {
    audioTrack = stream.getAudioTracks()[0];
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    // mute until we're ready
    audioTrack.enabled = false;

    const soundMeter = new SoundMeter(window.audioContext);
    soundMeter.connectToSource(stream, function (e) {
      if (e) {
        alert(e);
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
        mediaRecorder.onerror = (event) => debug("MediaRecorder error:", event);

        debug("MediaRecorder event handlers set up");
      } catch (error) {
        debug("Error setting up MediaRecorder:", error);
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

        // Check for silence
        if (val < 0.03 && recording) {
          if (!silenceStart) {
            silenceStart = Date.now();
          } else if (
            Date.now() - silenceStart >
            stopAfterMinutesSilence * 60 * 1000
          ) {
            stopRecording();
            startRecording();
            silenceStart = null;
          }
        } else {
          silenceStart = null;
        }
      }, 50);
    });

    pc.createOffer()
      .then((d) => {
        pc.setLocalDescription(d);
        let val = { Key: "session_publisher", Value: d };
        wsSend(val);
      })
      .catch(debug);
  })
  .catch((error) => debug("getUserMedia error:", error));

pc.onicecandidate = (e) => {
  if (e.candidate && e.candidate.candidate !== "") {
    let val = { Key: "ice_candidate", Value: e.candidate };
    wsSend(val);
  }
};
