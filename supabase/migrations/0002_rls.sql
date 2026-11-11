-- Row-level security.
-- Guests never sign in. The server verifies the cookie token and mints a short-lived
-- JWT with a guest_id claim; these policies key on that claim. Everything without a
-- policy is reachable only with the service-role key (server side).

create or replace function public.jwt_guest_id() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'guest_id', '')::uuid
$$;
create or replace function public.jwt_wedding_id() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'wedding_id', '')::uuid
$$;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Public vocabulary
create policy vocab_groups_read on attribute_groups for select using (true);
create policy vocab_families_read on colour_families for select using (true);
create policy vocab_values_read on attribute_values for select using (status = 'active');

-- A guest sees her wedding, its functions, and only her own rows
create policy wedding_read on weddings for select using (id = jwt_wedding_id());
create policy functions_read on functions for select using (wedding_id = jwt_wedding_id());
create policy guest_self_read on guests for select using (id = jwt_guest_id());
create policy outfits_own_read on outfits for select using (guest_id = jwt_guest_id());
create policy outfit_photos_own_read on outfit_photos for select
  using (exists (select 1 from outfits o where o.id = outfit_id and o.guest_id = jwt_guest_id()));
create policy outfit_attributes_own_read on outfit_attributes for select
  using (exists (select 1 from outfits o where o.id = outfit_id and o.guest_id = jwt_guest_id()));
create policy results_own_read on outfit_results for select using (guest_id = jwt_guest_id());
create policy requests_own_read on photo_requests for select using (guest_id = jwt_guest_id());

-- outfit_pairs, result_feedback, reference_*, label_pairs, ai_usage, settings, etc.
-- have no policies: service role only.
