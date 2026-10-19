# SCENTVERSE v14

SCENTVERSE v14 keeps the existing 36 fragrance records, original photos, and full v13 experience at `/legacy-v13.html`, alongside the newer database-powered catalog. The photo discovery worker uses permitted Wikimedia Commons access and Supabase only; it does not call AI services or consume AI credits during normal operation. Auto-publication requires strong product, edition, image-description, and reuse-rights evidence. Anything uncertain remains private for review.

## Local preview

1. Use Node.js 20+ and run `npm install`, then `npm run dev`.
2. Open `http://localhost:3000`. Without database settings, the site uses the bundled catalog.
3. `/legacy-v13.html` opens the complete original version. `/admin/photos` is the secure photo and fragrance dashboard.

## Supabase setup

1. Create a Supabase project. Run `supabase/schema.sql` in its SQL editor. It is safe to rerun on an existing database: it adds attribution and worker fields, creates photo-run metrics, enqueues existing records with missing photos, and installs an insert trigger so every new fragrance gets a photo job.
2. Create a **public** Storage bucket named `fragrance-photos`. Only verified, rights-cleared images are copied there.
3. Set `SCENTVERSE_SUPABASE_URL` and the **server-only** `SCENTVERSE_SUPABASE_SECRET_KEY`, plus strong, separate random values for `ADMIN_API_TOKEN` and `CRON_SECRET`. Never expose the service key or either secret in a `NEXT_PUBLIC_` variable or commit `.env.local`.
4. Run `npm run seed` if you need the supplied 36 catalog records in the database. The seed command inserts only records that are absent and queues records that currently have no photo; it does not overwrite existing fragrance rows or photo jobs.

## Photo workflow

- Add a fragrance in `/admin/photos` or through `POST /api/admin/import` using an admin bearer token. New inserts are queued automatically by the database trigger, including inserts made outside the import API.
- The scheduled Vercel cron calls `GET /api/admin/photos/process` daily. Each run claims at most five jobs. Failed or unmatched jobs retry no more often than daily and stop after four attempts; Wikimedia `Retry-After` responses are honored, with bounded retries and deferred work when the requested wait is too long.
- Discovery searches Wikimedia Commons. A result can publish automatically only when its image description identifies the exact brand, fragrance, and concentration as a bottle/flacon, creator attribution is present, and Commons provides a supported license with a matching canonical license URL. Ambiguous, incomplete, or unsupported results remain unpublished for review.
- Basenotes automated discovery is paused because the site returned HTTP 403. No direct requests or third-party search-engine workarounds are made. Automated Basenotes discovery requires explicit permission or an official API; any Basenotes image must also have rights that Basenotes itself is authorized to grant, not merely display.
- The admin dashboard reports current missing-image, queued-job, and pending-review totals, plus each batch's checked, found, auto-published, needs-review, and error counts. Batch results are stored in `photo_runs`.
- In the dashboard, compare each review candidate with an authoritative reference and verify the exact edition and reuse license. Approval copies the image to Supabase Storage without overwriting an existing object or fragrance image, then retains creator/license/source attribution for the public catalog. Rejections remain unpublished.

## Deployment

Deploy the repository to Vercel and configure the same environment variables in project settings. `vercel.json` schedules photo processing daily at 09:00 UTC; Vercel sends the `CRON_SECRET` bearer token when configured. The scheduled route checks that secret, while the dashboard uses short-lived, signed, HttpOnly, SameSite=Strict admin cookies. For non-Vercel hosting, configure an equivalent daily scheduler to call the same route.

Wikimedia Commons and Basenotes may not have a rights-cleared photo for every commercial fragrance. Matching intentionally favors precision over recall. A missing match is not replaced with an AI-generated photo; it can be revisited manually or after adding another eligible, licensed source.
