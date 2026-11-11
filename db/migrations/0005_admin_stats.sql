-- Aggregates for the admin pages.

-- Share of processed reference outfits with no value for each attribute group.
create or replace function reference_blank_share(p_source text default null)
returns table (group_key text, group_label text, blank_share real)
language sql stable as $$
  with o as (select id from reference_outfits where status = 'processed' and (p_source is null or source = p_source)),
       n as (select count(*)::real as c from o)
  select g.key, g.label,
         case when n.c = 0 then null
              else (1 - (select count(distinct a.reference_outfit_id) from reference_attributes a
                         join o on o.id = a.reference_outfit_id where a.group_id = g.id) / n.c)::real end
  from attribute_groups g, n
  order by g.sort
$$;

-- AI cost per guest outfit (read + judge), over the last p_days days.
create or replace function cost_per_outfit(p_days int default 30)
returns table (outfits bigint, avg_cost numeric, avg_read numeric, avg_judge numeric, total numeric)
language sql stable as $$
  with u as (
    select outfit_id, step, sum(cost_usd) as c from ai_usage
    where outfit_id is not null and created_at > now() - make_interval(days => p_days)
    group by 1, 2),
  per as (
    select outfit_id, sum(c) as c,
           coalesce(sum(c) filter (where step = 'read'), 0) as r,
           coalesce(sum(c) filter (where step = 'judge'), 0) as j
    from u group by 1)
  select count(*), avg(c), avg(r), avg(j), sum(c) from per
$$;

-- IndoFashion pilot: dataset label against whether the AI's garment type agreed.
create or replace function label_mismatch_summary()
returns table (dataset_label text, total bigint, mismatches bigint, not_comparable bigint)
language sql stable as $$
  select r.dataset_label, count(*),
         count(*) filter (where r.label_mismatch),
         count(*) filter (where r.label_mismatch is null)
  from reference_outfits r
  where r.dataset_label is not null and r.status = 'processed'
  group by 1 order by 1
$$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('reference_blank_share','cost_per_outfit','label_mismatch_summary') loop
    execute format('revoke all on function %s from public, app_guest', f);
  end loop;
end $$;
