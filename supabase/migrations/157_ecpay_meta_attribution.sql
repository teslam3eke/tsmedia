-- 157：Meta CAPI 归因（fbp/fbc）與綠界建單時 client 快照

alter table public.profiles
  add column if not exists meta_fbp text,
  add column if not exists meta_fbc text,
  add column if not exists meta_attribution_updated_at timestamptz;

comment on column public.profiles.meta_fbp is
  'Meta browser _fbp；由使用者端同步，供 CAPI user_data.fbp';
comment on column public.profiles.meta_fbc is
  'Meta _fbc（含 fbclid）；由使用者端同步，供 CAPI user_data.fbc';

alter table public.ecpay_orders
  add column if not exists meta_fbp text,
  add column if not exists meta_fbc text,
  add column if not exists client_user_agent text,
  add column if not exists client_ip text;

comment on column public.ecpay_orders.meta_fbp is
  '建單當下快照的 fbp（優先於 profiles 供 Purchase CAPI）';
comment on column public.ecpay_orders.meta_fbc is
  '建單當下快照的 fbc';
comment on column public.ecpay_orders.client_user_agent is
  '建單 HTTP 請求之 User-Agent（非綠界 webhook）';
comment on column public.ecpay_orders.client_ip is
  '建單 HTTP 請求之 client IP（非綠界 webhook）';

notify pgrst, 'reload schema';
