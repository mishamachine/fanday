/**
 * Where "Add to my calendar" sends the user. Direct .ics feeds on iOS open as a webcal:// subscription (the system
 * calendar offers to subscribe); everything else opens the https URL in the system browser.
 */
export function officialCalendarTarget(url: string, platform: 'ios' | 'android' | 'web'): string {
  let u: URL
  try { u = new URL(url) } catch { return url }
  if (platform === 'ios' && u.protocol === 'https:' && u.pathname.toLowerCase().endsWith('.ics')) return url.replace(/^https:/i, 'webcal:')
  return url
}
