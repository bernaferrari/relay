(function () {
  var key = "grok-device-theme-id";
  var themeId = localStorage.getItem(key) || "grok";
  var scheme = localStorage.getItem("grok-device-color-scheme") || "system";
  var isDark =
    scheme === "dark" ||
    (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  var mode = isDark ? "dark" : "light";

  // Grok default palette fallback (dark-first product)
  var fallbackBg = isDark ? "#050507" : "#f6f6f8";

  document.documentElement.dataset.theme = themeId;
  document.documentElement.dataset.colorScheme = mode;
  document.documentElement.style.backgroundColor = fallbackBg;

  var metas = document.querySelectorAll("meta[name='theme-color']");
  if (metas.length > 0) metas[0].setAttribute("content", fallbackBg);

  var css = localStorage.getItem("grok-device-theme-css-" + mode);
  if (css) {
    var style = document.createElement("style");
    style.id = "gd-theme-preload";
    style.textContent = ":root{color-scheme:" + mode + ";" + css + "}";
    document.head.appendChild(style);

    // Prefer cached bg token if present
    var match = css.match(/--color-bg:([^;]+);/);
    if (match && match[1]) {
      document.documentElement.style.backgroundColor = match[1];
      if (metas.length > 0) metas[0].setAttribute("content", match[1]);
    }
  }
})();
