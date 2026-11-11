-- Scheduled jobs. Supabase cron calls secured app routes, because deleting files and
-- calling the AI have to happen in the app, not in SQL.
-- After deploying, set the two values once (SQL editor):
--   insert into private_config (key, value) values
--     ('app_url', 'https://your-app.vercel.app'), ('cron_secret', '<same as CRON_SECRET>')
--   on conflict (key) do update set value = excluded.value;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function call_app_job(p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select value into v_url from private_config where key = 'app_url';
  select value into v_secret from private_config where key = 'cron_secret';
  if v_url is null or v_secret is null then
    raise notice 'private_config app_url / cron_secret not set; skipping %', p_path;
    return;
  end if;
  perform net.http_post(
    url := v_url || p_path,
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000);
end $$;
revoke all on function call_app_job(text) from public, anon, authenticated;

select cron.schedule('purge-expired',      '15 20 * * *', $$select call_app_job('/api/cron/purge')$$);        -- daily 01:45 IST
select cron.schedule('raaha-nightly',      '30 20 * * *', $$select call_app_job('/api/cron/raaha')$$);        -- daily 02:00 IST
select cron.schedule('reference-worker',   '*/5 * * * *', $$select call_app_job('/api/cron/reference-worker')$$);
select cron.schedule('vocab-merge',        '0 21 * * *',  $$select call_app_job('/api/cron/vocab')$$);
select cron.schedule('threshold-weekly',   '0 22 * * 0',  $$select call_app_job('/api/cron/threshold')$$);
select cron.schedule('rate-limit-cleanup', '0 23 * * *',  $$delete from rate_limit_events where created_at < now() - interval '7 days'$$);
