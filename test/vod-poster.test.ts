import { expect, test } from 'bun:test'
import { recordingPoster, type Recording } from '../src/server/vod'
import { posterOverrideTime, validatePosterOverrides } from '../src/lib/poster-overrides'

function recording(at: string, posterUrl: string | null): Recording {
  const start = Date.parse(at)
  return { id: at, start, end: start + 60_000, posterUrl }
}

test('camera overrides beat day defaults and missing overrides use automatic selection', () => {
  const overrides = validatePosterOverrides({
    '2026-11-01': { time: '14:00', cameras: { apartment: '16:30' } },
    '2026-10-31': { cameras: { apartment: '13:15' } },
  })
  expect(posterOverrideTime(overrides, '2026-11-01', 'apartment')).toBe('16:30')
  expect(posterOverrideTime(overrides, '2026-11-01', 'other')).toBe('14:00')
  expect(posterOverrideTime(overrides, '2026-10-31', 'other')).toBeUndefined()
  expect(posterOverrideTime(overrides, '2026-10-30', 'apartment')).toBeUndefined()
})

test('override configuration rejects invalid dates, times, and structure', () => {
  for (const value of [
    [],
    null,
    { '2026-02-30': {} },
    { '2026-1-01': {} },
    { '2026-11-01': { time: '24:00' } },
    { '2026-11-01': { time: '9:00' } },
    { '2026-11-01': { times: '12:00' } },
    { '2026-11-01': { cameras: [] } },
    { '2026-11-01': { cameras: { apartment: '12:60' } } },
    { '2026-11-01': { cameras: { '': '12:00' } } },
  ]) {
    expect(() => validatePosterOverrides(value)).toThrow('poster-overrides.yaml:')
  }
  expect(validatePosterOverrides({})).toEqual({})
})

test('explicit times override both automatic modes and fall back to the latest earlier poster', () => {
  const records = [
    recording('2026-11-01T19:30:00Z', '13:30'),
    recording('2026-11-01T20:00:00Z', null),
    recording('2026-11-01T20:15:00Z', '14:15'),
    recording('2026-11-01T22:30:00Z', '16:30'),
  ]
  for (const now of ['2026-11-01T23:00:00Z', '2026-11-02T23:00:00Z']) {
    const poster = (time: string) => recordingPoster(records, '2026-11-01', Date.parse(now), time)
    expect(poster('14:00')).toBe('14:15')
    expect(poster('16:30')).toBe('16:30')
    expect(poster('23:00')).toBe('16:30')
    expect(poster('00:00')).toBe('13:30')
    expect(recordingPoster([], '2026-11-01', Date.parse(now), '14:00')).toBeNull()
  }
})

test('today advances at Chicago two-hour boundaries and holds between them', () => {
  const records = [
    recording('2026-10-20T05:00:00Z', 'midnight'),
    recording('2026-10-20T07:00:00Z', '2am'),
    recording('2026-10-20T08:00:00Z', '3am'),
    recording('2026-10-20T09:00:00Z', '4am'),
    recording('2026-10-20T11:00:00Z', '6am'),
  ]
  const poster = (now: string) => recordingPoster(records, '2026-10-20', Date.parse(now))
  expect(poster('2026-10-20T06:59:59Z')).toBe('midnight')
  expect(poster('2026-10-20T07:00:00Z')).toBe('2am')
  expect(poster('2026-10-20T08:00:00Z')).toBe('2am')
  expect(poster('2026-10-20T08:59:59Z')).toBe('2am')
  expect(poster('2026-10-20T09:00:00Z')).toBe('4am')
  expect(poster('2026-10-20T10:59:59Z')).toBe('4am')
  expect(poster('2026-10-20T11:00:00Z')).toBe('6am')
  expect(poster('2026-10-21T11:00:00Z')).toBe('midnight')
})

test('missing posters and gaps fall back to available footage', () => {
  const records = [
    recording('2026-10-20T07:00:00Z', '2am'),
    recording('2026-10-20T08:00:00Z', null),
  ]
  expect(recordingPoster(records, '2026-10-20', Date.parse('2026-10-20T08:00:00Z'))).toBe('2am')
  expect(recordingPoster(records, '2026-10-20', Date.parse('2026-10-20T07:00:00Z'))).toBe('2am')
  expect(recordingPoster([], '2026-10-20')).toBeNull()
})

test('past days prefer the first available poster at or after Chicago noon', () => {
  const records = [
    recording('2026-10-20T05:00:00Z', 'midnight'),
    recording('2026-10-20T16:59:00Z', 'morning'),
    recording('2026-10-20T17:00:00Z', null),
    recording('2026-10-20T17:10:00Z', 'afternoon'),
    recording('2026-10-20T18:00:00Z', 'later'),
  ]
  const now = Date.parse('2026-10-21T18:00:00Z')
  expect(recordingPoster(records, '2026-10-20', now)).toBe('afternoon')
  expect(recordingPoster(records.slice(0, 2), '2026-10-20', now)).toBe('midnight')
  expect(recordingPoster([recording('2026-10-20T17:00:00Z', 'noon')], '2026-10-20', now)).toBe(
    'noon'
  )
  expect(recordingPoster([], '2026-10-20', now)).toBeNull()
})

test('two-hour boundaries follow wall time across daylight saving changes', () => {
  // Spring skips 2am, resolving that boundary to 3am; fall waits through both 1am hours.
  for (const [day, midnight, firstBoundary, four] of [
    ['2026-03-08', '2026-03-08T06:00:00Z', '2026-03-08T08:00:00Z', '2026-03-08T09:00:00Z'],
    ['2026-11-01', '2026-11-01T05:00:00Z', '2026-11-01T08:00:00Z', '2026-11-01T10:00:00Z'],
  ]) {
    const records = [
      recording(midnight, 'midnight'),
      recording(firstBoundary, 'first boundary'),
      recording(four, '4am'),
    ]
    expect(recordingPoster(records, day, Date.parse(firstBoundary) - 1)).toBe('midnight')
    expect(recordingPoster(records, day, Date.parse(firstBoundary))).toBe('first boundary')
    expect(recordingPoster(records, day, Date.parse(four) - 1)).toBe('first boundary')
    expect(recordingPoster(records, day, Date.parse(four))).toBe('4am')
  }
})
