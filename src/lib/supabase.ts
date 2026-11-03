import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL, isNative } from './env.ts'

// PKCE everywhere. On native the code comes back through the app deep link (see auth.ts), so URL detection is off.
// With no env configured the app runs in local mode (mock data, follows on the device only).
export const supabase: SupabaseClient | null = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: !isNative },
    })
  : null
