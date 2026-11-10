import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

(() => {
  'use strict';
  const config = window.EVOLVE_SUPABASE_CONFIG || {};
  const requiredIds = ['toast'];
  if (!requiredIds.every(id => document.getElementById(id))) return;

  const css = document.createElement('style');
  css.textContent = `
    #evolve-cloud-panel{margin:0 0 14px;padding:14px 16px;border:1px solid #33534e;border-radius:16px;background:linear-gradient(130deg,#142a30,#122034);color:#f4f7fb;font:13px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    #evolve-cloud-panel .cloud-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    #evolve-cloud-panel .cloud-label{font-weight:750;color:#a4e66e}
    #evolve-cloud-panel .cloud-message{color:#bdc9d8;margin-top:5px}
    #evolve-cloud-panel .cloud-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
    #evolve-cloud-panel button,#evolve-cloud-panel a{font:700 12px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;border:1px solid #34445c;border-radius:10px;padding:8px 11px;background:#1a2639;color:#f4f7fb;text-decoration:none;cursor:pointer}
    #evolve-cloud-panel button.primary{background:#a4e66e;color:#102016;border-color:#a4e66e}
    #evolve-cloud-panel button:disabled{opacity:.55;cursor:wait}
    #evolve-cloud-panel .cloud-error{color:#ffb6b6}
    @media(max-width:650px){#evolve-cloud-panel{margin-bottom:12px;padding:12px}}
  `;
  document.head.append(css);

  const panel = document.createElement('section');
  panel.id = 'evolve-cloud-panel';
  panel.setAttribute('aria-live', 'polite');
  panel.innerHTML = '<div class="cloud-row"><span class="cloud-label">EVOLVE nalog</span><a href="./auth.html">Prijava / podešavanja naloga</a></div><div class="cloud-message">Proveravam Supabase vezu…</div><div class="cloud-actions"></div>';
  const messageNode = panel.querySelector('.cloud-message');
  const actionsNode = panel.querySelector('.cloud-actions');
  const header = document.querySelector('header');
  if (header) header.insertAdjacentElement('afterend', panel);

  const localPrefix = 'evolve_';
  const ownerKey = 'evolve_cloud_owner';
  let client = null;
  let session = null;
  let syncMode = false;
  let busy = false;
  let suppressLocalEvents = false;
  let timer = null;
  let syncingPromise = Promise.resolve();

  function message(text, isError = false) {
    messageNode.textContent = text;
    messageNode.classList.toggle('cloud-error', isError);
  }
  function showActions(items) {
    actionsNode.replaceChildren();
    items.forEach(({ label, run, primary = false, href }) => {
      const button = document.createElement(href ? 'a' : 'button');
      button.textContent = label;
      if (href) button.href = href;
      else {
        button.type = 'button';
        button.classList.toggle('primary', primary);
        button.addEventListener('click', run);
      }
      actionsNode.append(button);
    });
  }
  function isConfigured() {
    return typeof config.url === 'string' && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url) &&
      typeof config.publishableKey === 'string' && config.publishableKey.startsWith('sb_publishable_') &&
      !/secret|service_role/i.test(config.publishableKey);
  }
  function localPayload() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(localPrefix) && key !== ownerKey) data[key] = localStorage.getItem(key);
    }
    return data;
  }
  function hasAppData(payload = localPayload()) {
    return Object.keys(payload).some(key => key !== 'evolve_xpState' || payload[key] !== null);
  }
  function parsePayload(payload) {
    const out = {};
    for (const [key, raw] of Object.entries(payload || {})) {
      if (!key.startsWith(localPrefix) || key === ownerKey || typeof raw !== 'string') continue;
      try { out[key.slice(localPrefix.length)] = JSON.parse(raw); } catch { /* ignore malformed legacy item */ }
    }
    return out;
  }
  function uuidFromText(text) {
    let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
      h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193);
      h2 = Math.imul(h2 ^ text.charCodeAt(i), 0x85ebca6b);
    }
    const hex = (n => (n >>> 0).toString(16).padStart(8, '0'));
    const raw = (hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h1, h2))).slice(0, 32).split('');
    raw[12] = '5'; raw[16] = ((parseInt(raw[16], 16) & 3) | 8).toString(16);
    const value = raw.join('');
    return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
  }
  function dateFromWorkout(workout) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(workout.dateKey || '')) return workout.dateKey;
    return new Date().toISOString().slice(0, 10);
  }
  function setBusy(value) {
    busy = value;
    panel.querySelectorAll('button').forEach(button => button.disabled = value);
  }
  function friendlyError(error) {
    const text = String(error?.message || error || 'Nepoznata greška.');
    if (/Failed to fetch|network|fetch/i.test(text)) return 'Nema veze sa Supabase-om. Proveri internet i Project URL.';
    if (/relation .* does not exist|could not find the table/i.test(text)) return 'Supabase tabele nisu pronađene. Pokreni SQL migraciju iz projekta.';
    if (/row-level security|permission denied|not allowed/i.test(text)) return 'Supabase je odbio pristup. Proveri da li je SQL migracija i RLS pravilno podešen.';
    return text;
  }

  async function writeNormalizedData(uid, payload) {
    const data = parsePayload(payload);
    const xpState = data.xpState && typeof data.xpState === 'object' ? data.xpState : {};
    const xp = Math.max(0, Number(xpState.xp) || 0);
    const level = Math.floor(xp / 100) + 1;
    const workouts = Array.isArray(data.workouts) ? data.workouts : [];
    const lessons = Object.entries(data.completedLessons || xpState.completedLessons || {}).filter(([, done]) => !!done).map(([lesson_id]) => ({ user_id: uid, lesson_id }));
    const habits = Array.isArray(data.habitList) ? data.habitList : [];
    const checksByDate = data.habitChecks && typeof data.habitChecks === 'object' ? data.habitChecks : {};

    const profile = await client.from('profiles').upsert({ id: uid, email: session.user.email || '' }, { onConflict: 'id' });
    if (profile.error) throw profile.error;
    const progress = await client.from('user_progress').upsert({
      user_id: uid, xp, level,
      stats: { workouts: workouts.length, lessons: lessons.length, tasks: Object.values(data.tasks || {}).filter(Boolean).length },
      xp_state: xpState, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (progress.error) throw progress.error;

    if (workouts.length) {
      const rows = workouts.map((w, index) => {
        const stable = w.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(w.id)
          ? w.id : uuidFromText(`${uid}|workout|${index}|${JSON.stringify(w)}`);
        return { id: stable, user_id: uid, activity_type: String(w.type || 'Aktivnost').slice(0,100), minutes: Math.min(300,Math.max(1,Number(w.minutes)||1)), note: String(w.note||'').slice(0,100), activity_date: dateFromWorkout(w) };
      });
      const result = await client.from('workouts').upsert(rows, { onConflict: 'id' });
      if (result.error) throw result.error;
    }
    if (lessons.length) {
      const result = await client.from('lesson_progress').upsert(lessons, { onConflict: 'user_id,lesson_id' });
      if (result.error) throw result.error;
    }
    if (habits.length) {
      const existing = await client.from('habits').select('id,name').eq('user_id', uid);
      if (existing.error) throw existing.error;
      const byName = new Map((existing.data || []).map(row => [row.name, row.id]));
      for (const rawName of habits) {
        const name = String(rawName).trim().slice(0,100);
        if (!name) continue;
        let id = byName.get(name);
        if (!id) {
          const inserted = await client.from('habits').insert({ user_id: uid, name }).select('id').single();
          if (inserted.error) {
            if (!/duplicate|unique/i.test(inserted.error.message || '')) throw inserted.error;
            const again = await client.from('habits').select('id').eq('user_id',uid).eq('name',name).single();
            if (again.error) throw again.error;
            id = again.data.id;
          } else id = inserted.data.id;
          byName.set(name,id);
        }
        const index = habits.indexOf(rawName);
        const checks = [];
        for (const [day, values] of Object.entries(checksByDate)) {
          if (values && values[index] && /^\d{4}-\d{2}-\d{2}$/.test(day)) checks.push({ user_id: uid, habit_id: id, checked_on: day });
        }
        if (checks.length) {
          const result = await client.from('habit_checks').upsert(checks,{onConflict:'user_id,habit_id,checked_on'});
          if (result.error) throw result.error;
        }
      }
    }
  }

  async function uploadSnapshot() {
    if (!client || !session?.user || busy) return;
    const uid = session.user.id;
    const payload = localPayload();
    setBusy(true);
    try {
      const { error } = await client.from('evolve_snapshots').upsert({ user_id: uid, payload, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw error;
      await writeNormalizedData(uid, payload);
      localStorage.setItem(ownerKey, uid);
      syncMode = true;
      message('Sinhronizovano sa nalogom. Podaci ostaju i na ovom uređaju.');
      showActions([{ label: 'Nalog / odjava', href: './auth.html' }]);
    } catch (error) {
      syncMode = false;
      message('Sinhronizacija nije završena: ' + friendlyError(error), true);
      showActions([{ label: 'Pokušaj ponovo', run: uploadSnapshot, primary: true }, { label: 'Nalog', href: './auth.html' }]);
    } finally { setBusy(false); }
  }

  async function restoreSnapshot() {
    if (!client || !session?.user || busy) return;
    if (!confirm('Učitati kopiju iz naloga? EVOLVE podaci koji postoje na ovom uređaju biće zamenjeni. Napravi izvoz kao rezervnu kopiju pre nastavka.')) return;
    const uid = session.user.id;
    setBusy(true); suppressLocalEvents = true;
    try {
      const { data, error } = await client.from('evolve_snapshots').select('payload').eq('user_id', uid).maybeSingle();
      if (error) throw error;
      if (!data?.payload || typeof data.payload !== 'object') throw new Error('U ovom nalogu nema sačuvane kopije.');
      for (const [key, value] of Object.entries(data.payload)) {
        if (key.startsWith(localPrefix) && key !== ownerKey && typeof value === 'string') localStorage.setItem(key, value);
      }
      localStorage.setItem(ownerKey, uid);
      await writeNormalizedData(uid, data.payload);
      syncMode = true;
      message('Podaci iz naloga su učitani i sinhronizovani.');
      showActions([{ label: 'Otvori aplikaciju', href: './' }, { label: 'Nalog / odjava', href: './auth.html' }]);
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      syncMode = false;
      message('Nije moguće učitati podatke: ' + friendlyError(error), true);
      showActions([{ label: 'Pokušaj ponovo', run: restoreSnapshot, primary: true }, { label: 'Nalog', href: './auth.html' }]);
    } finally { suppressLocalEvents = false; setBusy(false); }
  }

  async function inspectAccount(user) {
    syncMode = false;
    actionsNode.replaceChildren();
    message(`Prijavljen/a si kao ${user.email || 'korisnik'}. Proveravam privatnu kopiju…`);
    const { data, error } = await client.from('evolve_snapshots').select('updated_at').eq('user_id', user.id).maybeSingle();
    if (error) {
      message('Nalog je prijavljen, ali baze još nije moguće proveriti: ' + friendlyError(error), true);
      showActions([{ label: 'Otvori podešavanja naloga', href: './auth.html' }]);
      return;
    }
    const localOwner = localStorage.getItem(ownerKey);
    const localHasData = hasAppData();
    if (localOwner === user.id && data) {
      syncMode = true;
      message('Nalog je povezan. Promene u EVOLVE-u čuvaćemo u ovom privatnom nalogu.');
      showActions([{ label: 'Sinhronizuj sada', run: uploadSnapshot, primary: true }, { label: 'Odjava i nalog', href: './auth.html' }]);
      scheduleSync(250);
    } else if (data) {
      message(localHasData ? 'Pronađena je kopija naloga i postoje lokalni podaci. Izaberi izvor — ništa se neće prepisati bez potvrde.' : 'Pronađena je kopija za ovaj nalog. Izaberi učitavanje podataka na uređaj.');
      showActions([
        { label: 'Sačuvaj ovaj uređaj u nalog', run: uploadSnapshot, primary: true },
        { label: 'Učitaj nalog na uređaj', run: restoreSnapshot },
        { label: 'Podešavanja / odjava', href: './auth.html' }
      ]);
    } else {
      message(localHasData ? 'Još nema cloud kopije. Sačuvaj lokalne podatke u nalog da uključiš sinhronizaciju.' : 'Nalog je spreman. Dodaj podatke ili sačuvaj praznu početnu kopiju.');
      showActions([{ label: 'Sačuvaj ovaj uređaj u nalog', run: uploadSnapshot, primary: true }, { label: 'Podešavanja / odjava', href: './auth.html' }]);
    }
  }

  function scheduleSync(delay = 1200) {
    if (!syncMode || !session?.user || suppressLocalEvents) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      syncingPromise = syncingPromise.then(uploadSnapshot).catch(error => message('Sinhronizacija nije uspela: ' + friendlyError(error), true));
    }, delay);
  }
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    originalSetItem.call(this, key, value);
    if (this === localStorage && String(key).startsWith(localPrefix) && key !== ownerKey) scheduleSync();
  };
  window.addEventListener('storage', event => {
    if (event.storageArea === localStorage && event.key?.startsWith(localPrefix) && event.key !== ownerKey) scheduleSync();
  });

  if (!isConfigured()) {
    message('Supabase konfiguracija nije validna. Proveri Project URL i Publishable key u supabase-config.js.', true);
    showActions([{ label: 'Podešavanja naloga', href: './auth.html' }]);
    return;
  }
  try {
    client = createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      if (!nextSession?.user) {
        syncMode = false;
        message('Nisi prijavljen/a. Podaci se čuvaju lokalno na ovom uređaju.');
        showActions([{ label: 'Prijava / registracija', href: './auth.html' }]);
        return;
      }
      setTimeout(() => inspectAccount(nextSession.user).catch(error => message('Greška pri proveri naloga: ' + friendlyError(error), true)), 0);
    });
    client.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      session = data.session;
      if (session?.user) return inspectAccount(session.user);
      message('Nisi prijavljen/a. Podaci se čuvaju lokalno na ovom uređaju.');
      showActions([{ label: 'Prijava / registracija', href: './auth.html' }]);
    }).catch(error => message('Supabase nije dostupan: ' + friendlyError(error), true));
  } catch (error) {
    message('Supabase nije mogao da se pokrene: ' + friendlyError(error), true);
  }
})();
