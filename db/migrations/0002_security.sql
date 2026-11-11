-- Row-level security.
-- The app connects as the database owner, which bypasses these policies. For anything a guest
-- reads, the server switches to the restricted role app_guest inside a transaction and sets
-- app.guest_id / app.wedding_id, so Postgres itself limits her to her own rows and photos.
-- app_guest has SELECT on the guest-facing tables only, and no write access at all.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_guest') then create role app_guest nologin; end if;
end $$;
do $$ begin execute format('grant app_guest to %I', current_user); exception when others then null; end $$;

create or replace function public.current_guest_id() returns uuid
language sql stable as $$ select nullif(current_setting('app.guest_id', true), '')::uuid $$;
create or replace function public.current_wedding_id() returns uuid
language sql stable as $$ select nullif(current_setting('app.wedding_id', true), '')::uuid $$;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, app_guest', t);
  end loop;
end $$;

grant usage on schema public to app_guest;
grant select on attribute_groups, colour_families, attribute_values,
                weddings, functions, guests, outfits, outfit_photos, outfit_attributes,
                outfit_results, photo_requests
  to app_guest;

-- Public vocabulary
create policy vocab_groups_read on attribute_groups for select to app_guest using (true);
create policy vocab_families_read on colour_families for select to app_guest using (true);
create policy vocab_values_read on attribute_values for select to app_guest using (status = 'active');

-- A guest sees her wedding, its functions, and only her own rows
create policy wedding_read on weddings for select to app_guest using (id = current_wedding_id());
create policy functions_read on functions for select to app_guest using (wedding_id = current_wedding_id());
create policy guest_self_read on guests for select to app_guest using (id = current_guest_id());
create policy outfits_own_read on outfits for select to app_guest using (guest_id = current_guest_id());
create policy outfit_photos_own_read on outfit_photos for select to app_guest
  using (exists (select 1 from outfits o where o.id = outfit_id and o.guest_id = current_guest_id()));
create policy outfit_attributes_own_read on outfit_attributes for select to app_guest
  using (exists (select 1 from outfits o where o.id = outfit_id and o.guest_id = current_guest_id()));
create policy results_own_read on outfit_results for select to app_guest using (guest_id = current_guest_id());
create policy requests_own_read on photo_requests for select to app_guest using (guest_id = current_guest_id());

-- outfit_pairs, result_feedback, reference_*, label_pairs, ai_usage, settings and the rest
-- have neither a grant nor a policy for app_guest.
