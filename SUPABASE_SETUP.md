# EVOLVE + Supabase setup

## Current integration status
The project remains a static GitHub Pages PWA. `auth.html` provides email registration, password login, session persistence/check, logout, reset-email requests, and explicit local snapshot upload/restore. `supabase-auth.js` uses only the browser Supabase JS client and the public Publishable key. `supabase/migrations/202611100001_evolve_schema.sql` creates owner-scoped tables and RLS policies.

**Not complete/verified:** the main `index.html` still reads and writes its existing app features directly in localStorage. The account page transfers a private full localStorage snapshot, but live per-feature synchronization between main app actions and normalized `workouts`, `lesson_progress`, `habits`, and `user_progress` tables is not wired yet. Do not treat cloud data as a live mirror until that adapter is completed. This repository change cannot run migrations or test against your Supabase project; no registration, database connectivity, or RLS runtime test is claimed.

## Configure the frontend
1. In Supabase, open **Project Settings → API** (or API Keys) and copy the project URL and **Publishable key** (`sb_publishable_...`).
2. Edit `supabase-config.js` in this repository and replace the two `PASTE_..._HERE` values. These are public client configuration values; never paste a Secret or `service_role` key.
3. Commit/publish the change. The config file is intentionally a placeholder until you supply your own project values.

## Configure Supabase
1. In **SQL Editor**, run `supabase/migrations/202611100001_evolve_schema.sql`.
2. In **Authentication → URL Configuration**, set the Site URL to `https://aleksaaleksa291-svg.github.io/Evolve-/` and add Redirect URL `https://aleksaaleksa291-svg.github.io/Evolve-/auth.html`. Add your local development URL if needed.
3. Under **Authentication → Providers → Email**, enable email/password; set confirmation behavior as desired. Configure SMTP for dependable production email delivery if using password reset/confirmation.
4. Review the SQL Editor result and **Table Editor → Policies**. All app tables should have RLS enabled with owner policies. Never disable RLS to make the app work.

## Use the account page and move existing local data
1. Publish the repo on GitHub Pages and visit `https://aleksaaleksa291-svg.github.io/Evolve-/auth.html`.
2. Register and confirm the email if requested; then sign in.
3. To preserve this browser's existing data, use **Sačuvaj lokalne podatke u nalog**. It writes one private JSON snapshot to `evolve_snapshots`, scoped by `auth.uid()`, and leaves local data untouched.
4. On another browser/device, sign in and choose **Učitaj nalog na ovaj uređaj**. This overwrites matching `evolve_*` localStorage keys on that device, so export a local backup first.

## PWA / hosting
The app and auth page remain static and can be served by GitHub Pages over HTTPS. The service worker cache is versioned to release the updated files and uses network-first navigation so new HTML can replace cached HTML. Supabase authentication and snapshot operations require network connectivity; the existing offline local app continues to work, but cloud sync is not an offline queue.

## Security notes
- Only the Publishable key belongs in `supabase-config.js`; it is designed for browser use and is not a secret.
- RLS is the data boundary. The SQL uses `auth.uid()` ownership checks on every user table, and the signup trigger only creates the new user's own profile/progress rows.
- Snapshot upload/restore operates only for the signed-in user and does not upload data automatically.
- XP and level values stored by a browser app can be edited by that user. RLS protects cross-user privacy, not against a user tampering with their own client-side XP. Authoritative anti-cheat scoring requires trusted server-side logic, which is not included.
- Password reset requires the Supabase redirect allowlist and working email delivery.
