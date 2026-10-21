import { describe, expect, test } from 'bun:test'
import { dayBounds, dayFromInstant, plainDay, shiftDay } from '../src/lib/dates'
import { githubItem, youtubeDay } from '../src/lib/sources'
import { coveredMilliseconds } from '../src/server/vod'

describe('Chicago days', () => {
  test('DST days have real local-midnight boundaries', () => {
    const spring = dayBounds('2026-03-08'), fall = dayBounds('2026-11-01')
    expect(spring.end - spring.start).toBe(23 * 3600000)
    expect(fall.end - fall.start).toBe(25 * 3600000)
    expect(new Date(spring.start).toISOString()).toBe('2026-03-08T06:00:00.000Z')
    expect(new Date(spring.end).toISOString()).toBe('2026-03-09T05:00:00.000Z')
  })
  test('timestamp and plain date are different concepts', () => {
    expect(dayFromInstant('2026-10-21T00:30:00Z')).toBe('2026-10-20')
    expect(plainDay('2026-10-21')).toBe('2026-10-21')
    expect(() => plainDay('2026-02-30')).toThrow()
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })
  test('YouTube title dates override publication and preserve December/January intent', () => {
    expect(youtubeDay('Walk 10/20/2026', '2026-10-22T03:00:00Z')).toBe('2026-10-20')
    expect(youtubeDay('December 31', '2027-01-02T17:00:00Z')).toBe('2026-12-31')
    expect(youtubeDay('January 1', '2026-12-31T17:00:00Z')).toBe('2027-01-01')
    expect(youtubeDay('Nothing dated', '2026-10-21T00:30:00Z')).toBe('2026-10-20')
    expect(youtubeDay('February 30, 2026', '2026-03-02T18:00:00Z')).toBe('2026-03-02')
  })
  test('coverage clips cross-midnight footage and merges overlaps', () => {
    expect(coveredMilliseconds([{ start: 0, end: 15 }, { start: 10, end: 25 }, { start: 30, end: 100 }], 5, 40)).toBe(30)
    expect(coveredMilliseconds([{ start: 0, end: 5 }], 5, 40)).toBe(0)
  })
  test('private repositories are excluded before import', () => {
    expect(githubItem({ name: 'secret', full_name: 'me/secret', private: true, commits_url: '' }, {
      sha: 'a', html_url: '', commit: { message: 'secret', author: { name: 'John Sherrell', email: 'me@ohn.sh', date: '2026-10-20T12:00:00Z' } },
    })).toBeNull()
  })
})
