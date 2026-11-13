import { expect, test } from 'bun:test'
import { parseSocialSelection, daySocialKey } from '../src/lib/social'
import { resolveSocialSelection } from '../src/server/social'
import { readItem } from '../src/server/database'
import { createClient } from '@libsql/client'
import type { Day, SourceItem } from '../src/lib/types'

test('social selection keeps source identities and rejects ambiguous or malformed input', () => {
  const parse = (query: string) => parseSocialSelection(new URLSearchParams(query))
  expect(parse('id=youtube:abc-123&for-day=2026-11-12')).toMatchObject({
    id: 'youtube:abc-123',
    forDay: '2026-11-12',
  })
  expect(parse('day=2026-11-12&camera=quad')).toMatchObject({ camera: 'quad' })
  expect(daySocialKey('2026-11-12')).toBe('dates/2026-11-12')
  for (const query of [
    '',
    'day=2026-02-30',
    'day=2026-11-12&id=youtube:a',
    'id=youtube:a&camera=quad',
    'id=youtube:a&section=vod',
    'day=2026-11-12&section=invalid',
    'day=2026-11-12&all-cameras=false',
    'id=../secret',
    'day=2026-11-12&day=2026-11-11',
  ]) {
    expect(() => parse(query)).toThrow()
  }
})

test('selection publishes to distinct keys, honors camera visibility, and refuses partial captures', async () => {
  const item: SourceItem = {
    id: 'youtube:abc',
    source: 'youtube',
    day: '2026-11-12',
    title: 'A video',
    description: '',
    occurredAt: '',
    group: '',
    tags: [],
    thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
  }
  const day: Day = {
    day: item.day,
    items: [item],
    events: [],
    warnings: [],
    cameras: ['quad', 'bedroom'].map((id) => ({
      id,
      name: id,
      poster: `https://vod-media.ohn.sh/${id}.jpg`,
      count: 1,
      coveredMs: 1000,
      at: '',
      playerDay: item.day,
    })),
  }
  const sources = { day: async () => day, item: async () => item }
  const resolve = (query: string) =>
    resolveSocialSelection(parseSocialSelection(new URLSearchParams(query)), sources)
  const grid = await resolve('day=2026-11-12')
  expect(grid.posters.map((p) => p.id)).toEqual(['quad', 'youtube:abc'])
  expect(grid.affectedDays).toEqual([item.day])
  expect((await resolve('day=2026-11-12&all-cameras=true')).posters).toHaveLength(3)
  expect((await resolve('id=youtube:abc')).request.key).toBe('items/youtube:abc')
  expect((await resolve('id=youtube:abc')).affectedDays).toEqual([])
  expect((await resolve('id=youtube:abc&for-day=2026-11-12')).request.key).toBe(
    'dates/2026-11-12'
  )
  expect((await resolve('day=2026-11-12&camera=bedroom')).posters[0].id).toBe('bedroom')
  await expect(resolve('id=youtube:abc&for-day=2026-11-11')).rejects.toThrow('must match')
  await expect(resolve('day=2026-11-12&camera=missing')).rejects.toThrow(
    'Camera not found'
  )
  day.warnings = ['VOD unavailable']
  await expect(resolve('day=2026-11-12')).rejects.toThrow('temporarily unavailable')
  expect((await resolve('day=2026-11-12&section=youtube')).posters).toHaveLength(1)
  delete item.thumbnail
  await expect(resolve('id=youtube:abc')).rejects.toThrow('no poster')
})

test('source-item lookup never exposes private rows', async () => {
  const db = createClient({ url: ':memory:' })
  try {
    await db.execute(
      'CREATE TABLE source_items (id TEXT PRIMARY KEY, payload TEXT, is_public INTEGER)'
    )
    for (const visible of [0, 1])
      await db.execute({
        sql: 'INSERT INTO source_items VALUES (?, ?, ?)',
        args: [String(visible), JSON.stringify({ id: String(visible) }), visible],
      })
    expect(await readItem(db, '0')).toBeNull()
    expect(await readItem(db, 'missing')).toBeNull()
    expect(await readItem(db, '1')).toMatchObject({ id: '1' })
  } finally {
    db.close()
  }
})
