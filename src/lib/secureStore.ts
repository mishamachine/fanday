import { registerPlugin } from '@capacitor/core'
import { isNative } from './env.ts'

// Secret storage for the device token: iOS Keychain / Android EncryptedSharedPreferences through a Capacitor plugin;
// localStorage on web only. The plugin API below is that of `capacitor-secure-storage-plugin` (get/set/remove by key).
// DEPENDENCY NOT ADDED BY THIS PR (needs Al-Jazari's OK): until it is installed and `cap sync`ed, native builds keep the token in memory
// only, so a native install would re-register on every launch. It must land before a store build.
interface SecureStoragePlugin {
  get(o: { key: string }): Promise<{ value: string }>
  set(o: { key: string; value: string }): Promise<{ value: boolean }>
  remove(o: { key: string }): Promise<{ value: boolean }>
}
const plugin = registerPlugin<SecureStoragePlugin>('SecureStoragePlugin')
const memory = new Map<string, string>()

export const secureStore = {
  async get(key: string): Promise<string | null> {
    if (!isNative) { try { return localStorage.getItem(key) } catch { return null } }
    try { return (await plugin.get({ key })).value || memory.get(key) || null } catch { return memory.get(key) ?? null }
  },
  async set(key: string, value: string): Promise<void> {
    if (!isNative) { try { localStorage.setItem(key, value) } catch { /* private mode */ } return }
    memory.set(key, value)
    try { await plugin.set({ key, value }) } catch { /* plugin missing: memory only */ }
  },
  async remove(key: string): Promise<void> {
    memory.delete(key)
    if (!isNative) { try { localStorage.removeItem(key) } catch { /* ignore */ } return }
    try { await plugin.remove({ key }) } catch { /* ignore */ }
  },
}
