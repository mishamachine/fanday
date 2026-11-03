import { Capacitor } from '@capacitor/core'

export const isNative = Capacitor.isNativePlatform()
export const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web'
export const APP_SCHEME = 'com.bbprojectfactory.fanday'
export const BUNDLE_ID = 'com.bbprojectfactory.fanday'
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? ''
export const DATA_SOURCE = (import.meta.env.VITE_DATA_SOURCE as string | undefined) ?? 'mock'
export const FUNCTIONS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : ''
// Every Fanday Edge Function is prefixed fanday- (the project is shared). fanday-go serves .../fanday-go/{game}/{slot}.
export const GO_BASE_URL = FUNCTIONS_URL ? `${FUNCTIONS_URL}/fanday-go` : ''
/** Fanday's Postgres schema on the shared project (Data API: db.schema). */
export const DB_SCHEMA = 'fanday' as const
// Native Google client ids (public identifiers). Google sign-in is native ID-token only; there is no web Google path.
export const GOOGLE_IOS_CLIENT_ID = (import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID as string | undefined) ?? ''
export const GOOGLE_WEB_CLIENT_ID = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined) ?? ''
export const PRIVACY_LINE = 'We never sell your data or share it with advertisers.'
// Sign in with Apple Services ID (public identifier, not a secret). Needed on web/Android to confirm with Apple at delete time.
export const APPLE_SERVICES_ID = (import.meta.env.VITE_APPLE_SERVICES_ID as string | undefined) ?? ''
