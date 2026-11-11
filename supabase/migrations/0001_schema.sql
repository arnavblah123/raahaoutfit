-- Outfit Clash: core schema
create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- vocabulary
create table attribute_groups (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  free_text boolean not null default false,   -- "Other" groups with no seed list
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table colour_families (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  neighbour_keys text[] not null default '{}',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table attribute_values (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references attribute_groups on delete cascade,
  value text not null,
  colour_family_id uuid references colour_families,
  swatch_hex text,
  status text not null default 'active' check (status in ('active','retired')),
  origin text not null default 'seed' check (origin in ('seed','promoted')),
  merged_into_id uuid references attribute_values,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create unique index attribute_values_unique on attribute_values (group_id, lower(value));

create table attribute_pending (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references attribute_groups on delete cascade,
  raw_value text not null,
  normalised_value text not null,
  proposed_by text not null check (proposed_by in ('guest','ai','admin')),
  occurrences int not null default 1,
  suggested_merge_id uuid references attribute_values,
  status text not null default 'pending' check (status in ('pending','approved','rejected','merged')),
  resolved_value_id uuid references attribute_values,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index attribute_pending_unique on attribute_pending (group_id, normalised_value);

-- ---------------------------------------------------------------- guest data
create table weddings (
  id uuid primary key default gen_random_uuid(),
  couple_names text not null,
  wedding_date date not null,
  city text not null,
  join_code text not null unique,
  colour_map_enabled boolean not null default false,
  purge_after date generated always as (wedding_date + 7) stored,
  purged_at timestamptz,
  purged_stats jsonb,                           -- anonymous counts kept after purge
  created_at timestamptz not null default now()
);

create table functions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  kind text not null check (kind in ('haldi','mehendi','sangeet','cocktail','engagement','wedding','reception','custom')),
  custom_name text,
  function_date date,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index on functions (wedding_id);

create table guests (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  display_name text not null,
  role text not null default 'guest' check (role in ('creator','guest')),
  token_hash text not null unique,
  recovery_token_hash text not null unique,
  auth_user_id uuid,                            -- reserved for Google sign-in
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index on guests (wedding_id);

create table outfits (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references weddings on delete cascade,
  function_id uuid not null references functions on delete cascade,
  guest_id uuid not null references guests on delete cascade,
  status text not null default 'read' check (status in ('read','confirmed')),
  garment_type_id uuid references attribute_values,
  colour_family_id uuid references colour_families,
  keep_for_training boolean not null default false,
  consent_at timestamptz,
  extra_rounds_used int not null default 0,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on outfits (function_id, status);
create index on outfits (guest_id);

create table outfit_photos (
  id uuid primary key default gen_random_uuid(),
  outfit_id uuid not null references outfits on delete cascade,
  kind text not null check (kind in ('full','closeup','extra')),
  storage_path text not null,
  width int, height int,
  bbox jsonb,
  embedding vector(768),
  embedding_model text,
  created_at timestamptz not null default now()
);
create index on outfit_photos (outfit_id);

create table outfit_attributes (
  id uuid primary key default gen_random_uuid(),
  outfit_id uuid not null references outfits on delete cascade,
  group_id uuid not null references attribute_groups,
  value_id uuid references attribute_values,
  other_text text,
  ai_suggested boolean not null default false,
  ai_confidence text check (ai_confidence in ('high','medium','low')),
  confirmed boolean not null default false,
  position int not null default 0,
  check (value_id is not null or other_text is not null)
);
create index on outfit_attributes (outfit_id);

-- Judge cache. Server-only: links two guests' outfits.
create table outfit_pairs (
  id uuid primary key default gen_random_uuid(),
  outfit_a_id uuid not null references outfits on delete cascade,   -- a < b
  outfit_b_id uuid not null references outfits on delete cascade,
  similarity real not null,
  shortlist_reason text,
  verdict text check (verdict in ('same_outfit','same_design_diff_colour','similar_look','no_clash')),
  confidence text check (confidence in ('high','medium','low')),
  reason text,
  missing_evidence text,
  limiting_outfit_id uuid references outfits on delete set null,
  rounds int not null default 0,
  settled boolean not null default false,
  judge_model text,
  inputs_hash text,
  judged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (outfit_a_id, outfit_b_id),
  check (outfit_a_id < outfit_b_id)
);
create index on outfit_pairs (outfit_b_id);

-- The only match data a guest can read. No link to the other outfit.
create table outfit_results (
  outfit_id uuid primary key references outfits on delete cascade,
  guest_id uuid not null references guests on delete cascade,
  verdict text not null check (verdict in ('same_outfit','same_design_diff_colour','similar_look','possible_clash','no_clash')),
  reason text,
  state text not null default 'final' check (state in ('final','needs_photo')),
  seen_at timestamptz,
  updated_at timestamptz not null default now()
);

create table photo_requests (
  id uuid primary key default gen_random_uuid(),
  outfit_id uuid not null references outfits on delete cascade,
  guest_id uuid not null references guests on delete cascade,
  kind text not null check (kind in ('followup','neutral_clarity')),
  requested_photo text not null,
  status text not null default 'open' check (status in ('open','fulfilled','closed')),
  created_at timestamptz not null default now()
);
create index on photo_requests (outfit_id, status);

create table result_feedback (
  id uuid primary key default gen_random_uuid(),
  outfit_id uuid references outfits on delete set null,
  pair_id uuid references outfit_pairs on delete set null,
  shown_verdict text not null,
  corrected_verdict text,
  note text,
  pair_snapshot jsonb,           -- attributes of both sides at the time (no names, no photos)
  admin_label text,
  created_at timestamptz not null default now()
);

create table rate_limit_events (
  id bigint generated always as identity primary key,
  guest_id uuid,
  wedding_id uuid,
  action text not null,
  created_at timestamptz not null default now()
);
create index on rate_limit_events (guest_id, action, created_at);
create index on rate_limit_events (wedding_id, action, created_at);

-- ---------------------------------------------------------------- reference data
create table partner_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  feed_type text not null check (feed_type in ('shopify','woocommerce','csv')),
  feed_url text,
  permission_date date,
  permission_note text,
  permission_file_path text,
  show_in_similar boolean not null default false,
  created_at timestamptz not null default now()
);

create table batch_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  status text not null default 'pending' check (status in ('pending','running','paused','done','cap_reached','failed')),
  total int not null default 0,
  done int not null default 0,
  failed int not null default 0,
  cost_cap_usd numeric(10,4) not null,
  cost_spent_usd numeric(10,4) not null default 0,
  params jsonb not null default '{}',
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table reference_outfits (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('raaha','indofashion','partner','own_stock')),
  brand_id uuid references partner_brands on delete cascade,
  external_id text not null,
  sku text,
  name text,
  price numeric(12,2),
  currency text,
  description text,
  permalink text,
  category text,
  dataset_label text,
  label_mismatch boolean,
  garment_type_id uuid references attribute_values,
  colour_family_id uuid references colour_families,
  guest_visible boolean generated always as (source in ('raaha','partner')) stored,
  status text not null default 'pending' check (status in ('pending','processed','failed','not_an_outfit')),
  batch_job_id uuid references batch_jobs on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index reference_outfits_unique on reference_outfits (source, coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), external_id);
create index on reference_outfits (status);

create table reference_photos (
  id uuid primary key default gen_random_uuid(),
  reference_outfit_id uuid not null references reference_outfits on delete cascade,
  storage_path text,
  source_url text,
  sort int not null default 0,
  embedding vector(768),
  embedding_model text,
  created_at timestamptz not null default now()
);
create index on reference_photos (reference_outfit_id);
create index reference_photos_embedding on reference_photos using hnsw (embedding vector_cosine_ops);

create table reference_attributes (
  id uuid primary key default gen_random_uuid(),
  reference_outfit_id uuid not null references reference_outfits on delete cascade,
  group_id uuid not null references attribute_groups,
  value_id uuid references attribute_values,
  other_text text,
  ai_confidence text check (ai_confidence in ('high','medium','low')),
  admin_corrected boolean not null default false,
  position int not null default 0,
  check (value_id is not null or other_text is not null)
);
create index on reference_attributes (reference_outfit_id);

create table attribute_corrections (
  id uuid primary key default gen_random_uuid(),
  reference_outfit_id uuid not null references reference_outfits on delete cascade,
  group_id uuid not null references attribute_groups,
  before jsonb not null,
  after jsonb not null,
  admin_email text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- learning
-- Consented crops kept after the purge, with no link to guest or wedding.
create table training_outfits (
  id uuid primary key,                 -- reuses the original outfit id so labels stay attached
  attributes jsonb not null,
  created_at timestamptz not null default now()
);
create table training_photos (
  id uuid primary key default gen_random_uuid(),
  training_outfit_id uuid not null references training_outfits on delete cascade,
  kind text not null,
  storage_path text not null
);

create table label_pairs (
  id uuid primary key default gen_random_uuid(),
  left_kind text not null check (left_kind in ('reference','guest','training')),
  left_id uuid not null,
  right_kind text not null check (right_kind in ('reference','guest','training')),
  right_id uuid not null,
  similarity real,
  judge_verdict text,
  judge_confidence text,
  picked_reason text,
  admin_label text check (admin_label in ('same_outfit','same_design_diff_colour','similar_look','different')),
  admin_email text,
  labelled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (left_kind, left_id, right_kind, right_id)
);

create table ai_usage (
  id bigint generated always as identity primary key,
  outfit_id uuid,
  reference_outfit_id uuid,
  batch_job_id uuid,
  step text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index on ai_usage (outfit_id);
create index on ai_usage (batch_job_id);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table threshold_log (
  id uuid primary key default gen_random_uuid(),
  old_value real,
  new_value real,
  sample_size int,
  metric jsonb,
  created_at timestamptz not null default now()
);

create table admins (
  email text primary key,
  user_id uuid,
  last_login_at timestamptz
);

-- Server-only values used by scheduled jobs (app URL and cron secret).
create table private_config (
  key text primary key,
  value text not null
);
