-- Jobs and assets schema for Supabase Postgres
-- Run once in Supabase SQL Editor

create extension if not exists "uuid-ossp";

create table if not exists public.jobs (
  id uuid primary key default uuid_generate_v4(),
  status text not null check (status in ('PENDING','RUNNING','COMPLETE','FAILED')),
  request_url text,
  audio_storage_key text,
  transcription_storage_key text,
  error_message text,
  idempotency_key text,
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_jobs_status on public.jobs(status);
create index if not exists idx_jobs_idem on public.jobs(idempotency_key);
create index if not exists idx_jobs_hash on public.jobs(content_hash);

create table if not exists public.assets (
  content_hash text primary key,
  audio_storage_key text,
  transcription_storage_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- trigger to update updated_at
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_jobs_updated on public.jobs;
create trigger trg_jobs_updated before update on public.jobs
for each row execute procedure set_updated_at();

drop trigger if exists trg_assets_updated on public.assets;
create trigger trg_assets_updated before update on public.assets
for each row execute procedure set_updated_at();


