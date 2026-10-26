import { expect, test } from 'bun:test'
import cacheProvider from '../src/server/cache-provider'
import { dayCachePolicy } from '../src/lib/dates'

test('day cache policy uses short TTLs for recent dates and long TTLs only for historical dates', () => {
  const now = '2026-10-25'
  expect(dayCachePolicy(now, now)).toEqual({ maxAge: 60, swr: 15 })
  expect(dayCachePolicy('2026-10-22', now)).toEqual({ maxAge: 60, swr: 15 })
  expect(dayCachePolicy('2026-10-17', now)).toEqual({ maxAge: 604800, swr: 86400 })
})

test('a feed receives long caching only when every represented day is historical', () => {
  const now = '2026-10-25'
  expect(dayCachePolicy(['2026-10-17', '2026-10-22', '2026-10-15'], now)).toEqual({
    maxAge: 60,
    swr: 15,
  })
  expect(dayCachePolicy(['2026-10-17', '2026-10-15', '2026-10-10'], now)).toEqual({
    maxAge: 604800,
    swr: 86400,
  })
})

test('Cloudflare route cache retains day/path tags and bounds stale-on-error behavior', () => {
  const provider = cacheProvider(undefined)
  const headers = provider.setHeaders!(
    { maxAge: 60, swr: 15, tags: ['days', 'day:2026-10-18', 'day:2026-10-19'] },
    new Request('https://days.example/?before=2026-10-20')
  )
  const policy = headers.get('Cloudflare-CDN-Cache-Control')!
  expect(policy).toContain('max-age=60')
  expect(policy).toContain('stale-while-revalidate=15')
  expect(policy).toContain('stale-if-error=0')
  expect(policy).not.toContain('s-maxage')
  expect(headers.get('Cache-Tag')).toContain('day:2026-10-18')
  expect(headers.get('Cache-Tag')).toContain('day:2026-10-19')
  // Preserve the adapter's path invalidation tag in addition to our data tags.
  expect(headers.get('Cache-Tag')!.split(',').length).toBeGreaterThan(3)
  expect(headers.has('Cache-Control')).toBe(false)
})
