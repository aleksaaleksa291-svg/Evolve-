# EVOLVE + Supabase

## Šta je implementirano
- `supabase-config.js` sadrži Project URL i Publishable key za browser (nikad service_role/Secret).
- `auth.html` / `supabase-auth.js`: registracija, prijava, odjava, provera sesije, reset imejla i ručni prenos lokalne kopije.
- `supabase-sync.js`: Supabase veza u postojećoj početnoj stranici, status naloga, izbor između lokalne i cloud kopije, čuvanje snapshot-a i projekcija treninga, lekcija, navika i XP/statistike u RLS-zaštićene tabele.
- Service worker verzioniran je i ubacuje sync modul pri učitavanju postojeće `index.html` stranice; nije zamenjen postojeći app sadržaj niti PWA manifest.
- SQL migracija: `supabase/migrations/202611100001_evolve_schema.sql`.

## Važna ograničenja i status provere
Aplikacija ostaje localStorage-first. Kada se korisnik prijavi i izabere „Sačuvaj ovaj uređaj u nalog“, snapshot i normalizovane projekcije se šalju. Izbor ostaje eksplicitan da se ne bi slučajno prepisali podaci između različitih korisnika na istom telefonu. Posle uključivanja sinhronizacije, promene koje EVOLVE sačuva u localStorage automatski se prenose uz kratko kašnjenje. Nema offline queue-a, a brisanja/izmene istorijskih unosa nisu propagirana kao tombstones; ako koristiš više uređaja, izaberi izvor kopije promišljeno.

Nisam u mogućnosti iz ovog okruženja da pokrenem Supabase migraciju, registrujem probni nalog ili izvršim RLS test sa dva korisnika/Android uređaja. Zato nije potvrđeno da su tvoj projekat i RLS runtime spremni. XP je klijentski podatak i korisnik može menjati sopstveni rezultat; RLS sprečava pristup tuđim redovima, ne falsifikovanje sopstvenih XP.

## Jednokratno podešavanje u Supabase-u
1. Potvrdi da su `url` i `publishableKey` u `supabase-config.js` tačno Project URL i Publishable key iz **Project Settings → API**.
2. U **SQL Editor** pokreni `supabase/migrations/202611100001_evolve_schema.sql`.
3. U **Authentication → URL Configuration** postavi Site URL na `https://aleksaaleksa291-svg.github.io/Evolve-/` i dozvoli redirect `https://aleksaaleksa291-svg.github.io/Evolve-/auth.html`.
4. Uključi Email provider. Podesi potvrdu adrese i SMTP dostavu za produkcionu upotrebu.
5. U **Table Editor → Policies** potvrdi da su RLS uključena i owner policies postoje za sve tabele.

## Prvi prenos i test
1. Sačekaj GitHub Pages deploy, zatim u Chrome-u otvori `https://aleksaaleksa291-svg.github.io/Evolve-/` i `./auth.html`.
2. Napravi EVOLVE izvoz pre prve migracije naloga.
3. Registruj nalog, potvrdi imejl ako je uključeno, pa se prijavi.
4. U aplikaciji izaberi „Sačuvaj ovaj uređaj u nalog“ ili „Učitaj nalog na uređaj“; lokalni podaci se ne brišu pri upload-u.
5. Za RLS test napravi dva probna naloga. Svaki treba da vidi samo svoj profil/podatke; pokušaj čitanja tuđih redova mora vratiti prazan rezultat/odbijanje. Izvrši test iz prijavljenih browser sesija, ne service key-em.

GitHub Pages objavljuje klijentski config fajl javno. Supabase Publishable key je namenjen browseru, ali bezbednost zavisi od RLS-a. Nikada ne stavljaj Secret/service_role key u repo.
