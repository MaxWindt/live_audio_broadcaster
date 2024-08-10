var getChannelsId = setInterval(function () {
  console.log("get_channels");
  let val = { Key: "get_channels" };
  wsSend(val);
}, 1000);


const themeButton = document.getElementById("themeButton");
const themes = ["default", "dark", "blue", "green"];

// Load saved theme on page load
let currentTheme = localStorage.getItem("lab_page_theme") || 0;

// Save theme on change
themeButton.addEventListener("click", () => {
  currentTheme = (currentTheme + 1) % themes.length;
  document.body.className = themes[currentTheme];
  localStorage.setItem("lab_page_theme", currentTheme); // Save the selected theme
});

function channelClick(e) {
  let params = {};
  params.Channel = e.target.innerText;
  let val = { Key: "connect_subscriber", Value: params };
  wsSend(val);
  localStorage.setItem("lab_channel", e.target.innerText);
}

function updateChannels(channels) {
  let channelsEle = document.querySelector("#channels div");
  channelsEle.innerHTML = "";
  if (channels.length > 0) {
    clearInterval(getChannelsId);
    document.getElementById("nochannels").classList.add("hidden");
    channels.forEach((channel) => {
      let li = document.createElement("div");
      li.classList.add("mdl-card__actions", "mdl-card--border");

      // Create the button for the channel
      let channelButton = document.createElement("a");
      channelButton.classList.add(
        "mdl-button",
        "mdl-button--raised",
        "mdl-js-button",
        "mdl-js-ripple-effect"
      );
channelButton.id = channel;
      // Set the innerHTML and icon based on the channel name
      if (/live|original/i.test(channel)) {
        
        channelButton.innerHTML =
          '<i class="material-icons">record_voice_over</i> ' + channel;
      } else if (/translation|übersetzung/i.test(channel)) {
        channelButton.innerHTML =
          '<i class="material-icons">translate</i> ' + channel;
      } else {
        channelButton.innerHTML =
          '<i class="material-icons">music_cast</i> ' + channel; // Default case if it doesn't match known types
      }

      // Add event listener for the button
      channelButton.addEventListener("click", function () {
        if (this.classList.contains("playing")) {
          if (audio.paused) {
            audio.play();
          } else {
            audio.pause();
          }
        } else {
          this.classList.add("playing");
          channelClick({ target: { innerText: channel } });
        }
      });

      // Append the button to the list item
      li.appendChild(channelButton);

      // Append the list item to the channel list
      channelsEle.appendChild(channelButton);
    });
  }
}

function closeWS() {
  if (ws) {
    ws.close();
  }
}

function hardReload() {
  // Close the existing PeerConnection

  closeWS();
  window.location.reload(true);
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

        // document.getElementById("output").classList.add("hidden");
        document.getElementById("channels").classList.add("hidden");
        localStorage.removeItem("channel");
        hardReload();
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
        if (localStorage.getItem("lab_channel") !== null) {
          let params = {};
          params.Channel = localStorage.getItem("lab_channel");
          // TODO Show the channel that is playing (maybe by adding a additional ID to the buttons that are named as the channels)
          // getElementByText(ctx, params.Channel).classList.add("playing");
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
  //reload scripts and reconnect to server
  const scripts = document.querySelectorAll("script");
  scripts.forEach((script) => {
    if (script.src) {
      const newScript = document.createElement("script");
      newScript.src = script.src.split("?")[0] + "?t=" + new Date().getTime();
      script.parentNode.replaceChild(newScript, script);
    }
  });
};

//
// -------- WebRTC ------------
//

pc.ontrack = function (event) {
  let audio = document.getElementById("audio");

  // Check if the element already exists
  if (audio) {
    // Update the element's properties if it already exists
    console.log("updating stream");
    audio.srcObject = event.streams[0];
  } else {
    let el = document.createElement(event.track.kind);
    // Create and append a new element if it doesn't exist
    el.srcObject = event.streams[0];
    el.autoplay = true;
    el.playsInline = true;
    el.id = "audio";

    const media_placeholder = document.getElementById("media");
    media_placeholder.innerHTML = "";
    media_placeholder.appendChild(el);
  }
  audio = document.getElementById("audio");
  // Hard Reload when audio is paused screen is shut off and gets on again. A fresh restart is needed
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && audio.paused) {
      hardReload();
    }
  });
  // reload when connection is lost
  audio.onended = function () {
    console.log("stream ended, reloading...");
    closeWS();
  };
  // reload when connection is lost and you try to play again
  audio.onwaiting = function () {
    console.log("waiting for audio data, reloading...");
    closeWS();
  };
  // reload when connection is lost and you try to play again
  audio.onerror = function () {
    console.log("error loading audio data, reloading...");
    closeWS();
  };

  // updating current time display #TODO This needs to be rounded and put in minute/hour form
  audio.ontimeupdate = function () {
    console.log(audio.currentTime);
  };

  // Get the existing play/pause button
  let playButton = document.getElementById("play");
  // Toggle play/pause functionality
  playButton.onclick = function () {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  };
  //update play button

  audio.onplay = function () {
    playButton.innerHTML = '<i class="material-icons">pause</i>';
  };
  audio.onpause = function () {
    playButton.innerHTML = '<i class="material-icons">play_arrow</i>';
  };

  playButton.classList.remove("hidden");
  setTimeout(function () {
    if (audio.paused) {
      playButton.innerHTML = '<i class="material-icons">play_arrow</i>';
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
