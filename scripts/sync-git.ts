import { collectGit } from './git'
import { replaceSource } from './db'

const args = process.argv.slice(2)
if (args.length > 1) throw new Error('Usage: bun run sync:git [manifest.json]')
// Collect every repository before publishing the complete Git source snapshot.
await replaceSource('git', await collectGit(args[0] ?? 'git-repositories.json'))
