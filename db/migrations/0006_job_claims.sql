-- Batch rows are claimed before they are processed, so two workers running at once
-- (the admin page, the daily cron, a script) never process the same image twice.
alter table reference_outfits drop constraint reference_outfits_status_check;
alter table reference_outfits add constraint reference_outfits_status_check
  check (status in ('pending', 'processing', 'processed', 'failed', 'not_an_outfit'));
