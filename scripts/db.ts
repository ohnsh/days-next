import { createClient } from '@libsql/client'
import type { SourceItem } from '../src/lib/types'
import { parseEnv } from 'node:util'

// Use the same local connection as the Worker; explicit shell variables win.
const vars = Bun.file(new URL('../.dev.vars', import.meta.url))
if (await vars.exists()) {
  for (const [key, value] of Object.entries(parseEnv(await vars.text()))) process.env[key] ??= value
}

export function scriptDatabase() {
  return createClient({
    url: process.env.DAYS_DATABASE_URL || 'http://127.0.0.1:8080',
    authToken: process.env.DAYS_AUTH_TOKEN,
  })
}
// Replace one complete source snapshot atomically; an interrupted fetch never publishes a partial source.
export async function replaceSource(source: SourceItem['source'], items: SourceItem[]) {
  const db = scriptDatabase()
  const tx = await db.transaction('write')
  try {
    await tx.execute({ sql: 'DELETE FROM source_items WHERE source=?', args: [source] })
    const now = new Date().toISOString()
    for (let offset = 0; offset < items.length; offset += 100)
      await tx.batch(
        items
          .slice(offset, offset + 100)
          .map((item) => ({
            sql: 'INSERT OR REPLACE INTO source_items (id,source,day,payload,is_public,updated_at) VALUES (?,?,?,?,1,?)',
            args: [item.id, source, item.day, JSON.stringify(item), now],
          }))
      )
    await tx.execute({
      sql: 'INSERT OR REPLACE INTO sync_runs VALUES (?,?,?)',
      args: [source, now, items.length],
    })
    await tx.commit()
    console.log(`${source}: imported ${items.length} public items`)
  } catch (error) {
    await tx.rollback()
    throw error
  } finally {
    tx.close()
    db.close()
  }
}
