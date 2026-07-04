/* OpenCode FOUC prevention — inject cached resolve+v2 CSS only. */
(function () {
  try {
    var themeId = localStorage.getItem("grok-device-theme-id") || "grok";
    if (themeId === "oc-1") themeId = "oc-2";
    var scheme = localStorage.getItem("grok-device-color-scheme") || "system";
    var dark =
      scheme === "dark" ||
      (scheme === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    var mode = dark ? "dark" : "light";
    document.documentElement.dataset.theme = themeId;
    document.documentElement.dataset.colorScheme = mode;
    document.documentElement.style.colorScheme = mode;

    var cssKey = dark ? "grok-device-theme-css-dark" : "grok-device-theme-css-light";
    var cached = localStorage.getItem(cssKey);
    if (cached) {
      var style = document.createElement("style");
      style.id = "gd-theme-preload";
      style.textContent =
        ":root{color-scheme:" +
        mode +
        ";--text-mix-blend-mode:" +
        (dark ? "plus-lighter" : "multiply") +
        ";" +
        cached +
        "}";
      document.documentElement.appendChild(style);
    } else {
      document.documentElement.style.backgroundColor = dark ? "#080808" : "#fafafa";
    }
  } catch (e) {}
})();
