import { Temporal } from '@js-temporal/polyfill'

export const TIMEZONE = 'America/Chicago'
export function plainDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Expected YYYY-MM-DD')
  return Temporal.PlainDate.from(value).toString()
}
export function shiftDay(day: string, days: number) {
  return Temporal.PlainDate.from(plainDay(day)).add({ days }).toString()
}
export function dayFromInstant(value: string | number, timezone = TIMEZONE) {
  const instant =
    typeof value === 'number'
      ? Temporal.Instant.fromEpochMilliseconds(value)
      : Temporal.Instant.from(value)
  return instant.toZonedDateTimeISO(timezone).toPlainDate().toString()
}
export function today() {
  return dayFromInstant(Date.now())
}
export function dayCachePolicy(days: string | string[], now = today()) {
  const list = Array.isArray(days) ? days : [days]
  const recentCutoff = shiftDay(now, -7)
  const isHistorical = list.length > 0 && list.every((d) => plainDay(d) < recentCutoff)
  return isHistorical ? { maxAge: 604800, swr: 86400 } : { maxAge: 1200, swr: 15 }
}
export function dayBounds(day: string, timezone = TIMEZONE) {
  const date = Temporal.PlainDate.from(plainDay(day))
  return {
    start: date.toZonedDateTime(timezone).epochMilliseconds,
    end: date.add({ days: 1 }).toZonedDateTime(timezone).epochMilliseconds,
  }
}
export const dayUrl = (day: string) => `/${plainDay(day).replaceAll('-', '/')}/`
export function dayTitle(day: string) {
  return Temporal.PlainDate.from(plainDay(day)).toLocaleString('en-US', {
    dateStyle: 'full',
  })
}
export function timeOfDay(value: number, timezone = TIMEZONE) {
  return Temporal.Instant.fromEpochMilliseconds(value)
    .toZonedDateTimeISO(timezone)
    .toPlainTime()
    .toString({ smallestUnit: 'second' })
}
