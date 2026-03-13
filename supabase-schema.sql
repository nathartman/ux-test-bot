-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)

create table pain_points (
  id uuid default gen_random_uuid() primary key,
  description text not null,
  area text,
  tags text[] default '{}',
  severity text check (severity in ('High', 'Medium', 'Low')),
  session_date text,
  participant_name text,
  source_ticket_title text,
  source_ticket_description text,
  zoom_link text,
  zoom_passcode text,
  suggested_timestamp_ms bigint,
  created_at timestamptz default now()
);

-- Index for common queries
create index pain_points_area_idx on pain_points (area);
create index pain_points_created_at_idx on pain_points (created_at desc);

-- Allow anonymous read/write (internal tool, no auth needed)
alter table pain_points enable row level security;

create policy "Allow all access" on pain_points
  for all
  using (true)
  with check (true);

-- Sessions table for persisting UX testing sessions
create table sessions (
  id uuid default gen_random_uuid() primary key,
  participant_name text not null,
  session_date text,
  zoom_link text,
  zoom_passcode text,
  facilitator_notes text default '',
  transcript_id text,
  audio_url text,
  transcript jsonb,
  notes_markdown text default '',
  tickets jsonb default '[]',
  proposed_tickets jsonb default '[]',
  status text default 'uploading',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index sessions_created_at_idx on sessions (created_at desc);

alter table sessions enable row level security;

create policy "Allow all access" on sessions
  for all
  using (true)
  with check (true);

-- Screenshot storage bucket
insert into storage.buckets (id, name, public)
values ('session-screenshots', 'session-screenshots', true)
on conflict (id) do nothing;

create policy "Allow all access" on storage.objects
  for all
  using (bucket_id = 'session-screenshots')
  with check (bucket_id = 'session-screenshots');
