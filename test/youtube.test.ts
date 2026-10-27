import { afterEach, expect, test } from 'bun:test'
import { createClient, type Client } from '@libsql/client'
import type { SourceItem } from '../src/lib/types'
import { handleYoutubeRequest, type YoutubeRouteCache } from '../src/server/youtube'

const clients: Client[] = []

function database() {
  const db = createClient({ url: ':memory:' })
  clients.push(db)
  return db
}

async function schema(db: Client) {
  await db.executeMultiple(`
    CREATE TABLE source_items (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      day TEXT NOT NULL,
      payload TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `)
}

function youtube(
  id: string,
  day: string,
  title: string,
  extra: Partial<SourceItem> = {}
): SourceItem {
  return {
    id: `youtube:${id}`,
    source: 'youtube',
    day,
    title,
    url: `https://www.youtube.com/watch?v=${id}`,
    description: `${title} description`,
    occurredAt: `${day}T15:00:00Z`,
    group: 'ohn-sh',
    tags: ['🐶'],
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    isShort: false,
    ...extra,
  }
}

afterEach(() => {
  for (const db of clients.splice(0)) db.close()
})

test('GET /api/youtube returns sorted public YouTube clips for a day with CORS and cache tags', async () => {
  const db = database()
  await schema(db)
  const clipB = youtube('vid-b', '2026-10-20', '🐶 Afternoon walk 10/20/2026')
  const clipA = youtube('vid-a', '2026-10-20', '🐶 Morning walk 10/20/2026', { isShort: true })
  const otherDay = youtube('vid-other', '2026-10-19', 'Other day')
  const githubItem: SourceItem = {
    id: 'github:ohnsh/vod:abc',
    source: 'github',
    day: '2026-10-20',
    title: 'Commit on same day',
    url: 'https://github.com/ohnsh/vod/commit/abc',
    description: 'Commit',
    occurredAt: '2026-10-20T12:00:00Z',
    group: 'ohnsh/vod',
    tags: [],
  }
  const privateClip = youtube('vid-priv', '2026-10-20', 'Private clip')

  for (const [item, isPublic] of [
    [clipB, 1],
    [clipA, 1],
    [otherDay, 1],
    [githubItem, 1],
    [privateClip, 0],
  ] as const) {
    await db.execute({
      sql: 'INSERT INTO source_items (id,source,day,payload,is_public,updated_at) VALUES (?,?,?,?,?,?)',
      args: [
        item.id,
        item.source,
        item.day,
        JSON.stringify(item),
        isPublic,
        '2026-10-20T16:00:00Z',
      ],
    })
  }

  let cached: Parameters<YoutubeRouteCache['set']>[0] | undefined
  const cache: YoutubeRouteCache = {
    enabled: true,
    set(options) {
      cached = options
    },
  }

  const response = await handleYoutubeRequest(
    new Request('https://days.ohn.sh/api/youtube?day=2026-10-20'),
    () => db,
    cache
  )

  expect(response.status).toBe(200)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')
  expect(cached).toMatchObject({ tags: ['days', 'day:2026-10-20'] })
  const body = (await response.json()) as SourceItem[]
  expect(body).toEqual([clipB, clipA])
})

test('GET /api/youtube validates date, methods, preflight, and database errors', async () => {
  const preflight = await handleYoutubeRequest(
    new Request('https://days.ohn.sh/api/youtube?day=2026-10-20', { method: 'OPTIONS' }),
    () => {
      throw new Error('Should not open DB on OPTIONS')
    }
  )
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*')

  const invalidMethod = await handleYoutubeRequest(
    new Request('https://days.ohn.sh/api/youtube?day=2026-10-20', { method: 'POST' }),
    () => {
      throw new Error('Should not open DB on POST')
    }
  )
  expect(invalidMethod.status).toBe(405)
  expect(invalidMethod.headers.get('Allow')).toBe('GET, HEAD, OPTIONS')

  const badDay = await handleYoutubeRequest(
    new Request('https://days.ohn.sh/api/youtube?day=2026-02-30'),
    () => {
      throw new Error('Should not open DB on invalid date')
    }
  )
  expect(badDay.status).toBe(400)
  expect(badDay.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(badDay.headers.get('Cache-Control')).toBe('no-store')

  let cached: Parameters<YoutubeRouteCache['set']>[0] | undefined
  const dbFailure = await handleYoutubeRequest(
    new Request('https://days.ohn.sh/api/youtube?day=2026-10-20'),
    () => {
      throw new Error('Database offline')
    },
    {
      enabled: true,
      set(options) {
        cached = options
      },
    }
  )
  expect(dbFailure.status).toBe(503)
  expect(dbFailure.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(dbFailure.headers.get('Cache-Control')).toBe('no-store')
  expect(cached).toBe(false)
})
