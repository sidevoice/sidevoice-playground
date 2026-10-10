// The mocked preview's `/voice/target.js`: the classic script a deployment puts before the web's module, so what it
// sets is there when the web starts. Here it hands this page to the shell around it, which puts in its mocks (the
// page's fetch, and the desktop app's bridge in the app view). The page opened on its own goes to the shell.
(function () {
  var shell = window.parent !== window && window.parent.__sidevoicePreview;
  if (!shell) {
    location.replace("/");
    return;
  }
  shell.attach(window);
})();
