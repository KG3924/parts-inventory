/* Shared sign-in for index.html and count.html.
   One login per phone for the shift. Scan does not ask again.
   Phone biometrics = the browser's saved-password prompt (Face ID, Touch ID,
   fingerprint). Passkeys need a dashboard relying-party setup that cannot
   cover a preview host and the live Pages host at the same time, so this
   cut uses a name and password with autocomplete. */
(function () {
  var SHIFT_MS = 12 * 60 * 60 * 1000;
  var EXP_KEY = 'inmar_shift_expires_at';
  var STAFF = [
    'Glynn Grantham',
    'Kyle Grantham',
    'Toby Whitfield',
    'Grant Adams',
    'Ricky Whitfield'
  ];
  var ZZ_NAME = 'ZZ Test Staff';

  function assertPublic(cfg) {
    var key = (cfg && cfg.anonKey) || '';
    var url = (cfg && cfg.url) || '';
    if (!url || !key) throw new Error('Missing public Supabase config.');
    if (/service_role|sb_secret_|service role/i.test(key) || /service_role|sb_secret_/i.test(url)) {
      throw new Error('Refusing to start: a secret key must not be in the public page.');
    }
  }

  assertPublic(window.INMAR_PUBLIC);

  var client = window.supabase.createClient(window.INMAR_PUBLIC.url, window.INMAR_PUBLIC.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  var signedInName = '';

  function zzOn() {
    try {
      return new URLSearchParams(window.location.search).get('zz') === '1';
    } catch (e) {
      return false;
    }
  }
  function nameAllowed(name) {
    if (STAFF.indexOf(name) !== -1) return true;
    return name === ZZ_NAME && zzOn();
  }
  function stampShift() {
    try { localStorage.setItem(EXP_KEY, String(Date.now() + SHIFT_MS)); } catch (e) {}
  }
  function clearShift() {
    try { localStorage.removeItem(EXP_KEY); } catch (e) {}
  }
  function shiftExpired() {
    var t = 0;
    try { t = Number(localStorage.getItem(EXP_KEY) || 0); } catch (e) {}
    return !t || Date.now() > t;
  }
  function currentName() { return signedInName || ''; }

  async function applySession(session) {
    if (!session || !session.user) { signedInName = ''; return false; }
    if (shiftExpired()) {
      await client.auth.signOut();
      clearShift();
      signedInName = '';
      return false;
    }
    var res = null;
    try {
      res = await client.from('profiles').select('full_name').eq('id', session.user.id).maybeSingle();
    } catch (e) {
      res = { error: e };
    }
    if (!res || res.error || !res.data || !res.data.full_name) {
      await client.auth.signOut();
      clearShift();
      signedInName = '';
      return false;
    }
    signedInName = res.data.full_name;
    return true;
  }

  async function restore() {
    var result = await client.auth.getSession();
    return applySession(result && result.data && result.data.session);
  }

  async function signIn(name, password) {
    if (!nameAllowed(name)) return { error: { message: 'That login is not one of the five shop accounts.' } };
    var invoked = await client.functions.invoke('staff-sign-in', {
      body: { name: name, password: password }
    });
    if (invoked.error) {
      var failMsg = invoked.error.message || 'Could not unlock.';
      try {
        var ctx = await invoked.error.context?.json?.();
        if (ctx && ctx.error) failMsg = ctx.error;
      } catch (e) {}
      return { error: { message: failMsg } };
    }
    var data = invoked.data || {};
    if (data.error) return { error: { message: data.error } };
    var set = await client.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token
    });
    if (set.error) return set;
    stampShift();
    await applySession(set.data && set.data.session);
    return set;
  }

  async function signOut() {
    clearShift();
    signedInName = '';
    await client.auth.signOut();
  }

  function namesFor(sel) {
    var names = STAFF.slice();
    if (zzOn() && sel && (sel.id === 'login-who' || sel.id === 'pw-who')) names.push(ZZ_NAME);
    return names;
  }
  function fillStaffSelect(sel) {
    if (!sel || sel.dataset.filled) return;
    sel.dataset.filled = '1';
    sel.innerHTML = '<option value="">— Select —</option>' + namesFor(sel).map(function (name) {
      return '<option value="' + name + '">' + name + '</option>';
    }).join('');
  }

  function bindLoginForm(onOk) {
    var form = document.getElementById('login-form');
    var who = document.getElementById('login-who');
    var login = document.getElementById('login-email');
    var pw = document.getElementById('login-password');
    var err = document.getElementById('login-error');
    var btn = document.getElementById('login-btn');
    if (!form || !pw || !btn) return;
    fillStaffSelect(who);
    function syncLogin() {
      if (login && who) login.value = who.value;
    }
    syncLogin();
    if (who) who.addEventListener('change', syncLogin);
    var busy = false;
    async function go() {
      if (busy) return;
      syncLogin();
      if (!who || !who.value) {
        if (err) err.textContent = 'Select your name.';
        return;
      }
      if (!pw.value) {
        pw.focus();
        return;
      }
      busy = true;
      btn.disabled = true;
      if (err) err.textContent = '';
      var result = await signIn(login.value, pw.value);
      busy = false;
      btn.disabled = false;
      if (result.error) {
        if (err) err.textContent = result.error.message || 'Could not unlock.';
        return;
      }
      pw.value = '';
      if (onOk) onOk();
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      go();
    });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      go();
    });
    pw.addEventListener('change', function () {
      if (pw.value && login && login.value) go();
    });
  }

  window.InmarAuth = {
    STAFF: STAFF,
    client: client,
    assertPublic: assertPublic,
    currentName: currentName,
    restore: restore,
    signIn: signIn,
    signOut: signOut,
    bindLoginForm: bindLoginForm,
    fillStaffSelect: fillStaffSelect,
    SHIFT_MS: SHIFT_MS
  };

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.pw-toggle') : null;
    if (!btn) return;
    e.preventDefault();
    var input = document.getElementById(btn.getAttribute('data-for'));
    if (!input) return;
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
  });
})();
