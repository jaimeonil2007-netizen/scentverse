# SCENTVERSE v14

SCENTVERSE v14 keeps the existing 36 fragrance records, original photos, and full v13 experience at `/legacy-v13.html`, alongside the newer database-powered catalog. The photo discovery worker uses Wikimedia Commons and Supabase only; it does not call AI services or consume AI credits during normal operation. Nothing discovered is published without an administrator verifying the exact edition and license.

## Local preview

1. Use Node.js 20+ and run `npm install`, then `npm run dev`.
2. Open `http://localhost:3000`. Without database settings, the site uses the bundled catalog.
3. `/legacy-v13.html` opens the complete original version. `/admin/photos` is the secure photo and fragrance dashboard.

## Supabase setup

1. Create a Supabase project. Run `supabase/schema.sql` in its SQL editor. It is safe to rerun on an existing database: it adds attribution and worker fields, enqueues existing records with missing photos, and installs an insert trigger so every new fragrance gets a photo job.
2. Create a **public** Storage bucket named `fragrance-photos`. Only manually approved images are copied there.
3. Configure `.env.local` from `.env.example` with `NEXT_PUBLIC_SUPABASE_URL`, the anon key, and the **server-only** service-role key. Set strong, separate random values for `ADMIN_API_TOKEN` and `CRON_SECRET`. Never expose the service-role key or either secret in a `NEXT_PUBLIC_` variable or commit `.env.local`.
4. Run `npm run seed` if you need the supplied 36 catalog records in the database. The seed command inserts only records that are absent and queues records that currently have no photo; it does not overwrite existing fragrance rows or photo jobs.

## Photo workflow

- Add a fragrance in `/admin/photos` or through `POST /api/admin/import` using an admin bearer token. New inserts are queued automatically by the database trigger, including inserts made outside the import API.
- The scheduled Vercel cron calls `GET /api/admin/photos/process` daily. It can also be run manually from the dashboard or with a `Bearer $CRON_SECRET` / admin bearer token. Each run claims up to three jobs; failed or unmatched jobs retry no more often than daily and stop after four attempts.
- Discovery searches Wikimedia Commons for titles containing the exact brand and fragrance name and compatible concentration. Only CC0, CC BY 3.0/4.0, CC BY-SA 3.0/4.0, and public-domain results are shown. Commons metadata is not treated as proof of the bottle identity: candidates remain private until review.
- In the dashboard, compare each candidate with an authoritative reference and verify the license conditions. Approving copies the image to Supabase Storage, updates the fragrance photo, and retains creator/license/source attribution for the public catalog. Rejections remain unpublished.

## Deployment

Deploy the repository to Vercel and configure the same environment variables in project settings. `vercel.json` schedules photo processing daily at 09:00 UTC; Vercel sends the `CRON_SECRET` bearer token when configured. The scheduled route checks that secret, while the dashboard uses short-lived, signed, HttpOnly, SameSite=Strict admin cookies. For non-Vercel hosting, configure an equivalent daily scheduler to call the same route.

Wikimedia Commons contains limited reusable commercial bottle photography, and exact-title filtering intentionally favors precision over recall. A missing match is not replaced with an AI-generated photo; it can be revisited manually or after adding another licensed source.
