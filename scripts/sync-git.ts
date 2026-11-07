import { syncGit } from './git'

const args = process.argv.slice(2)
const force = args.includes('--force')
const paths = args.filter((arg) => arg !== '--force')
if (paths.length > 1 || paths.some((arg) => arg.startsWith('-')))
  throw new Error('Usage: bun run sync:git [manifest.yaml] [--force]')
await syncGit(paths[0] ?? 'git-repositories.yaml', { force })
