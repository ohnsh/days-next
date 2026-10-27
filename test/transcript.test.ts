import { afterEach, expect, test } from 'bun:test'
import { dayBounds, timeOfDay } from '../src/lib/dates'
import type { TranscriptSegment } from '../src/lib/types'
import { dayTranscripts, type Camera, type VodDayTranscriptData } from '../src/server/vod'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function segment(
  recordingId: string,
  segmentIndex: number,
  startUtcMs: number,
  endUtcMs: number,
  text: string,
  sourceCameraId = 'samson'
): TranscriptSegment {
  return {
    recordingId,
    sourceCameraId,
    segmentIndex,
    startMs: 0,
    endMs: endUtcMs - startUtcMs,
    startUtcMs,
    endUtcMs,
    text,
    playbackUrl: `https://vod.example/embed?camera=${sourceCameraId}&at=${new Date(startUtcMs).toISOString()}`,
  }
}

test('dayTranscripts queries active logical cameras and distinct audioSourceIds without duplication', async () => {
  const day = '2026-10-20'
  const { start, end } = dayBounds(day)
  const requestedPaths: string[] = []

  const camerasList: Camera[] = [
    {
      id: 'apartment',
      name: 'Apartment',
      timezone: 'America/Chicago',
      first: start - 3_600_000,
      last: end + 3_600_000,
      sourceIds: ['reolink'],
      audioSourceIds: ['samson', 'samson_opus'],
    },
    {
      id: 'kitchen',
      name: 'Kitchen',
      timezone: 'America/Chicago',
      first: start + 1_000,
      last: start + 60_000,
      sourceIds: ['wuuk'],
      audioSourceIds: ['samson'],
    },
    {
      id: 'inactive',
      name: 'Inactive Cam',
      timezone: 'America/Chicago',
      first: start - 86_400_000,
      last: start,
    },
  ]

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    requestedPaths.push(`${url.pathname}${url.search}`)
    if (url.pathname === '/api/cameras') {
      return Response.json(camerasList)
    }
    if (url.pathname === '/api/cameras/apartment/transcript') {
      return Response.json({
        cameraId: 'apartment',
        name: 'Apartment',
        day,
        timezone: 'America/Chicago',
        start,
        end,
        segments: [segment('rec-apt', 0, start + 10_000, start + 15_000, 'Morning coffee', 'reolink')],
      } satisfies VodDayTranscriptData)
    }
    if (url.pathname === '/api/cameras/kitchen/transcript') {
      return Response.json({
        cameraId: 'kitchen',
        name: 'Kitchen',
        day,
        timezone: 'America/Chicago',
        start,
        end,
        segments: [],
      } satisfies VodDayTranscriptData)
    }
    if (url.pathname === '/api/cameras/samson/transcript') {
      return Response.json({
        cameraId: 'samson',
        name: 'Samson Q2U',
        day,
        timezone: 'America/Chicago',
        start,
        end,
        segments: [
          segment('rec-sam', 0, start + 20_000, start + 25_000, 'Desk mic check', 'samson'),
          segment('rec-sam', 1, start + 30_000, start + 35_000, 'Second line', 'samson'),
        ],
      } satisfies VodDayTranscriptData)
    }
    if (url.pathname === '/api/cameras/samson_opus/transcript') {
      return Response.json({
        cameraId: 'samson_opus',
        name: 'Samson Opus',
        day,
        timezone: 'America/Chicago',
        start,
        end,
        segments: [],
      } satisfies VodDayTranscriptData)
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  const result = await dayTranscripts('https://vod.example', day)

  expect(requestedPaths).toEqual([
    '/api/cameras',
    `/api/cameras/apartment/transcript?date=${day}`,
    `/api/cameras/kitchen/transcript?date=${day}`,
    `/api/cameras/samson/transcript?date=${day}`,
    `/api/cameras/samson_opus/transcript?date=${day}`,
  ])
  expect(result.activeSource).toBeNull()
  expect(result.warnings).toEqual([])
  expect(result.availableSources).toEqual([
    { id: 'apartment', name: 'Apartment', count: 1 },
    { id: 'samson', name: 'Samson Q2U', count: 2 },
  ])
  expect(result.sources.map((s) => ({ id: s.id, name: s.name, count: s.segments.length }))).toEqual([
    { id: 'apartment', name: 'Apartment', count: 1 },
    { id: 'samson', name: 'Samson Q2U', count: 2 },
  ])
})

test('dayTranscripts filters by source and handles unknown 404 source filter gracefully', async () => {
  const day = '2026-10-20'
  const { start, end } = dayBounds(day)

  const camerasList: Camera[] = [
    {
      id: 'apartment',
      name: 'Apartment',
      timezone: 'America/Chicago',
      first: start,
      last: end,
      audioSourceIds: ['samson'],
    },
  ]

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/cameras') {
      return Response.json(camerasList)
    }
    if (url.pathname === '/api/cameras/apartment/transcript') {
      return Response.json({
        cameraId: 'apartment',
        name: 'Apartment',
        day,
        timezone: 'America/Chicago',
        start,
        end,
        segments: [segment('rec-apt', 0, start + 1_000, start + 5_000, 'Hello room', 'apartment')],
      } satisfies VodDayTranscriptData)
    }
    if (url.pathname === '/api/cameras/samson/transcript') {
      return Response.json({
        cameraId: 'samson',
        name: 'Samson Mic',
        day,
        timezone: 'America/Chicago',
        start,
        end,
        segments: [segment('rec-sam', 0, start + 2_000, start + 6_000, 'Hello mic', 'samson')],
      } satisfies VodDayTranscriptData)
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  const filtered = await dayTranscripts('https://vod.example', day, 'samson')
  expect(filtered.activeSource).toBe('samson')
  expect(filtered.availableSources).toEqual([
    { id: 'apartment', name: 'Apartment', count: 1 },
    { id: 'samson', name: 'Samson Mic', count: 1 },
  ])
  expect(filtered.sources.map((s) => s.id)).toEqual(['samson'])
  expect(filtered.warnings).toEqual([])

  const unknown = await dayTranscripts('https://vod.example', day, 'unknown')
  expect(unknown.activeSource).toBe('unknown')
  expect(unknown.sources).toEqual([])
  expect(unknown.availableSources).toEqual([
    { id: 'apartment', name: 'Apartment', count: 1 },
    { id: 'samson', name: 'Samson Mic', count: 1 },
  ])
  expect(unknown.warnings).toEqual([])
})

test('dayTranscripts clips segments to day bounds, deduplicates across local dates, and orders chronologically', async () => {
  const day = '2026-10-20'
  const { start, end } = dayBounds(day)

  const camerasList: Camera[] = [
    {
      id: 'tokyo',
      name: 'Tokyo Cam',
      timezone: 'Asia/Tokyo',
      first: start - 86_400_000,
      last: end + 86_400_000,
    },
  ]

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/cameras') {
      return Response.json(camerasList)
    }
    if (url.pathname === '/api/cameras/tokyo/transcript') {
      return Response.json({
        cameraId: 'tokyo',
        name: 'Tokyo Cam',
        day: url.searchParams.get('date') ?? day,
        timezone: 'Asia/Tokyo',
        start,
        end,
        segments: [
          segment('rec-before', 0, start - 10_000, start, 'Before day start', 'tokyo'),
          segment('rec-after', 0, end, end + 10_000, 'At or after day end', 'tokyo'),
          segment('rec-late', 1, start + 50_000, start + 55_000, 'Later segment', 'tokyo'),
          segment('rec-early', 2, start - 1_000, start + 1_000, 'Crosses midnight start', 'tokyo'),
          segment('rec-tie-b', 0, start + 20_000, start + 25_000, 'Tie B', 'tokyo'),
          segment('rec-tie-a', 1, start + 20_000, start + 25_000, 'Tie A index 1', 'tokyo'),
          segment('rec-tie-a', 0, start + 20_000, start + 25_000, 'Tie A index 0', 'tokyo'),
        ],
      } satisfies VodDayTranscriptData)
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  const result = await dayTranscripts('https://vod.example', day)
  expect(result.sources).toHaveLength(1)
  expect(result.sources[0].segments.map((s) => `${s.recordingId}:${s.segmentIndex}`)).toEqual([
    'rec-early:2',
    'rec-tie-a:0',
    'rec-tie-a:1',
    'rec-tie-b:0',
    'rec-late:1',
  ])
})

test('dayTranscripts records a warning when an upstream source transcript request fails', async () => {
  const day = '2026-10-20'
  const { start, end } = dayBounds(day)

  const camerasList: Camera[] = [
    {
      id: 'apartment',
      name: 'Apartment',
      timezone: 'America/Chicago',
      first: start,
      last: end,
      audioSourceIds: ['samson'],
    },
  ]

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/cameras') {
      return Response.json(camerasList)
    }
    if (url.pathname === '/api/cameras/apartment/transcript') {
      return new Response('Upstream error', { status: 502 })
    }
    if (url.pathname === '/api/cameras/samson/transcript') {
      return Response.json({
        cameraId: 'samson',
        name: 'Samson Mic',
        day,
        timezone: 'America/Chicago',
        start,
        end,
        segments: [segment('rec-sam', 0, start + 5_000, start + 9_000, 'Working audio', 'samson')],
      } satisfies VodDayTranscriptData)
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch

  const result = await dayTranscripts('https://vod.example', day)
  expect(result.warnings).toEqual(['Transcript for Apartment is temporarily unavailable.'])
  expect(result.sources.map((s) => s.id)).toEqual(['samson'])
})

test('timeOfDay formats UTC millisecond timestamps in Central time', () => {
  // 2026-10-20T14:05:09Z -> 09:05:09 CDT (America/Chicago, UTC-5)
  expect(timeOfDay(Date.parse('2026-10-20T14:05:09Z'))).toBe('09:05:09')
})
