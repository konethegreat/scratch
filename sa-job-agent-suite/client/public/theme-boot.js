(function () {
  var KEY = 'sajas-theme';
  var root = document.documentElement;
  var choice = 'system';
  try {
    var saved = window.localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') choice = saved;
  } catch (error) {
    choice = 'system';
  }
  var dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.themeChoice = choice;
  root.style.colorScheme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b0d12' : '#f6f6f3');
})();
