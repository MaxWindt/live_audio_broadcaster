// Uses clipboard.js for better device and browser support - https://clipboardjs.com/
copy_textarea.addEventListener(`focus`, () => copy_textarea.select());

var active = false;

$(document).ready(function () {
  var copySource = $("#copy_textarea");
  var copyButton = $("#copy_button");
  var clipboard = new ClipboardJS("#copy_button");

  clipboard.on("success", function (e) {
    var copyButtonMessage = "Copied!";
    e.clearSelection();
    copyButton.focus();
    if (active) {
      return;
    } else {
      copyMessageTooltip(copyButton, copyButtonMessage);
    }
  });
  clipboard.on("error", function (e) {
    var copyButtonMessage = "Press Ctrl+C to copy";
    if (active) {
      return;
    } else {
      copyMessageTooltip(copyButton, copyButtonMessage);
    }
  });
});

function copyMessageTooltip(copyButton, copyButtonMessage) {
  active = true;

  var tooltipVisibleTime = 2000; // How long to leave tooltip visible
  var tooltipHideTime = 100; // matches .inactive animation time

  // tooltip
  $("#copy_tooltip").text(copyButtonMessage).addClass("active");
  copyButton.attr("aria-describedby", "copy_tooltip");

  setTimeout(function () {
    $("#copy_tooltip").removeClass("active").addClass("inactive");
    // https://css-tricks.com/restart-css-animation/

    $("#copy_tooltip").replaceWith($("#copy_tooltip").clone(true));
    copyButton.removeAttr("aria-describedby");
    setTimeout(function () {
      $("#copy_tooltip").removeClass("inactive").text("");
      active = false;
    }, tooltipHideTime);
  }, tooltipVisibleTime);
}
