-- ============================================================
-- 074：問卷固定第 6 題（人生轉折）＋修正男性創始會員偏女性暱稱
-- ============================================================

-- 1. 既有 profiles 缺第 6 題者 append（含預填回答）
update public.profiles p
set questionnaire = coalesce(p.questionnaire, '[]'::jsonb) || jsonb_build_array(
  jsonb_build_object(
    'id', 9000,
    'category', '未來規劃與自尊',
    'text', '目前為止，您遇到人生中最大的轉折是什麼?',
    'answer', (
      array[
        '離職轉行那次最關鍵 我原本以為穩定就是答案 後來發現不適合的環境會把人也磨鈍 換跑道雖然收入一度變少 但心態跟節奏回來了 也學會先問自己要什麼再答應別人',
        '父母健康出狀況那陣子 讓我從只顧工作變成會排優先順序的人 以前覺得成功就是加班升遷 後來才懂能陪在身邊、把話講清楚 比很多成就更實在',
        '一段結束得很難看的感情 反而教會我早點講底線 不要忍到爆 分手當然痛 但比起一直委屈 我寧願痛完重新整理自己 再帶著比較清楚的標準往下走'
      ]
    )[
      1 + (
        abs(hashtext(coalesce(p.founding_member_no::text, p.id::text) || ':9000'))
        % 3
      )
    ]
  )
)
where not exists (
  select 1
  from jsonb_array_elements(coalesce(p.questionnaire, '[]'::jsonb)) elem
  where (elem->>'id')::int = 9000
     or elem->>'text' = '目前為止，您遇到人生中最大的轉折是什麼?'
);

-- 2. 創始男性中文暱稱 slot（9/19/29/39/49）曾被設成女性風格
update public.profiles
set nickname = case founding_member_no
  when 9 then '阿杰'
  when 19 then '阿偉'
  when 29 then '阿廷'
  when 39 then '小凱'
  when 49 then '阿豪'
end
where gender = 'male'
  and founding_member_no in (9, 19, 29, 39, 49)
  and nickname in ('阿琳', '慧如', '佳雯', '筱婷', '美玲');

notify pgrst, 'reload schema';
