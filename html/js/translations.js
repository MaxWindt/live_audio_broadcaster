var translation_de = {
  title: "Live-Audio-Stream",
  // subtitle: "Live-Audio-Stream",
  unsupported_browser:
    "Ihr Webbrowser unterstützt leider kein WebRTC, das für diese Anwendung erforderlich ist. Bitte versuchen Sie einen anderen Webbrowser.",
  channels_header: "Kanäle",
  channels_description:
    "Klicken Sie auf einen Kanalnamen unten, um eine Verbindung herzustellen.",
  no_channels: "Keine Kanäle gefunden",
  switch_channel: "Kanal wechseln",
  span_reload: "Neu laden",
  powered_by: "Ermöglicht durch Babelcast",
};

var translation_es = {
  title: "Transmisión de Audio en Vivo",
  // subtitle: "Transmisión de Audio en Vivo",
  unsupported_browser:
    "Desafortunadamente, su navegador web no parece admitir WebRTC, que es necesario para esta aplicación. Por favor, pruebe con otro navegador web.",
  channels_header: "Canales",
  channels_description:
    "Haga clic en un nombre de canal a continuación para conectarse.",
  no_channels: "No se encontraron canales",
  switch_channel: "Cambiar canal",
  span_reload: "recargar",
  powered_by: "Proporcionado por Babelcast",
};

// Function to set translations based on language
function setTranslations(translations) {
  document.getElementById("title").textContent = translations["title"];
  // document.getElementById("subtitle").textContent = translations["subtitle"];
  document.getElementById("unsupported_browser").textContent =
    translations["unsupported_browser"];
  document.getElementById("channels_header").textContent =
    translations["channels_header"];
  document.getElementById("channels_description").textContent =
    translations["channels_description"];
  document.getElementById("nochannels").textContent =
    translations["no_channels"];
  document.getElementById("switch_channel").textContent =
    translations["switch_channel"];
  document.getElementById("span_reload").textContent =
    translations["span_reload"];

  document.getElementById("powered_by").textContent =
    translations["powered_by"];
}

// Check if the language starts with "de" (for German)
if (navigator.language.startsWith("de")) {
  setTranslations(translation_de);
}
// Check if the language starts with "es" (for Spanish)
else if (navigator.language.startsWith("es")) {
  setTranslations(translation_es);
}
