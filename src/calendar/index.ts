import { isNative } from '../lib/env.ts'
import { MockCalendar } from './mock.ts'
import { NativeCalendar } from './native.ts'
import type { CalendarPlugin } from './types.ts'

/** The real device calendar inside the iOS/Android app; an in-memory mock on the web, in previews and in tests. */
export const calendar: CalendarPlugin = isNative ? new NativeCalendar() : new MockCalendar()
export * from './types.ts'
