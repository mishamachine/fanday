import { Capacitor } from '@capacitor/core'

export const isNative = Capacitor.isNativePlatform()
export const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web'
export const APP_SCHEME = 'com.bbprojectfactory.fanday'
export const BUNDLE_ID = 'com.bbprojectfactory.fanday'
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? ''
export const DATA_SOURCE = (import.meta.env.VITE_DATA_SOURCE as string | undefined) ?? 'mock'
export const FUNCTIONS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : ''
export const PRIVACY_LINE = 'We never sell your data or share it with advertisers.'
// Sign in with Apple Services ID (public identifier, not a secret). Needed on web/Android to confirm with Apple at delete time.
export const APPLE_SERVICES_ID = (import.meta.env.VITE_APPLE_SERVICES_ID as string | undefined) ?? ''
