-- SQL helpers used by the server (service role).

-- One "primary" embedding per item, across guest and reference data.
create or replace view item_embeddings with (security_invoker = true) as
  select 'guest'::text as kind, outfit_id as id, embedding
    from outfit_photos where kind = 'full' and embedding is not null
  union all
  select 'reference'::text, reference_outfit_id, embedding
    from reference_photos where sort = 0 and embedding is not null;

-- Step 2: shortlist within the same function. Top-N by cosine similarity plus any
-- outfit sharing a garment type and the colour family.
create or replace function shortlist_outfits(p_outfit uuid, p_top int default 5)
returns table (outfit_id uuid, similarity real, attr_match boolean)
language sql stable as $$
  with me as (select * from outfits where id = p_outfit),
  others as (
    select o.* from me join outfits o
      on o.function_id = me.function_id and o.id <> me.id
     and o.guest_id <> me.guest_id and o.status = 'confirmed'
  ),
  sims as (
    select o.id, max(1 - (p.embedding <=> q.embedding))::real as sim
    from others o
    join outfit_photos p on p.outfit_id = o.id and p.embedding is not null
    join outfit_photos q on q.outfit_id = p_outfit and q.embedding is not null
     and (q.kind = p.kind or q.kind = 'extra' or p.kind = 'extra')
    group by o.id
  ),
  attr as (
    select o.id from others o, me
    where o.colour_family_id is not null and o.colour_family_id = me.colour_family_id
      and exists (
        select 1 from outfit_attributes a1
        join outfit_attributes a2 on a2.value_id = a1.value_id
        join attribute_groups g on g.id = a1.group_id and g.key = 'garment_type'
        where a1.outfit_id = p_outfit and a2.outfit_id = o.id and a1.confirmed and a2.confirmed)
  ),
  ranked as (select s.*, row_number() over (order by s.sim desc) as rn from sims s)
  select r.id, r.sim, exists (select 1 from attr a where a.id = r.id)
  from ranked r
  where r.rn <= p_top or exists (select 1 from attr a where a.id = r.id)
$$;

-- Optional colour map: counts only.
create or replace function colour_map(p_wedding uuid)
returns table (function_id uuid, family_key text, family_label text, outfits bigint)
language sql stable as $$
  select o.function_id, f.key, f.label, count(*)
  from outfits o join colour_families f on f.id = o.colour_family_id
  where o.wedding_id = p_wedding and o.status = 'confirmed'
  group by o.function_id, f.key, f.label, f.sort
  order by o.function_id, f.sort
$$;

-- "See similar styles": nearest guest-visible products that do not clash with anyone
-- at the function. Never returns IndoFashion rows (guest_visible is false for them).
create or replace function similar_styles(p_outfit uuid, p_n int default 4, p_threshold real default 0.6)
returns table (id uuid, name text, price numeric, currency text, permalink text, source text,
               brand text, image_url text, storage_path text, similarity real)
language sql stable as $$
  with me as (select * from outfits where id = p_outfit),
  q as (select embedding from outfit_photos
        where outfit_id = p_outfit and embedding is not null
        order by (kind = 'full') desc limit 1),
  clash_families as (
    select o.colour_family_id
    from outfit_pairs p
    join outfits o on o.id = case when p.outfit_a_id = p_outfit then p.outfit_b_id else p.outfit_a_id end
    where p_outfit in (p.outfit_a_id, p.outfit_b_id)
      and p.verdict is not null and p.verdict <> 'no_clash' and o.colour_family_id is not null
  ),
  others as (
    select ph.embedding from me
    join outfits o on o.function_id = me.function_id and o.guest_id <> me.guest_id and o.status = 'confirmed'
    join outfit_photos ph on ph.outfit_id = o.id and ph.kind = 'full' and ph.embedding is not null
  )
  select r.id, r.name, r.price, r.currency, r.permalink, r.source, b.name,
         rp.source_url, rp.storage_path, (1 - (rp.embedding <=> q.embedding))::real
  from q, reference_outfits r
  join reference_photos rp on rp.reference_outfit_id = r.id and rp.sort = 0 and rp.embedding is not null
  left join partner_brands b on b.id = r.brand_id
  where r.guest_visible and r.status = 'processed' and r.permalink is not null
    and (r.source = 'raaha' or coalesce(b.show_in_similar, false))
    and (r.colour_family_id is null or r.colour_family_id not in (select colour_family_id from clash_families))
    and not exists (select 1 from others o where 1 - (rp.embedding <=> o.embedding) >= p_threshold)
  order by rp.embedding <=> q.embedding
  limit p_n
$$;

-- Learning: the admin-labelled pairs most similar to the pair being judged.
create or replace function similar_labelled_cases(p_a_kind text, p_a uuid, p_b_kind text, p_b uuid, p_n int default 3)
returns table (label_pair_id uuid, admin_label text, score real,
               left_kind text, left_id uuid, right_kind text, right_id uuid)
language sql stable as $$
  with a as (select embedding from item_embeddings where kind = p_a_kind and id = p_a limit 1),
       b as (select embedding from item_embeddings where kind = p_b_kind and id = p_b limit 1)
  select lp.id, lp.admin_label,
         (greatest((1 - (l.embedding <=> a.embedding)) + (1 - (r.embedding <=> b.embedding)),
                   (1 - (l.embedding <=> b.embedding)) + (1 - (r.embedding <=> a.embedding))) / 2)::real as score,
         lp.left_kind, lp.left_id, lp.right_kind, lp.right_id
  from a, b, label_pairs lp
  join item_embeddings l on l.kind = lp.left_kind and l.id = lp.left_id
  join item_embeddings r on r.kind = lp.right_kind and r.id = lp.right_id
  where lp.admin_label is not null
    and not (lp.left_id in (p_a, p_b) and lp.right_id in (p_a, p_b))
  order by score desc
  limit p_n
$$;

-- Labelling queue: reference pairs whose similarity is closest to the current threshold.
create or replace function label_candidates(p_threshold real, p_n int default 20, p_sample int default 150)
returns table (left_id uuid, right_id uuid, similarity real)
language sql volatile as $$
  with sample as (
    select rp.reference_outfit_id as id, rp.embedding
    from reference_photos rp
    where rp.sort = 0 and rp.embedding is not null
    order by random() limit p_sample
  ),
  nn as (
    select s.id as l, n.id as r, n.sim
    from sample s cross join lateral (
      select rp.reference_outfit_id as id, (1 - (rp.embedding <=> s.embedding))::real as sim
      from reference_photos rp
      where rp.sort = 0 and rp.embedding is not null and rp.reference_outfit_id <> s.id
      order by rp.embedding <=> s.embedding limit 8) n
  ),
  pairs as (select least(l, r) as l, greatest(l, r) as r, max(sim) as sim from nn group by 1, 2)
  select p.l, p.r, p.sim from pairs p
  where not exists (
    select 1 from label_pairs lp
    where lp.left_kind = 'reference' and lp.right_kind = 'reference'
      and lp.left_id = p.l and lp.right_id = p.r)
  order by abs(p.sim - p_threshold)
  limit p_n
$$;

-- Nearest reference neighbours for the evaluation script (top-k retrieval).
create or replace function nearest_reference(p_embedding vector(768), p_n int default 5, p_source text default null)
returns table (reference_outfit_id uuid, external_id text, similarity real)
language sql stable as $$
  select r.id, r.external_id, (1 - (rp.embedding <=> p_embedding))::real
  from reference_photos rp join reference_outfits r on r.id = rp.reference_outfit_id
  where rp.embedding is not null and (p_source is null or r.source = p_source)
  order by rp.embedding <=> p_embedding
  limit p_n
$$;

-- Vocabulary learning: record an "other" value; auto-promote after N occurrences.
create or replace function record_pending_value(p_group uuid, p_raw text, p_by text, p_promote_after int default 5)
returns uuid language plpgsql as $$
declare v_norm text := lower(regexp_replace(btrim(p_raw), '\s+', ' ', 'g'));
        v_existing uuid; v_pending attribute_pending; v_new uuid;
begin
  if v_norm = '' then return null; end if;
  select id into v_existing from attribute_values where group_id = p_group and lower(value) = v_norm;
  if v_existing is not null then return v_existing; end if;
  insert into attribute_pending (group_id, raw_value, normalised_value, proposed_by)
    values (p_group, btrim(p_raw), v_norm, p_by)
  on conflict (group_id, normalised_value)
    -- Only guest or admin entries count towards promotion; the model's own proposals never do.
    do update set occurrences = attribute_pending.occurrences + (case when p_by = 'ai' then 0 else 1 end)
  returning * into v_pending;
  if v_pending.status = 'merged' or v_pending.status = 'approved' then return v_pending.resolved_value_id; end if;
  -- A value the merge pass thinks is a spelling of an existing one waits for the admin instead.
  if p_by <> 'ai' and v_pending.status = 'pending' and v_pending.suggested_merge_id is null
     and v_pending.occurrences >= p_promote_after then
    insert into attribute_values (group_id, value, origin, sort) values (p_group, v_norm, 'promoted', 9999)
      returning id into v_new;
    update attribute_pending set status = 'approved', resolved_value_id = v_new, resolved_at = now()
      where id = v_pending.id;
    return v_new;
  end if;
  return null;
end $$;

-- Keep these off the public API: service role only.
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('shortlist_outfits','colour_map','similar_styles','similar_labelled_cases',
                               'label_candidates','nearest_reference','record_pending_value') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
