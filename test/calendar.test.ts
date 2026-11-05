import { afterEach, expect, test } from 'bun:test'
import { vodCalendar } from '../src/server/vod'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

test('calendar unions availability using monthly camera endpoints only', async () => {
  const requests: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    requests.push(url.pathname + url.search)
    if (url.pathname === '/api/views')
      return Response.json([
        { id: 'one', mediaType: 'video' },
        { id: 'two', mediaType: 'audio/video' },
      ])
    if (url.pathname === '/api/views/one/calendar') {
      return Response.json({ month: '2026-10', days: { '2026-10-01': true, '2026-10-02': false } })
    }
    if (url.pathname === '/api/views/two/calendar') {
      return Response.json({ month: '2026-10', days: { '2026-10-01': false, '2026-10-03': true } })
    }
    throw new Error(`Unexpected request: ${url}`)
  }) as typeof fetch
  expect(await vodCalendar('https://vod.example', '2026-10')).toEqual({
    month: '2026-10',
    days: { '2026-10-01': true, '2026-10-03': true },
    allDays: { '2026-10-01': true, '2026-10-03': true },
  })
  expect(requests).toEqual([
    '/api/views',
    '/api/views/one/calendar?month=2026-10',
    '/api/views/two/calendar?month=2026-10',
  ])
})

test('views exclude audio entirely and only show bedroom availability in allDays', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/views') {
      return Response.json(
        ['apartment', 'bedroom', 'new-microphone'].map((id) => ({
          id,
          mediaType: id === 'new-microphone' ? 'audio' : 'audio/video',
        }))
      )
    }
    if (url.pathname === '/api/views/apartment/calendar') {
      return Response.json({ days: { '2026-10-01': true } })
    }
    if (url.pathname === '/api/views/bedroom/calendar') {
      return Response.json({ days: { '2026-10-01': true, '2026-10-02': true } })
    }
    throw new Error(`Audio sources must not be requested: ${url}`)
  }) as typeof fetch
  expect(await vodCalendar('https://vod.example', '2026-10')).toEqual({
    month: '2026-10',
    days: { '2026-10-01': true },
    allDays: { '2026-10-01': true, '2026-10-02': true },
  })
})

test('calendar failures do not masquerade as days without content', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    new URL(String(input)).pathname === '/api/views'
      ? Response.json([{ id: 'one' }])
      : new Response('Unavailable', { status: 503 })) as typeof fetch
  const error = await vodCalendar('https://vod.example', '2026-10').catch((error: Error) => error)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toBe('VOD responded 503')
})
