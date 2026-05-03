-- 創始會員編號（方便後台篩選／稽核），NULL 代表一般用戶。

alter table public.profiles
  add column if not exists founding_member_no smallint;

alter table public.profiles
  drop constraint if exists profiles_founding_member_no_range;

alter table public.profiles
  add constraint profiles_founding_member_no_range
  check (founding_member_no is null or (founding_member_no >= 1 and founding_member_no <= 999));

create unique index if not exists profiles_founding_member_no_unique
  on public.profiles (founding_member_no)
  where founding_member_no is not null;

comment on column public.profiles.founding_member_no is '創始會員序號（seed 腳本寫入）；一般用戶為 NULL';
