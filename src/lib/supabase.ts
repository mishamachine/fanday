import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { DB_SCHEMA, SUPABASE_KEY, SUPABASE_URL, isNative } from './env.ts'

// Shared project: all Fanday tables and RPCs live in the `fanday` schema (db.schema), so .from() and .rpc() never touch `public`.
// PKCE everywhere. On native the code comes back through the app deep link (see auth.ts), so URL detection is off.
// With no env configured the app runs in local mode (mock data, follows on the device only).
export const supabase: SupabaseClient<any, typeof DB_SCHEMA, typeof DB_SCHEMA> | null = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      db: { schema: DB_SCHEMA },
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: !isNative },
    })
  : null
