// Loaded synchronously in <head> so a saved theme applies before first paint.
(function () {
  try {
    var t = localStorage.getItem('qa-hub-theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) { /* storage unavailable: follow the system theme */ }
})();
