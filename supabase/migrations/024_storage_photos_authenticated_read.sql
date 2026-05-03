-- Discover / 聊天需讀取他人 photos 路徑；原「photos: own folder」for ALL 會擋掉對別人資料夾的 SELECT，
-- 導致 createSignedUrls 無法產生他人頭像 URL（畫面空白）。
-- 寫入、更新、刪除仍僅限本人 userId 第一層資料夾。

drop policy if exists "photos: own folder" on storage.objects;

create policy "photos: insert own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos: update own folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos: delete own folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos: select authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'photos');
