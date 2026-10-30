// Applies a saved light or dark choice before the first paint, so the page doesn't flash.
// Loaded as a classic script in <head>; the toggle itself lives in main.js.
(function () {
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch (e) {
    // Storage blocked: follow the system setting.
  }
})();
