# Supabase 認證信範本（繁體中文）

在 Supabase Dashboard：**Authentication → Email Templates** 貼上以下內容。

請確認 **Site URL** 與 **Redirect URLs** 已包含正式網域（與 `VITE_SITE_URL` 一致）。

---

## 重設密碼（Reset Password）

### Subject（主旨）

```
重設你的 tsMedia 密碼
```

### Body（HTML）

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>重設 tsMedia 密碼</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(160deg,#0f172a 0%,#1e293b 100%);padding:28px 32px;">
              <p style="margin:0;color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">tsMedia</p>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.02em;">重設密碼</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.65;">
                你好，
              </p>
              <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.65;">
                我們收到重設 tsMedia 帳號密碼的請求。請點下方按鈕，回到 tsMedia 設定新密碼。
              </p>
              <p style="margin:0 0 24px;color:#64748b;font-size:13px;line-height:1.6;">
                若你沒有提出此請求，可以忽略這封信，你的密碼不會被更改。
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px;">
                <tr>
                  <td align="center" style="border-radius:12px;background:#0f172a;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">
                      重設密碼
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:1.6;">
                若按鈕無法點擊，請複製以下連結到瀏覽器開啟：
              </p>
              <p style="margin:0;word-break:break-all;color:#475569;font-size:11px;line-height:1.5;">
                {{ .ConfirmationURL }}
              </p>
              <hr style="margin:28px 0;border:none;border-top:1px solid #e2e8f0;" />
              <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6;">
                此連結僅供本人使用，請勿轉寄。連結過期後請回到 tsMedia 登入頁再次申請重設密碼。
              </p>
              <p style="margin:12px 0 0;color:#94a3b8;font-size:11px;line-height:1.6;">
                iPhone 使用者建議以 Safari（或主畫面 tsMedia 圖示）開啟連結，以順利完成重設。
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;color:#94a3b8;font-size:11px;">© tsMedia · Silicon Hearts</p>
      </td>
    </tr>
  </table>
</body>
</html>
```

### 純文字版（若 Dashboard 支援 Plain text）

```
重設你的 tsMedia 密碼

我們收到重設 tsMedia 帳號密碼的請求。請開啟以下連結，回到 tsMedia 設定新密碼：

{{ .ConfirmationURL }}

若你沒有提出此請求，可以忽略這封信。

iPhone 使用者建議以 Safari 開啟連結。
```

---

## 註冊確認信（Confirm signup）— 可選一併更新

### Subject

```
確認你的 tsMedia 信箱
```

### Body 摘要

主旨說明「完成註冊」；按鈕文字用 **確認信箱**，內文勿寫「重設密碼」，以免與重設信混淆。變數同樣使用 `{{ .ConfirmationURL }}`。
