# SCENTVERSE v14 — public website starter

A Next.js + Supabase starter based on the supplied SCENTVERSE v13. **Not yet deployed.** It preserves all 36 catalog records and 11 original embedded photos, exported as local files for the new website. The exact original v13 (including search, saved items, comparisons, photo credits and other features) is retained at `/legacy-v13.html`. The new database-powered catalog currently implements search, filters, sorting and bottle display; other v13 features are preserved in the legacy page but not yet migrated into the new interface.

## Local preview

1. Install Node.js 20+ and run `npm install`, then `npm run dev`.
2. Open `http://localhost:3000`. Without database settings, it uses the bundled 36-item catalog.
3. Open `/legacy-v13.html` to access the complete original version.

## Deploy for free

1. Create a **Supabase** project. Run `supabase/schema.sql` in its SQL editor. Create a public Storage bucket named `fragrance-photos` (only approved images go here).
2. Copy `.env.example` to `.env.local` and fill in the Supabase project URL, anon key and **server-only** service-role key. Generate separate random admin and cron secrets. Never put the service-role key in a `NEXT_PUBLIC_` variable or commit `.env.local`.
3. Run `npm run seed` (load the environment variables in your shell first). This inserts the 36 records and queues the 25 missing photos. In production, use the approved, source-credited images; see the note below about storage URLs.
4. Push this project to a GitHub repository. Import it into **Vercel**, set the same environment variables in project settings and deploy. Choose an available free `*.vercel.app` project address. No address has been reserved or deployed by this package.
5. Trigger photo discovery via `POST /api/admin/photos/process` with `Authorization: Bearer YOUR_CRON_SECRET` (or admin token). Schedule this with a hosting cron service at an appropriate interval, or run it manually. The route checks at most three jobs per call and limits retries. It **does not** publish unverified matches.
6. Review `photo_candidates` in Supabase. Compare source photos with official brand references, check concentrations and license conditions. Only then call `POST /api/admin/photos/approve` with an admin token and JSON `{"candidateId":123,"confirmedExactEdition":true,"confirmedLicense":true}`. This downloads the approved Wikimedia Commons image to your Supabase Storage and publishes its URL.
7. Add new products using `POST /api/admin/import` with admin token and JSON `{"items":[{"brand":"Example","name":"Sample","concentration":"Eau de Parfum","family":"Woody","notes":["Cedar"]}]}`. Limit 500 per request; imports queue new image jobs.

## Current limitations / next engineering steps

- Photo discovery currently searches **Wikimedia Commons only**, using conservative license filtering. It is a real discovery pipeline, but many commercial bottles won't have reusable photos. Licensed brand/retailer data feeds require separate agreements. Search results may be unrelated, so admin review is mandatory.
- Before production scale, add a proper admin dashboard, persistent license/attribution display for newly approved images, image review thumbnails, rate limiting, background job scheduling, CSV import, user accounts/favorites, and migration of the other v13 UI features. Current candidate attribution is returned from the approval endpoint and stored in `photo_candidates` but is not yet shown on public cards.
- The 11 bundled images are local paths. Seeded records use these paths, which work on the same Vercel deployment. Original license details remain in the preserved v13 page.
- This starter is not a verified production service, and no domain, hosting account, database, or cron job has been created for you.
