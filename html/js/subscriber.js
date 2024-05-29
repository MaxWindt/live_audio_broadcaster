var getChannelsId = setInterval(function () {
  console.log("get_channels");
  let val = { Key: "get_channels" };
  wsSend(val);
}, 1000);

document.getElementById("reload").addEventListener("click", function () {
  window.location.reload(false);
});

function channelClick(e) {
  document.getElementById("output").classList.remove("hidden");
  document.getElementById("channels").classList.add("hidden");
  document.getElementById("reload").classList.remove("hidden");
  let params = {};
  params.Channel = e.target.innerText;
  document.getElementById("subtitle").innerText = e.target.innerText;
  let val = { Key: "connect_subscriber", Value: params };
  wsSend(val);
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
        //error("server error:", wsMsg.Value);
        error(
          "server error:",
          "Server was not ready. Please try again, slower :)"
        );
        document.getElementById("output").classList.add("hidden");
        document.getElementById("channels").classList.add("hidden");
        break;
      case "sd_answer":
        startSession(wsMsg.Value);
        break;
      case "channels":
        updateChannels(wsMsg.Value);
        break;
      case "session_established": // wait for the message that session_subscriber was received
        document.getElementById("channels").classList.remove("hidden");
        document.getElementById("spinner").classList.add("hidden");
        console.log("session_established");
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

  document.getElementById("media").appendChild(el);
  // Get the existing play/pause button
  let playButton = document.getElementById("play");
  // Toggle play/pause functionality
  playButton.onclick = function () {
    if (el.paused) {
      el.play();
      playButton.innerHTML = '<span class="icon-pause"></span>';
    } else {
      el.pause();
      playButton.innerHTML = '<span class="icon-play"></span>';
    }
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
