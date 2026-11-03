import { MockCalendar } from './mock.ts'
import type { CalendarPlugin } from './types.ts'

// TODO(native-plugin PR): on native, return the registered Capacitor plugin here instead of the mock.
export const calendar: CalendarPlugin = new MockCalendar()
export * from './types.ts'
