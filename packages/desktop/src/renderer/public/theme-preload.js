/* Apply the saved theme before Solid mounts, avoiding a bright first frame. */
(function () {
  try {
    var key = "relay-theme-id";
    var themeId =
      localStorage.getItem(key) || localStorage.getItem("grok-device-theme-id") || "relay";
    if (themeId === "grok") themeId = "relay";
    if (themeId === "oc-1") {
      themeId = "oc-2";
      localStorage.setItem(key, themeId);
      localStorage.removeItem("relay-theme-css-light");
      localStorage.removeItem("relay-theme-css-dark");
    }
    var scheme =
      localStorage.getItem("relay-color-scheme") ||
      localStorage.getItem("grok-device-color-scheme") ||
      "system";
    var isDark =
      scheme === "dark" ||
      (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    var mode = isDark ? "dark" : "light";
    document.documentElement.dataset.theme = themeId;
    document.documentElement.dataset.colorScheme = mode;
    document.documentElement.style.backgroundColor = isDark ? "#080808" : "#fafafa";
    var meta = document.querySelector("meta[name='theme-color']");
    if (meta) meta.setAttribute("content", isDark ? "#080808" : "#fafafa");
    if (themeId === "oc-2") return;
    var css =
      localStorage.getItem("relay-theme-css-" + mode) ||
      localStorage.getItem("grok-device-theme-css-" + mode);
    if (!css) return;
    var style = document.createElement("style");
    style.id = "relay-theme-preload";
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}";
    document.head.appendChild(style);
    var bg = (css.match(/--background-base:\s*([^;]+);/) || [])[1];
    if (bg) {
      document.documentElement.style.backgroundColor = bg.trim();
      if (meta) meta.setAttribute("content", bg.trim());
    }
  } catch {}
})();
