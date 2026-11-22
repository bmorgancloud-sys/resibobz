// Install guide (/install): picks the right tab for this device and warns about in-app browsers.
(function(){
  var ua = navigator.userAgent || "";
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  var inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/i.test(ua);
  // iOS in-app browsers usually lack "Safari/" in the user agent
  if (isIOS && !/Safari\//.test(ua)) inApp = true;
  if (isIOS && /CriOS|FxiOS|EdgiOS/.test(ua)) inApp = false; // other real browsers: steps still say "open Safari"

  var tabs = {iphone:"t-iphone", android:"t-android", computer:"t-computer"};
  function show(key){
    Object.keys(tabs).forEach(function(k){
      var on = (k === key);
      document.getElementById(tabs[k]).setAttribute("aria-selected", on ? "true" : "false");
      document.getElementById("p-" + k).classList.toggle("on", on);
    });
  }
  Object.keys(tabs).forEach(function(k){
    document.getElementById(tabs[k]).addEventListener("click", function(){ show(k); });
  });

  var guess = isIOS ? "iphone" : isAndroid ? "android" : "computer";
  show(guess);
  document.getElementById("guess").textContent =
    "We think you have " + (guess === "iphone" ? "an iPhone" : guess === "android" ? "an Android" : "a computer") +
    ". Not right? Tap the one you have.";

  if (inApp && isIOS) document.getElementById("iphone-inapp").hidden = false;
  if (inApp && isAndroid) document.getElementById("android-inapp").hidden = false;

  // Already installed? Say so.
  var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (standalone) {
    var d = document.createElement("div");
    d.className = "done";
    d.innerHTML = "<b>✅ Toucan Bill is already on this device.</b> You can close this page.";
    document.getElementById("guess").after(d);
  }
})();
