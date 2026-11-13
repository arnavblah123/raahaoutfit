-- Optional guest verification: host approval per wedding, and Google sign-in.
alter table weddings add column require_approval boolean not null default false;
alter table weddings add column require_google boolean not null default false;

alter table guests add column status text not null default 'approved' check (status in ('approved', 'pending', 'rejected'));
alter table guests add column google_sub text;
alter table guests add column email text;
create unique index guests_google_unique on guests (wedding_id, google_sub) where google_sub is not null;

-- Extra sign-ins for a guest (one per device that signs in with Google). Server only.
create table guest_sessions (
  token_hash text primary key,
  guest_id uuid not null references guests on delete cascade,
  created_at timestamptz not null default now()
);
create index on guest_sessions (guest_id);
alter table guest_sessions enable row level security;
revoke all on guest_sessions from public, app_guest;
