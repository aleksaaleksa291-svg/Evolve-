import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.EVOLVE_SUPABASE_CONFIG || {};
const statusBox = document.querySelector('#status');
const authCard = document.querySelector('#authCard');
const accountCard = document.querySelector('#accountCard');
const migrationCard = document.querySelector('#migrationCard');
const redirectUrl = new URL('./auth.html', location.href).href;
let supabase = null;
let currentUser = null;

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
async function refreshSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  currentUser = data.session?.user || null;
  authCard.classList.toggle('hidden', !!currentUser);
  accountCard.classList.toggle('hidden', !currentUser);
  migrationCard.classList.toggle('hidden', !currentUser);
  if (currentUser) document.querySelector('#accountEmail').textContent = currentUser.email || 'Prijavljen korisnik';
}

if (!config.url || config.url.includes('PASTE_') || !config.publishableKey || config.publishableKey.includes('PASTE_')) {
  showMessage('Supabase nije podešen. U supabase-config.js unesi Project URL i Publishable key iz Supabase kontrolne table.', true);
  document.querySelectorAll('#signIn,#signUp,#resetPassword').forEach(button => button.disabled = true);
} else {
  try {
    supabase = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      authCard.classList.toggle('hidden', !!currentUser);
      accountCard.classList.toggle('hidden', !currentUser);
      migrationCard.classList.toggle('hidden', !currentUser);
      if (currentUser) document.querySelector('#accountEmail').textContent = currentUser.email || 'Prijavljen korisnik';
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
