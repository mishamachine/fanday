import 'jsr:@supabase/functions-js@2.118.0/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0?pin=v140'
import { handle } from './handler.ts'
import { gmailSender } from './smtp.ts'
import { SUBJECT, TEMPLATE_HTML } from './template.ts'

// fanday-send-link (verify_jwt = false: the caller is signed out). See handler.ts for the contract and limits.
function fromDict(name: string): string | undefined {
  try { return JSON.parse(Deno.env.get(name) ?? '{}')?.default } catch { return undefined }
}
const secretKey = () => fromDict('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

Deno.serve((req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false }, db: { schema: 'fanday' } })
  return handle(req, {
    rpc: (fn, args) => admin.rpc(fn, args),
    createUser: async (email) => {
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
      // A race with another sign-up for the same address is fine: the user exists, and generateLink below still works.
      if (error && !/already|registered|exists/i.test(error.message)) throw new Error('createUser failed')
      return error ? null : (data.user?.id ?? null)
    },
    generateLink: async (email) => {
      const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
      return error ? null : (data.properties?.hashed_token ?? null)
    },
    send: gmailSender((k) => Deno.env.get(k)),
    template: { subject: SUBJECT, html: TEMPLATE_HTML },
    waitUntil: typeof EdgeRuntime !== 'undefined' ? (p) => EdgeRuntime!.waitUntil(p) : undefined,
    hops: Number(Deno.env.get('FANDAY_TRUSTED_PROXY_HOPS')) || 1,
  })
})
