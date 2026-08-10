-- 147：已審核但尚未付費會員的意見回饋折扣通知。

alter table public.app_notifications
  drop constraint if exists app_notifications_kind_check;

alter table public.app_notifications
  add constraint app_notifications_kind_check
  check (kind in (
    'verification_approved',
    'verification_rejected',
    'verification_submitted',
    'super_like_received',
    'match_created',
    'message_received',
    'instant_match_paired',
    'feedback_coupon_offer'
  ));

notify pgrst, 'reload schema';
