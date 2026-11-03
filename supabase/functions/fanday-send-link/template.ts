// Generated from projects/sports-calendar-sync/email-templates/magic-link.html (the two leading comment lines removed).
// {{ .ConfirmationURL }} is replaced by renderEmail() in link.ts. Edit the HTML source, then paste it here.
export const SUBJECT = 'Fanday: your sign-in link'
export const TEMPLATE_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fanday: your sign-in link</title></head>
<body style="margin:0;padding:0;background:#F1F4F4;font-family:'IBM Plex Sans',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F4F4;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;">
<tr><td style="padding:28px 28px 0;font-size:20px;font-weight:600;color:#0F5E5A;">Fanday</td></tr>
<tr><td style="padding:12px 28px 24px;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#10201F;">Your sign-in link</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#10201F;">Tap the button to sign in to Fanday. No password needed.</p>
<p style="margin:24px 0 8px;"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#1F3A5F;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">Sign in</a></p>
<p style="margin:16px 0 0;font-size:14px;line-height:1.55;color:#4A5B5A;">This link works once, for one hour. If you didn't ask to sign in, ignore this email.</p>
<p style="margin:16px 0 0;font-size:13px;line-height:1.55;color:#4A5B5A;">Button not working? Copy this link into your browser:<br><a href="{{ .ConfirmationURL }}" style="color:#0F5E5A;word-break:break-all;">{{ .ConfirmationURL }}</a></p>
</td></tr>
</table>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#4A5B5A;">Your games. Your calendar. That's it.<br>We never sell your data or share it with advertisers. Questions? Reply to this email.<br>Fanday · B&amp;B Project Factory</p>
</td></tr></table></body></html>`
