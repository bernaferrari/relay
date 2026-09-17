/* Apply the saved color scheme before React mounts to avoid a flash. */
(function () {
  try {
    var scheme =
      localStorage.getItem("relay-color-scheme") ||
      localStorage.getItem("relay:appearance.colorScheme") ||
      localStorage.getItem("grok-device-color-scheme") ||
      "system";
    var isDark =
      scheme === "dark" ||
      (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    var mode = isDark ? "dark" : "light";
    var root = document.documentElement;
    root.dataset.theme = "relay";
    root.dataset.colorScheme = mode;
    root.dataset.colorSchemePreference = scheme === "light" || scheme === "dark" ? scheme : "system";
    root.classList.toggle("dark", isDark);
    root.style.colorScheme = mode;
    root.style.removeProperty("background-color");
    var meta = document.querySelector("meta[name='theme-color']");
    if (meta) meta.setAttribute("content", isDark ? "#252525" : "#ffffff");
    localStorage.removeItem("relay-theme-css-light");
    localStorage.removeItem("relay-theme-css-dark");
    localStorage.removeItem("grok-device-theme-css-light");
    localStorage.removeItem("grok-device-theme-css-dark");
    var leftover = document.getElementById("relay-theme-preload");
    if (leftover) leftover.remove();
    leftover = document.getElementById("relay-theme");
    if (leftover) leftover.remove();
  } catch {}
})();
