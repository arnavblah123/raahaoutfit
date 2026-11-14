-- Sign-in before anything else: a mobile number (one-time code by SMS) or Google.
-- The host uploads the guest list as phone numbers; those numbers get straight in, everyone else asks.

alter table guests add column phone text;                                   -- E.164, e.g. +919876543210
alter table guests add column phone_verified boolean not null default false; -- true once proved by a one-time code
create unique index guests_phone_unique on guests (wedding_id, phone) where phone is not null;

-- The host's guest list. Server only.
create table guest_list (
  wedding_id uuid not null references weddings on delete cascade,
  phone text not null,
  name text,
  created_at timestamptz not null default now(),
  primary key (wedding_id, phone)
);
alter table guest_list enable row level security;
revoke all on guest_list from public, app_guest;

-- One-time codes. Only the hash is kept; rows are removed by the nightly purge job. Server only.
create table otp_codes (
  id bigint generated always as identity primary key,
  phone text not null,
  code_hash text not null,
  ip text,
  attempts int not null default 0,
  used boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on otp_codes (phone, created_at);
create index on otp_codes (ip, created_at);
create index on otp_codes (created_at);
alter table otp_codes enable row level security;
revoke all on otp_codes from public, app_guest;

-- The guest-facing role may read a guest's own row, but never the sign-in columns.
revoke select on guests from app_guest;
grant select (id, wedding_id, display_name, role, status, last_seen_at, created_at) on guests to app_guest;
