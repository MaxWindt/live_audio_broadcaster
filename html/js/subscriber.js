var getChannelsId = setInterval(function () {
  console.log("get_channels");
  let val = { Key: "get_channels" };
  wsSend(val);
}, 1000);

// exprimentall automatc reload
// var checkConnection = setInterval(function () {
//   console.log("checking_connection");
//   audio = document.getElementById("audio");
//   if (audio.ended || audio.waiting) {
//     console.log("audio is not playing, reloading...");
//     console.log("ready state:");
//     console.log(audio.readyState);
//     reloadJS();
//   }
// }, 5000);

document
  .getElementById("bt_switch_channel")
  .addEventListener("click", function () {
    // Close the existing PeerConnection
    if (pc) {
      pc.close();
    }
    localStorage.removeItem("channel");
    window.location.reload(true);
  });

function channelClick(e) {
  document.getElementById("output").classList.remove("hidden");
  document.getElementById("channels").classList.add("hidden");

  document.getElementById("bt_switch_channel").classList.remove("hidden");
  document.getElementById("bt_reload").classList.remove("hidden");
  document.getElementById("subtitle").innerText = e.target.innerText;
  let params = {};
  params.Channel = e.target.innerText;
  let val = { Key: "connect_subscriber", Value: params };
  wsSend(val);
  localStorage.setItem("channel", e.target.innerText);
}

function updateChannels(channels) {
  let channelsEle = document.querySelector("#channels ul");
  channelsEle.innerHTML = "";
  if (channels.length > 0) {
    clearInterval(getChannelsId);
    document.getElementById("nochannels").classList.add("hidden");
    channels.forEach((e) => {
      let c = document.createElement("li");
      c.classList.add("channel");
      c.innerText = e;
      c.addEventListener("click", channelClick);
      channelsEle.appendChild(c);
    });
  }
}

ws.onmessage = function (e) {
  let wsMsg = JSON.parse(e.data);
  if ("Key" in wsMsg) {
    switch (wsMsg.Key) {
      case "info":
        debug("server info:", wsMsg.Value);
        break;
      case "error":
        error("server error:", wsMsg.Value);

        document.getElementById("output").classList.add("hidden");
        document.getElementById("channels").classList.add("hidden");
        break;
      case "sd_answer":
        startSession(wsMsg.Value);
        break;
      case "channels":
        if (localStorage.getItem("channel") === null) {
          updateChannels(wsMsg.Value);
        } else {
          clearInterval(getChannelsId);
          console.log("Using last channel");
        }

        break;
      case "session_established": // wait for the message that session_subscriber was received
        document.getElementById("channels").classList.remove("hidden");
        document.getElementById("spinner").classList.add("hidden");
        console.log("session_established");
        if (localStorage.getItem("channel") !== null) {
          document.getElementById("output").classList.remove("hidden");
          document.getElementById("channels").classList.add("hidden");

          document
            .getElementById("bt_switch_channel")
            .classList.remove("hidden");
          document.getElementById("bt_reload").classList.remove("hidden");
          document.getElementById("subtitle").innerText =
            localStorage.getItem("channel");
          let params = {};
          params.Channel = localStorage.getItem("channel");
          let val = { Key: "connect_subscriber", Value: params };
          wsSend(val);
        }

        break;
      case "ice_candidate":
        pc.addIceCandidate(wsMsg.Value);
        break;
    }
  }
};

ws.onclose = function () {
  debug("WS connection closed");
  pc.close();
  document.getElementById("media").classList.add("hidden");
};

//
// -------- WebRTC ------------
//

pc.ontrack = function (event) {
  //console.log("Ontrack", event);
  let el = document.createElement(event.track.kind);
  el.srcObject = event.streams[0];
  el.autoplay = true;
  el.playsInline = true;
  el.id = "audio";

  media_placeholder = document.getElementById("media");
  media_placeholder.innerHTML = "";
  media_placeholder.appendChild(el);
  audio = document.getElementById("audio");
  // reload when connection is lost
  audio.onended = function () {
    console.log("stream ended, reloading...");
    reloadJS();
  };
  // reload when connection is lost and you try to play again
  audio.onwaiting = function () {
    console.log("waiting for audio data, reloading...");
    reloadJS();
  };
  // reload when connection is lost and you try to play again
  audio.onerror = function () {
    console.log("error loading audio data, reloading...");
    reloadJS();
  };

  // updating current time display #TODO This needs to be rounded and put in minute/hour form
  audio.ontimeupdate = function () {
    console.log(audio.currentTime);
  };

  // Get the existing play/pause button
  let playButton = document.getElementById("play");
  // Toggle play/pause functionality
  playButton.onclick = function () {
    if (el.paused) {
      el.play();
    } else {
      el.pause();
    }
  };
  //update play button
  audio.onplay = function () {
    playButton.innerHTML = '<span class="icon-pause"></span>';
  };
  audio.onpause = function () {
    playButton.innerHTML = '<span class="icon-play"></span>';
  };

  // Make the play/pause button visible
  playButton.classList.remove("hidden");
  // Wait for audio to load before checking if autoPlay was successfull, then adapt button Icon
  setTimeout(function () {
    if (el.paused) {
      playButton.innerHTML = '<span class="icon-play"></span>';
    }
  }, 500);
};

pc.addTransceiver("audio");

pc.createOffer()
  .then((d) => {
    pc.setLocalDescription(d);
    let val = { Key: "session_subscriber", Value: d };
    wsSend(val);
  })
  .catch(debug);

// ----------------------------------------------------------------
