import { eq, done } from './_t.mjs'
import { officialCalendarTarget as t } from '../src/lib/officialCalendar.ts'

eq('iOS + .ics: webcal subscription', t('https://cdn.nba.com/teams/calendars/lakers.ics', 'ios'), 'webcal://cdn.nba.com/teams/calendars/lakers.ics')
eq('Android + .ics: https', t('https://cdn.nba.com/teams/calendars/lakers.ics', 'android'), 'https://cdn.nba.com/teams/calendars/lakers.ics')
eq('web + .ics: https', t('https://cdn.nba.com/teams/calendars/magic.ics', 'web'), 'https://cdn.nba.com/teams/calendars/magic.ics')
eq('iOS + page link: https', t('https://nba.ecal.com/atlanta-hawks', 'ios'), 'https://nba.ecal.com/atlanta-hawks')
eq('garbage passes through', t('not a url', 'ios'), 'not a url')
done()
