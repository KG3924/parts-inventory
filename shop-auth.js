/* Shared sign-in for index.html and count.html.
   One login per phone for the shift. Scan does not ask again.
   Phone biometrics = the browser's saved-password prompt (Face ID, Touch ID,
   fingerprint). Passkeys need a dashboard relying-party setup that cannot
   cover a preview host and the live Pages host at the same time, so this
   cut uses email + password with autocomplete. */
(function () {
  var SHIFT_MS = 12 * 60 * 60 * 1000;
  var EXP_KEY = 'inmar_shift_expires_at';
  var STAFF = [
    { name: 'Glynn Grantham', email: 'glynn@inmarsystems.com' },
    { name: 'Kyle Grantham', email: 'kyle.grantham.kg@gmail.com' },
    { name: 'Toby Whitfield', email: 'toby@inmarsystems.com' },
    { name: 'Grant Adams', email: 'grant@inmarsystems.com' },
    { name: 'Ricky Whitfield', email: 'ricky@inmarsystems.com' }
  ];

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

  function emailForName(name) {
    for (var i = 0; i < STAFF.length; i++) if (STAFF[i].name === name) return STAFF[i].email;
    return '';
  }
  function nameForEmail(email) {
    var e = String(email || '').toLowerCase();
    for (var i = 0; i < STAFF.length; i++) if (STAFF[i].email === e) return STAFF[i].name;
    return '';
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
    var email = session.user.email || '';
    var mapped = nameForEmail(email);
    if (!mapped) {
      await client.auth.signOut();
      clearShift();
      signedInName = '';
      return false;
    }
    signedInName = mapped;
    try {
      var res = await client.from('profiles').select('full_name').eq('id', session.user.id).maybeSingle();
      if (res && res.data && res.data.full_name) signedInName = res.data.full_name;
    } catch (e) { /* profiles table arrives with the after-merge SQL */ }
    return true;
  }

  async function restore() {
    var result = await client.auth.getSession();
    return applySession(result && result.data && result.data.session);
  }

  async function signIn(email, password) {
    var allowed = nameForEmail(email);
    if (!allowed) return { error: { message: 'That login is not one of the five shop accounts.' } };
    var result = await client.auth.signInWithPassword({ email: email, password: password });
    if (result.error) return result;
    stampShift();
    await applySession(result.data.session);
    return result;
  }

  async function signOut() {
    clearShift();
    signedInName = '';
    await client.auth.signOut();
  }

  function fillStaffSelect(sel) {
    if (!sel || sel.dataset.filled) return;
    sel.dataset.filled = '1';
    sel.innerHTML = '<option value="">— Select —</option>' + STAFF.map(function (p) {
      return '<option value="' + p.email + '">' + p.name + '</option>';
    }).join('');
  }

  function bindLoginForm(onOk) {
    var form = document.getElementById('login-form');
    var who = document.getElementById('login-who');
    var email = document.getElementById('login-email');
    var pw = document.getElementById('login-password');
    var err = document.getElementById('login-error');
    var btn = document.getElementById('login-btn');
    if (!form || !pw || !btn) return;
    fillStaffSelect(who);
    function syncEmail() {
      if (email && who) email.value = who.value;
    }
    syncEmail();
    if (who) who.addEventListener('change', syncEmail);
    var busy = false;
    async function go() {
      if (busy) return;
      syncEmail();
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
      var result = await signIn(email.value, pw.value);
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
      if (pw.value && email && email.value) go();
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
