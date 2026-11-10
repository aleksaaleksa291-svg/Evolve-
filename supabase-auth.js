import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.EVOLVE_SUPABASE_CONFIG || {};
const statusBox = document.querySelector('#status');
const authCard = document.querySelector('#authCard');
const accountCard = document.querySelector('#accountCard');
const migrationCard = document.querySelector('#migrationCard');
const redirectUrl = window.location.origin + window.location.pathname;
let supabase = null;
let currentUser = null;
let profileSync = Promise.resolve();
let profileSyncUserId = null;

function showMessage(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle('error', isError);
}
function setBusy(isBusy) {
  document.body.classList.toggle('loader', isBusy);
  document.querySelectorAll('button').forEach(button => button.disabled = isBusy);
}
function humanError(error) {
  const message = String(error?.message || 'Nepoznata greška.');
  if (/invalid login credentials/i.test(message)) return 'Imejl ili lozinka nisu ispravni.';
  if (/email not confirmed/i.test(message)) return 'Potvrdi imejl adresu preko linka koji ti je poslat.';
  if (/user already registered/i.test(message)) return 'Nalog sa ovom imejl adresom već postoji. Pokušaj prijavu.';
  if (/password should be at least/i.test(message)) return 'Lozinka mora da ima najmanje 8 znakova.';
  if (/provider is not enabled|unsupported provider/i.test(message)) return 'Google prijava nije uključena u Supabase podešavanjima.';
  if (/redirect.*(not allowed|allowlist)|invalid redirect/i.test(message)) return 'Povratna adresa nije dozvoljena. Dodaj je u Supabase Authentication → URL Configuration.';
  if (/fetch|network/i.test(message)) return 'Veza sa Supabase-om nije dostupna. Proveri internet i podešavanja.';
  return message;
}
function getLocalData() {
  const data = {};
  for (let i=0; i<localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('evolve_')) data[key] = localStorage.getItem(key);
  }
  return data;
}
async function ensureProfile(user) {
  if (!user?.id || !supabase) return;
  if (profileSyncUserId === user.id) return profileSync;
  profileSyncUserId = user.id;
  profileSync = (async () => {
    const displayName = user.user_metadata?.full_name || user.user_metadata?.name || '';
    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email || '',
      ...(displayName ? { display_name: displayName } : {})
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  })().catch(error => {
    profileSyncUserId = null;
    throw error;
  });
  return profileSync;
}
function setAccountUI(user) {
  currentUser = user || null;
  authCard.classList.toggle('hidden', !!currentUser);
  accountCard.classList.toggle('hidden', !currentUser);
  migrationCard.classList.toggle('hidden', !currentUser);
  if (currentUser) document.querySelector('#accountEmail').textContent = currentUser.email || 'Prijavljen korisnik';
}
function addGoogleButton() {
  if (!authCard || document.querySelector('#googleSignIn')) return;
  const style = document.createElement('style');
  style.textContent = `
    .google-auth-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;margin:0 0 15px;padding:11px 14px;border:1px solid #39465a;border-radius:12px;background:#f8fafc;color:#172033;font:700 14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer}
    .google-auth-btn:hover{background:#e9eef5}.google-auth-btn:disabled{opacity:.6;cursor:wait}.auth-divider{display:flex;align-items:center;gap:10px;color:#9aa8bd;font-size:11px;margin:8px 0 12px}.auth-divider:before,.auth-divider:after{content:'';height:1px;flex:1;background:#25334a}
  `;
  document.head.append(style);
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'googleSignIn';
  button.className = 'google-auth-btn';
  button.innerHTML = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.74 7.18l7.65 5.93c4.47-4.13 7.13-10.2 7.13-17.58z"/><path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.87l-7.65-5.93c-2.13 1.43-4.85 2.28-8.25 2.28-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Nastavi preko Google-a</span>';
  const divider = document.createElement('div');
  divider.className = 'auth-divider';
  divider.textContent = 'ili imejlom';
  const emailLabel = authCard.querySelector('label[for="email"]');
  if (emailLabel) { authCard.insertBefore(divider, emailLabel); authCard.insertBefore(button, divider); }
  else authCard.prepend(button);
  button.addEventListener('click', startGoogleSignIn);
}
async function startGoogleSignIn() {
  if (!supabase) return;
  setBusy(true);
  showMessage('Preusmeravam na Google…');
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw error;
  } catch (error) {
    showMessage(humanError(error), true);
    setBusy(false);
  }
}
async function refreshSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const user = data.session?.user || null;
  setAccountUI(user);
  if (user) await ensureProfile(user);
}

addGoogleButton();
if (!config.url || config.url.includes('PASTE_') || !config.publishableKey || config.publishableKey.includes('PASTE_')) {
  showMessage('Supabase nije podešen. U supabase-config.js unesi Project URL i Publishable key iz Supabase kontrolne table.', true);
  document.querySelectorAll('#signIn,#signUp,#resetPassword,#googleSignIn').forEach(button => button.disabled = true);
} else {
  try {
    supabase = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user || null;
      setAccountUI(user);
      if (user) setTimeout(() => ensureProfile(user).catch(error => showMessage('Prijava je uspela, ali profil nije potvrđen: ' + humanError(error), true)), 0);
      else profileSyncUserId = null;
    });
    refreshSession().catch(error => showMessage(humanError(error), true));
  } catch (error) { showMessage(humanError(error), true); }
}

async function runAuth(action) {
  if (!supabase) return;
  setBusy(true); showMessage('Obrada zahteva…');
  try {
    const email = document.querySelector('#email').value.trim();
    const password = document.querySelector('#password').value;
    if (!email) throw new Error('Unesi imejl adresu.');
    let result;
    if (action === 'signup') {
      if (password.length < 8) throw new Error('Lozinka mora da ima najmanje 8 znakova.');
      result = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl } });
      if (result.error) throw result.error;
      showMessage(result.data.session ? 'Registracija je uspešna i prijavljeni ste.' : 'Registracija je pokrenuta. Proveri imejl i potvrdi adresu, zatim se prijavi.');
    } else if (action === 'signin') {
      result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      showMessage('Uspešno si prijavljen/a.');
    } else {
      result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
      if (result.error) throw result.error;
      showMessage('Ako nalog postoji, poslat je link za reset lozinke. Proveri imejl.');
    }
  } catch (error) { showMessage(humanError(error), true); }
  finally { setBusy(false); }
}
document.querySelector('#signIn').addEventListener('click', () => runAuth('signin'));
document.querySelector('#signUp').addEventListener('click', () => runAuth('signup'));
document.querySelector('#resetPassword').addEventListener('click', () => runAuth('reset'));
document.querySelector('#signOut').addEventListener('click', async () => {
  setBusy(true); try { const { error } = await supabase.auth.signOut(); if (error) throw error; showMessage('Odjavljen/a si.'); await refreshSession(); }
  catch (error) { showMessage(humanError(error), true); } finally { setBusy(false); }
});
document.querySelector('#uploadLocal').addEventListener('click', async () => {
  if (!supabase || !currentUser) return;
  const data = getLocalData();
  if (!Object.keys(data).length) { showMessage('Na ovom uređaju nema lokalnih EVOLVE podataka za prenos.', true); return; }
  setBusy(true); showMessage('Čuvam podatke u privatnom nalogu…');
  try {
    const { data: existing, error: readError } = await supabase.from('evolve_snapshots').select('updated_at').eq('user_id', currentUser.id).maybeSingle();
    if (readError) throw readError;
    if (existing && !confirm('Za ovaj nalog već postoji rezervna kopija. Zameni je kopijom sa ovog uređaja?')) return;
    const { error } = await supabase.from('evolve_snapshots').upsert({ user_id: currentUser.id, payload: data, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    showMessage('Lokalna kopija je sačuvana u nalog. Podaci na ovom uređaju nisu obrisani.');
  } catch (error) { showMessage(humanError(error), true); }
  finally { setBusy(false); }
});
document.querySelector('#restoreCloud').addEventListener('click', async () => {
  if (!supabase || !currentUser) return;
  if (!confirm('Učitati kopiju naloga na ovaj uređaj? Postojeći lokalni podaci sa istim ključevima biće zamenjeni. Najpre izvezi rezervnu kopiju ako želiš da ih sačuvaš.')) return;
  setBusy(true); showMessage('Učitavam privatnu kopiju…');
  try {
    const { data, error } = await supabase.from('evolve_snapshots').select('payload').eq('user_id', currentUser.id).maybeSingle();
    if (error) throw error;
    if (!data?.payload || typeof data.payload !== 'object') { showMessage('Za ovaj nalog još nema sačuvane kopije.', true); return; }
    for (const [key, value] of Object.entries(data.payload)) {
      if (key.startsWith('evolve_') && typeof value === 'string') localStorage.setItem(key, value);
    }
    showMessage('Podaci su učitani. Otvaram EVOLVE…');
    setTimeout(() => location.href = './', 700);
  } catch (error) { showMessage(humanError(error), true); }
  finally { setBusy(false); }
});
