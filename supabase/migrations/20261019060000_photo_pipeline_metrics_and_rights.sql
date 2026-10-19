begin;

alter table public.photo_jobs
 add column if not exists next_attempt_at timestamptz;

alter table public.photo_candidates
 add column if not exists rights_basis text;

create table if not exists public.photo_runs (
 id bigint generated always as identity primary key,
 checked int not null default 0,
 found int not null default 0,
 auto_published int not null default 0,
 needs_review int not null default 0,
 errors int not null default 0,
 completed_at timestamptz not null default now()
);

alter table public.photo_runs enable row level security;

commit;
