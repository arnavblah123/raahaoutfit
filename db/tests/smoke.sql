-- Smoke test for the SQL layer: shortlist, colour map, similar styles, vocabulary promotion, RLS.
-- Run against a scratch database after the migrations:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/smoke.sql
-- Everything happens in a transaction that is rolled back.
begin;

create function pg_temp.vec(a real, b real, c real) returns vector language sql as $$
  select ('[' || string_agg((case i when 1 then a when 2 then b when 3 then c else 0 end)::text, ',' order by i) || ']')::vector
  from generate_series(1, 768) i $$;
create function pg_temp.val(g text, v text) returns uuid language sql as $$
  select av.id from attribute_values av join attribute_groups ag on ag.id = av.group_id where ag.key = g and av.value = v $$;
create function pg_temp.fam(k text) returns uuid language sql as $$ select id from colour_families where key = k $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
  begin if ok is not true then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

insert into weddings (id, couple_names, wedding_date, city, join_code, colour_map_enabled)
  values ('00000000-0000-0000-0000-0000000000a1', 'A and B', current_date + 30, 'Jaipur', 'testcode1234', true);
insert into functions (id, wedding_id, kind) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'sangeet'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', 'wedding');
insert into guests (id, wedding_id, display_name, token_hash, recovery_token_hash)
  select ('00000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-0000000000a1', 'Guest ' || n, 't' || n, 'r' || n
  from generate_series(1, 4) n;

-- Outfit 1 (guest 1) is the one being checked. 2 is near-identical, 3 is far but shares garment type
-- and colour family, 4 is far and different, 5 is near-identical but at another function,
-- 6 is guest 1's own second option (never compared with her first).
insert into outfits (id, wedding_id, function_id, guest_id, status, colour_family_id, confirmed_at)
  select ('00000000-0000-0000-0000-0000000000' || lpad(o.n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-0000000000a1',
         ('00000000-0000-0000-0000-0000000000f' || o.f)::uuid, ('00000000-0000-0000-0000-00000000000' || o.g)::uuid,
         'confirmed', pg_temp.fam(o.family), now() - (o.n || ' minutes')::interval
  from (values (1, 1, 1, 'reds_pinks'), (2, 1, 2, 'reds_pinks'), (3, 1, 3, 'reds_pinks'), (4, 1, 4, 'blues'),
               (5, 2, 2, 'reds_pinks'), (6, 1, 1, 'reds_pinks')) as o(n, f, g, family);
insert into outfit_photos (outfit_id, kind, image, embedding)
  select ('00000000-0000-0000-0000-0000000000' || lpad(p.n::text, 2, '0'))::uuid, 'full', '\x00'::bytea, pg_temp.vec(p.a, p.b, p.c)
  from (values (1, 1, 0, 0), (2, 0.98, 0.2, 0), (3, 0, 1, 0), (4, 0, 0, 1), (5, 1, 0, 0), (6, 1, 0, 0)) as p(n, a, b, c);
insert into outfit_attributes (outfit_id, group_id, value_id, confirmed)
  select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, (select id from attribute_groups where key = 'garment_type'),
         pg_temp.val('garment_type', case when n = 4 then 'saree' else 'lehenga choli' end), true
  from generate_series(1, 6) n;

select pg_temp.check((select count(*) from shortlist_outfits('00000000-0000-0000-0000-000000000001', 1)) = 2,
  'shortlist = top 1 by similarity plus the outfit sharing garment type and colour family');
select pg_temp.check((select similarity > 0.97 and attr_match from shortlist_outfits('00000000-0000-0000-0000-000000000001', 1)
  where outfit_id = '00000000-0000-0000-0000-000000000002'), 'near-identical outfit is first, with its similarity');
select pg_temp.check((select similarity < 0.01 and attr_match from shortlist_outfits('00000000-0000-0000-0000-000000000001', 1)
  where outfit_id = '00000000-0000-0000-0000-000000000003'), 'attribute match is shortlisted even when the photos differ');
select pg_temp.check(not exists (select 1 from shortlist_outfits('00000000-0000-0000-0000-000000000001', 10)
  where outfit_id in ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006')),
  'other functions and the guest''s own outfits are never compared');

select pg_temp.check((select outfits from colour_map('00000000-0000-0000-0000-0000000000a1')
  where function_id = '00000000-0000-0000-0000-0000000000f1' and family_key = 'reds_pinks') = 4, 'colour map counts by family');

-- Similar styles: a clash with outfit 2 (reds). Products: one too close to another guest's outfit,
-- one in the clashing colour family, one IndoFashion row (never guest-visible), one good match.
insert into outfit_pairs (outfit_a_id, outfit_b_id, similarity, verdict, confidence, settled)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 0.98, 'same_outfit', 'high', true);
insert into reference_outfits (id, source, external_id, name, permalink, status, colour_family_id)
  select ('00000000-0000-0000-0000-0000000000b' || r.n)::uuid, r.source, 'p' || r.n, r.name, 'https://example.com/' || r.n, 'processed', pg_temp.fam(r.family)
  from (values (1, 'raaha', 'too close to guest 4', 'greens'), (2, 'raaha', 'same colour family as the clash', 'reds_pinks'),
               (3, 'indofashion', 'internal dataset row', 'greens'), (4, 'raaha', 'good suggestion', 'greens')) as r(n, source, name, family);
insert into reference_photos (reference_outfit_id, sort, source_url, embedding)
  select ('00000000-0000-0000-0000-0000000000b' || p.n)::uuid, 0, 'https://example.com/' || p.n || '.jpg', pg_temp.vec(p.a, p.b, p.c)
  from (values (1, 0.1, 0, 0.99), (2, 0.9, 0.1, 0.1), (3, 0.9, 0.3, 0.3), (4, 0.5, -0.6, 0.5)) as p(n, a, b, c);
select pg_temp.check((select array_agg(name) from similar_styles('00000000-0000-0000-0000-000000000001', 4, 0.6)) = array['good suggestion'],
  'similar styles skips clashing products, the clash colour family and internal dataset rows');

-- Learning helpers
select pg_temp.check((select count(*) from label_candidates(0.6, 10, 50)) between 1 and 6, 'labelling queue proposes reference pairs');
insert into label_pairs (left_kind, left_id, right_kind, right_id, similarity, admin_label)
  values ('reference', '00000000-0000-0000-0000-0000000000b2', 'reference', '00000000-0000-0000-0000-0000000000b3', 0.9, 'similar_look');
select pg_temp.check((select admin_label from similar_labelled_cases('guest', '00000000-0000-0000-0000-000000000001', 'guest', '00000000-0000-0000-0000-000000000002', 3)) = 'similar_look',
  'labelled cases are retrieved as judge examples');
select pg_temp.check(not exists (select 1 from label_candidates(0.6, 10, 50) where left_id = '00000000-0000-0000-0000-0000000000b2' and right_id = '00000000-0000-0000-0000-0000000000b3'),
  'already-labelled pairs are not offered again');
select pg_temp.check((select blank_share from reference_blank_share(null) where group_key = 'fabric') = 1, 'blank share per attribute');

-- Vocabulary: guest entries promote after N; the AI's own proposals never count.
do $$
declare g uuid := (select id from attribute_groups where key = 'motif'); r uuid;
begin
  for i in 1..10 loop perform record_pending_value(g, 'Lotus', 'ai', 3); end loop;
  perform pg_temp.check((select occurrences = 1 and status = 'pending' from attribute_pending where normalised_value = 'lotus'), 'AI proposals do not count towards promotion');
  perform record_pending_value(g, ' lotus ', 'guest', 3);
  r := record_pending_value(g, 'LOTUS', 'guest', 3);
  perform pg_temp.check(r is not null and exists (select 1 from attribute_values where id = r and value = 'lotus' and origin = 'promoted'), 'value is promoted after enough guest entries');
  perform pg_temp.check(record_pending_value(g, 'Floral', 'guest', 3) = pg_temp.val('motif', 'floral'), 'an existing value is returned, not queued');
end $$;

-- Row-level security: as the restricted role with guest 1's id, only her own rows are visible.
grant execute on function pg_temp.check(boolean, text) to app_guest;
set local role app_guest;
select set_config('app.guest_id', '00000000-0000-0000-0000-000000000001', true), set_config('app.wedding_id', '00000000-0000-0000-0000-0000000000a1', true);
select pg_temp.check((select count(*) from outfits) = 2, 'a guest reads only her own outfits');
select pg_temp.check((select count(*) from outfit_photos) = 2, 'a guest reads only her own photos');
select pg_temp.check((select count(*) from guests) = 1, 'a guest cannot list other guests');
select pg_temp.check((select count(*) from attribute_values) > 200, 'the vocabulary is readable');
do $$ declare t text; begin
  foreach t in array array['outfit_pairs', 'reference_outfits', 'settings', 'label_pairs', 'ai_usage', 'result_feedback', 'training_photos'] loop
    begin execute format('select count(*) from %I', t); raise exception 'FAILED: guest role could read %', t;
    exception when insufficient_privilege then raise notice 'ok: guest role cannot read %', t; end;
  end loop;
  begin perform * from shortlist_outfits('00000000-0000-0000-0000-000000000001', 5); raise exception 'FAILED: guest could call shortlist_outfits';
  exception when insufficient_privilege then raise notice 'ok: server-only functions are not callable by the guest role'; end;
  begin update outfits set status = 'read'; raise exception 'FAILED: guest role could update outfits';
  exception when insufficient_privilege then raise notice 'ok: the guest role cannot write'; end;
  begin delete from outfit_photos; raise exception 'FAILED: guest role could delete photos';
  exception when insufficient_privilege then raise notice 'ok: the guest role cannot delete'; end;
end $$;
reset role;

rollback;
