-- Private buckets. Object paths in "outfits" are {wedding_id}/{guest_id}/{outfit_id}/{photo_id}.jpg
insert into storage.buckets (id, name, public) values
  ('outfits', 'outfits', false),
  ('reference', 'reference', false),
  ('permissions', 'permissions', false),
  ('training', 'training', false)
on conflict (id) do nothing;

-- A guest can read (and therefore sign URLs for) only objects under her own folder.
create policy outfits_own_objects on storage.objects for select
  using (bucket_id = 'outfits' and (storage.foldername(name))[2] = public.jwt_guest_id()::text);
