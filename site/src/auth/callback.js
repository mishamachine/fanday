// Hands a Supabase PKCE sign-in redirect to the Fanday app.
// The app's parseCallbackUrl (src/lib/authUtil.ts on cto/fanday-v1-foundation) accepts
// com.bbprojectfactory.fanday://auth/callback with ?code=... or ?error_description=... / ?error=...
// Only those three parameters are forwarded. The code is a one-time PKCE code: useless without the
// verifier stored in the app. Nothing is sent anywhere else, stored, or logged.
(function () {
  var SCHEME = 'com.bbprojectfactory.fanday://auth/callback';
  var p = new URLSearchParams(window.location.search);
  var out = new URLSearchParams();
  ['code', 'error_description', 'error'].forEach(function (k) { if (p.get(k)) out.set(k, p.get(k)); });
  var h = document.getElementById('h');
  var msg = document.getElementById('msg');
  var open = document.getElementById('open');
  var link = document.getElementById('openlink');
  if (!out.toString()) {
    h.textContent = 'Nothing to do here';
    msg.textContent = 'This page finishes sign-in for the Fanday app. Open the app to continue.';
    return;
  }
  var target = SCHEME + '?' + out.toString();
  link.setAttribute('href', target);
  if (out.get('error') || out.get('error_description')) {
    h.textContent = 'Sign-in didn’t finish';
    msg.textContent = out.get('error_description') || out.get('error');
  } else {
    h.textContent = 'You’re signed in';
    msg.textContent = 'Return to the app. If it doesn’t open by itself, use the button.';
  }
  open.classList.remove('hidden');
  // Drop the code from the address bar and history before leaving.
  try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
  window.location.href = target;
})();
