import type { DataSource } from './types.ts'
import { mockSource } from './mockSource.ts'
import { supabaseSource } from './supabaseSource.ts'
import { DATA_SOURCE } from '../lib/env.ts'
import { supabase } from '../lib/supabase.ts'

/** Mock by default. Set VITE_DATA_SOURCE=supabase to read the real tables. */
export const data: DataSource = DATA_SOURCE === 'supabase' && supabase ? supabaseSource : mockSource
export * from './types.ts'
