import { scriptDatabase } from './db'
import { readdir } from 'node:fs/promises'
const db = scriptDatabase()
try {
  await db.execute('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set((await db.execute('SELECT name FROM schema_migrations')).rows.map(r => String(r.name)))
  const directory = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    if (applied.has(name)) continue
    const tx = await db.transaction('write')
    try {
      await tx.executeMultiple(await Bun.file(new URL(name, directory)).text())
      await tx.execute({ sql: 'INSERT INTO schema_migrations VALUES (?,?)', args: [name, new Date().toISOString()] })
      await tx.commit()
      console.log(`Applied ${name}`)
    } catch (error) { await tx.rollback(); throw error }
    finally { tx.close() }
  }
  console.log('Days schema is ready')
} finally { db.close() }
