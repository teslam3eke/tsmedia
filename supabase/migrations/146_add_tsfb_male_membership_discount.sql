-- 146：新增男性 30 天會員折扣碼 TSFB。
-- 以當下全站活動價為基礎再折 NT$300；不適用女性與加值道具。

insert into public.membership_discount_codes (
  code,
  male_discount_ntd,
  female_free_days,
  enabled
)
values ('TSFB', 300, 0, true)
on conflict (code) do update
set male_discount_ntd = excluded.male_discount_ntd,
    female_free_days = excluded.female_free_days,
    enabled = excluded.enabled,
    updated_at = now();

notify pgrst, 'reload schema';
