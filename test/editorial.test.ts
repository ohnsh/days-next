import { expect, test } from 'bun:test'
import { dayBounds } from '../src/lib/dates'
import type { EditorialEvent } from '../src/lib/types'
import { eventInput } from '../src/server/editorial'
import { coverage, eventsForDay } from '../src/server/vod'

const input = () => ({
  id: '',
  version: 0,
  title: 'A moment',
  notes: 'Test',
  start: Date.parse('2026-10-20T17:00:00Z'),
  end: Date.parse('2026-10-20T17:30:00Z'),
  cameraScope: 'all' as const,
  cameraIds: [],
  tags: ['home'],
  protect: true,
  isPublic: false,
})

test('eventInput accepts and normalizes a valid VOD event', () => {
  expect(eventInput({ ...input(), tags: [' home ', 'home', 'projects'] })).toEqual({
    ...input(),
    tags: ['home', 'projects'],
  })
})

test('eventInput validates title, interval, scope, cameras, tags, and flags', () => {
  expect(() => eventInput({ ...input(), title: '  ' })).toThrow('Title is required')
  expect(() => eventInput({ ...input(), start: 20, end: 20 })).toThrow('Invalid event interval')
  expect(() => eventInput({ ...input(), end: input().start })).toThrow('Invalid event interval')
  expect(() => eventInput({ ...input(), cameraScope: 'some' })).toThrow('Invalid camera scope')
  expect(() => eventInput({ ...input(), cameraScope: 'selected' })).toThrow(
    'Select at least one camera'
  )
  expect(() => eventInput({ ...input(), cameraScope: 'selected', cameraIds: [''] })).toThrow(
    'Invalid camera IDs'
  )
  expect(() => eventInput({ ...input(), tags: [''] })).toThrow('Invalid tags')
  expect(() => eventInput({ ...input(), protect: 'true' })).toThrow('Invalid protection setting')
  expect(() => eventInput({ ...input(), isPublic: 1 })).toThrow('Invalid visibility')
  expect(() => eventInput({ ...input(), version: -1 })).toThrow('Invalid version')
  expect(() => eventInput({ ...input(), version: 1.5 })).toThrow('Invalid version')
})

test('coverage deduplicates camera-local day requests across a shared cache', async () => {
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    return Response.json({ recordings: [] })
  }) as typeof fetch
  try {
    const camera = {
      id: 'tokyo',
      name: 'Tokyo',
      timezone: 'Asia/Tokyo',
      first: 0,
      last: Number.MAX_SAFE_INTEGER,
    }
    const cache = new Map()
    await Promise.all([
      coverage('https://vod.example', '2026-10-20', [camera], cache),
      coverage('https://vod.example', '2026-10-21', [camera], cache),
    ])
    const cameraDays = urls.map((url) => new URL(url).searchParams.get('date'))
    expect(cameraDays).toHaveLength(new Set(cameraDays).size)
    expect(cameraDays).toContain('2026-10-21')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('eventsForDay includes events overlapping either Chicago day boundary', () => {
  const day = '2026-10-20'
  const { start, end } = dayBounds(day)
  const event = (id: string, eventStart: number, eventEnd: number): EditorialEvent => ({
    id,
    day: '2026-10-19',
    title: id,
    notes: '',
    start: eventStart,
    end: eventEnd,
    cameraScope: 'all',
    cameraIds: [],
    tags: [],
    isPublic: true,
    camera: '',
    at: new Date(eventStart).toISOString(),
  })
  const result = eventsForDay(
    [
      event('over-start', start - 1, start + 1),
      event('over-end', end - 1, end + 1),
      event('ends-at-start', start - 60_000, start),
      event('starts-at-end', end, end + 60_000),
    ],
    day
  )
  expect(result.map((item) => item.id)).toEqual(['over-start', 'over-end'])
  expect(result.every((item) => item.day === day)).toBe(true)
})
