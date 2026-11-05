import { afterEach, expect, test } from 'bun:test'
import { dayBounds, timeOfDay } from '../src/lib/dates'
import { dayTranscripts, type View, type Source } from '../src/server/vod'
import type { TranscriptSegment } from '../src/lib/types'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
const day = '2026-10-20'
const { start, end } = dayBounds(day)
const view = (id: string, extra: Partial<View> = {}): View => ({
  id,
  name: id,
  mediaType: 'audio/video',
  timezone: 'America/Chicago',
  first: start,
  last: end,
  ...extra,
})
function segment(
  id: string,
  index = 0,
  target = 'apartment',
  at = start + 1000
): TranscriptSegment {
  return {
    recordingId: id,
    segmentIndex: index,
    sourceCameraId: 'mic',
    startMs: 0,
    endMs: 1000,
    startUtcMs: at,
    endUtcMs: at + 1000,
    text: id,
    playbackUrl: `https://vod.example/?camera=${target}`,
  }
}
function mock(
  list: View[],
  responses: Record<string, TranscriptSegment[] | number>,
  sources: Source[] = []
) {
  const requests: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    requests.push(url.pathname + url.search)
    if (url.pathname === '/api/views') return Response.json(list)
    if (url.pathname === '/api/sources') return Response.json(sources)
    const value = responses[url.pathname]
    if (typeof value === 'number') return new Response('Unavailable', { status: value })
    if (!value) throw new Error(`Unexpected request: ${url}`)
    return Response.json({ name: url.pathname.split('/')[3], segments: value })
  }) as typeof fetch
  return requests
}

test('combined views deduplicate physical segments; selected views keep their own links', async () => {
  const requests = mock(
    [
      view('apartment', { audioSourceIds: ['mic'] }),
      view('kitchen', { audioSourceIds: ['mic'] }),
      view('mic', { mediaType: 'audio' }),
    ],
    {
      '/api/views/apartment/transcript': [segment('shared'), segment('shared', 1)],
      '/api/views/kitchen/transcript': [
        segment('shared', 0, 'kitchen'),
        segment('unique', 0, 'kitchen'),
      ],
      '/api/views/mic/transcript': [segment('shared', 0, 'mic')],
    }
  )
  const result = await dayTranscripts('https://vod.example', day)
  expect(result.totalCount).toBe(3)
  expect(result.sources.map((s) => [s.id, s.segments.length])).toEqual([
    ['apartment', 2],
    ['kitchen', 1],
  ])
  expect(result.sources[0].segments[0].playbackUrl).toContain('camera=apartment')
  expect(requests.some((path) => path.startsWith('/api/sources'))).toBe(false)
  const selected = await dayTranscripts('https://vod.example', day, 'kitchen', 'view')
  expect(selected.sources[0].segments).toHaveLength(2)
  expect(selected.sources[0].segments[0].playbackUrl).toContain('camera=kitchen')
  expect(selected.availableSources.find((s) => s.id === 'mic')?.count).toBe(1)
})

test('attached audio is queried even outside primary video coverage', async () => {
  mock([view('apartment', { last: start - 1, audioSourceIds: ['mic'] })], {
    '/api/views/apartment/transcript': [segment('audio')],
  })
  expect((await dayTranscripts('https://vod.example', day)).totalCount).toBe(1)
})

test('legacy source links resolve views first, otherwise use source metadata and endpoints', async () => {
  const source: Source = {
    id: 'raw',
    name: 'Raw',
    mediaType: 'audio',
    publish: false,
    timezone: 'Asia/Tokyo',
    first: start,
    last: end,
    latestReady: start,
  }
  const requests = mock(
    [view('apartment')],
    {
      '/api/views/apartment/transcript': [segment('view')],
      '/api/sources/raw/transcript': [segment('physical')],
    },
    [source]
  )
  expect((await dayTranscripts('https://vod.example', day, 'apartment')).activeKind).toBe('view')
  expect(requests).not.toContain('/api/sources')
  const physical = await dayTranscripts('https://vod.example', day, 'raw')
  expect(physical.activeKind).toBe('source')
  expect(physical.sources[0].segments).toHaveLength(1)
  expect(requests).toContain('/api/sources/raw/transcript?date=2026-10-20')
  expect(requests).toContain('/api/sources/raw/transcript?date=2026-10-21')
  expect((await dayTranscripts('https://vod.example', day, 'unknown')).sources).toEqual([])
})

test('null coverage is empty and unknown timezone is reported without guessing', async () => {
  for (const timezone of [null, 'America/Chicago']) {
    const requests = mock([], {}, [
      {
        id: 'raw',
        name: 'Raw',
        publish: false,
        mediaType: 'audio',
        timezone,
        first: timezone ? null : start,
        last: timezone ? null : end,
        latestReady: null,
      },
    ])
    const result = await dayTranscripts('https://vod.example', day, 'raw')
    expect(result.sources).toEqual([])
    expect(result.warnings.length).toBe(timezone ? 0 : 1)
    expect(requests).toEqual(['/api/views', '/api/sources'])
  }
})

test('clip to Chicago day, deduplicate overlapping local dates, and sort deterministically', async () => {
  mock([view('tokyo', { timezone: 'Asia/Tokyo' })], {
    '/api/views/tokyo/transcript': [
      segment('after', 0, 'tokyo', end),
      segment('before', 0, 'tokyo', start - 1000),
      segment('late', 0, 'tokyo', start + 5000),
      segment('early', 1, 'tokyo', start - 500),
      segment('early', 0, 'tokyo', start - 500),
    ],
  })
  const result = await dayTranscripts('https://vod.example', day)
  expect(result.sources[0].segments.map((s) => [s.recordingId, s.segmentIndex])).toEqual([
    ['early', 0],
    ['early', 1],
    ['late', 0],
  ])
})

test('upstream failures remain warnings alongside successful transcripts', async () => {
  mock([view('apartment'), view('mic', { mediaType: 'audio' })], {
    '/api/views/apartment/transcript': 502,
    '/api/views/mic/transcript': [segment('audio')],
  })
  const result = await dayTranscripts('https://vod.example', day)
  expect(result.warnings).toEqual(['Transcript for apartment is temporarily unavailable.'])
  expect(result.sources.map((s) => s.id)).toEqual(['mic'])
})

test('timeOfDay formats UTC timestamps in Central time', () => {
  expect(timeOfDay(Date.parse('2026-10-20T14:05:09Z'))).toBe('09:05:09')
})
