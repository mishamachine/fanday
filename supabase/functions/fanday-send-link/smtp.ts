import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

// Gmail over implicit TLS on port 465. Supabase documents that Edge Functions cannot open outbound connections to ports 25 and 587
// (https://supabase.com/docs/guides/functions/limits); 465 is not on that list, but it has NOT been tried from a real deployment [unverified].
// Secrets (set by Babar, never in the repo): FANDAY_GMAIL_USER, FANDAY_GMAIL_APP_PASSWORD.
export function gmailSender(env: (k: string) => string | undefined) {
  return async (msg: { to: string; subject: string; html: string; text: string }) => {
    const username = env('FANDAY_GMAIL_USER'), password = env('FANDAY_GMAIL_APP_PASSWORD')
    if (!username || !password) throw new Error('mail is not configured')
    const client = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username, password } } })
    try {
      await client.send({
        from: `"Fanday" <${username}>`, // machinemisha@gmail.com
        replyTo: 'machinemisha+fanday@gmail.com',
        to: msg.to, subject: msg.subject, content: msg.text, html: msg.html,
      })
    } finally {
      await client.close().catch(() => undefined)
    }
  }
}
