import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'
import { isNative } from './env.ts'

// Secret storage for the device token: iOS Keychain / Android Keystore-backed encrypted storage through
// capacitor-secure-storage-plugin (pinned); localStorage on web only. If the native call fails the token is kept in memory for this
// launch (never written to localStorage on native), so a failure costs a re-registration, not a leak.
const memory = new Map<string, string>()

export const secureStore = {
  async get(key: string): Promise<string | null> {
    if (!isNative) { try { return localStorage.getItem(key) } catch { return null } }
    try { return (await SecureStoragePlugin.get({ key })).value || memory.get(key) || null } catch { return memory.get(key) ?? null } // get() rejects for a missing key
  },
  async set(key: string, value: string): Promise<void> {
    if (!isNative) { try { localStorage.setItem(key, value) } catch { /* private mode */ } return }
    memory.set(key, value)
    try { await SecureStoragePlugin.set({ key, value }) } catch { /* memory only */ }
  },
  async remove(key: string): Promise<void> {
    memory.delete(key)
    if (!isNative) { try { localStorage.removeItem(key) } catch { /* ignore */ } return }
    try { await SecureStoragePlugin.remove({ key }) } catch { /* missing key */ }
  },
}
