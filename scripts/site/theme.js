// Loaded synchronously in <head> so a saved theme applies before first paint.
(function () {
  // Pins the page and the browser chrome (theme-color) to one theme.
  window.qaHubSetTheme = function (t) {
    document.documentElement.dataset.theme = t;
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', t === 'dark' ? '#0e0e10' : '#fbfbfb');
  };
  try {
    var t = localStorage.getItem('qa-hub-theme');
    if (t === 'light' || t === 'dark') window.qaHubSetTheme(t);
  } catch (e) { /* storage unavailable: follow the system theme */ }
})();
