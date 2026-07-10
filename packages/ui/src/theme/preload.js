/* AgentBoard FOUC preload — namespaced for grok-device */
(function () {
  try {
    var key = "grok-device-theme-id";
    var themeId = localStorage.getItem(key) || "grok";
    if (themeId === "oc-1") {
      themeId = "oc-2";
      localStorage.setItem(key, themeId);
      localStorage.removeItem("grok-device-theme-css-light");
      localStorage.removeItem("grok-device-theme-css-dark");
    }
    var scheme = localStorage.getItem("grok-device-color-scheme") || "system";
    var isDark =
      scheme === "dark" ||
      (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    var mode = isDark ? "dark" : "light";

    document.documentElement.dataset.theme = themeId;
    document.documentElement.dataset.colorScheme = mode;
    // AgentBoard hard plate
    document.documentElement.style.backgroundColor = isDark ? "#080808" : "#fafafa";

    var metas = document.querySelectorAll("meta[name='theme-color']");
    if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#080808" : "#fafafa");

    // Static theme.css FOUC is OC-2; skip cache only when default plate matches
    if (themeId === "oc-2") return;

    var css = localStorage.getItem("grok-device-theme-css-" + mode);
    if (!css) return;
    var style = document.createElement("style");
    style.id = "gd-theme-preload";
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
      bg = bg.trim();
      document.documentElement.style.backgroundColor = bg;
      if (metas.length > 0) metas[0].setAttribute("content", bg);
    }
  } catch (e) {}
})();
