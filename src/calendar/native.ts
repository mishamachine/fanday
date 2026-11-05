import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { CalendarEventInput, CalendarPlugin } from './types.ts'
import { fromWire, toWire, type WireEvent, type WireEventInput } from './wire.ts'

interface Native {
  checkAccess(): Promise<{ state: 'granted' | 'denied' | 'prompt' }>
  openSettings(): Promise<void>
  requestAccess(): Promise<{ granted: boolean }>
  createCalendar(o: { title: string; colorHex?: string }): Promise<{ calendarId: string }>
  // No method carries a calendar id: native code resolves the one Fanday calendar it created itself, so JS cannot point it elsewhere.
  deleteCalendar(): Promise<void>
  upsertEvent(o: WireEventInput & { existingIdentifier?: string }): Promise<{ eventIdentifier: string }>
  deleteEvent(o: { eventIdentifier: string }): Promise<void>
  listEvents(o: { eventIdentifiers: string[] }): Promise<{ events: WireEvent[] }>
  removeOrphans(o: { keep: string[]; fromMs?: number }): Promise<{ removed: number }>
  scheduleBackgroundSync(o: { intervalMinutes: number }): Promise<void>
  cancelBackgroundSync(): Promise<void>
  addListener(name: 'syncDue', cb: () => void): Promise<PluginListenerHandle>
}

const plugin = registerPlugin<Native>('FandayCalendar')

export class NativeCalendar implements CalendarPlugin {
  async checkAccess() { return (await plugin.checkAccess()).state }
  async openSettings() { await plugin.openSettings() }
  requestAccess() { return plugin.requestAccess() }
  createCalendar(opts: { title: string; colorHex?: string }) { return plugin.createCalendar(opts) }
  async deleteCalendar(_calendarId: string) { await plugin.deleteCalendar() }
  upsertEvent(_calendarId: string, event: CalendarEventInput, existingIdentifier?: string | null) {
    return plugin.upsertEvent({ existingIdentifier: existingIdentifier ?? undefined, ...toWire(event) })
  }
  async deleteEvent(_calendarId: string, eventIdentifier: string) { await plugin.deleteEvent({ eventIdentifier }) }
  async listEvents(_calendarId: string, eventIdentifiers: string[]) {
    return (await plugin.listEvents({ eventIdentifiers })).events.map(fromWire)
  }
  async removeOrphans(_calendarId: string, keep: string[], fromMs?: number) { return (await plugin.removeOrphans({ keep, fromMs })).removed }
  async scheduleBackgroundSync(intervalMinutes: number) { await plugin.scheduleBackgroundSync({ intervalMinutes }) }
  async cancelBackgroundSync() { await plugin.cancelBackgroundSync() }
  async onSyncDue(cb: () => void) { const h = await plugin.addListener('syncDue', cb); return () => { void h.remove() } }
}
