import { syncGit } from './git'

const args = process.argv.slice(2)
const forceArgs = args.filter((arg) => arg.startsWith('--force='))
const paths = args.filter((arg) => !arg.startsWith('--force='))
const scope = forceArgs[0]
  ?.slice('--force='.length)
  .split(',')
  .map((id) => id.trim())
if (
  paths.length > 1 ||
  paths.some((arg) => arg.startsWith('-')) ||
  forceArgs.length > 1 ||
  scope?.some((id) => !id) ||
  (scope?.includes('all') && scope.length !== 1)
)
  throw new Error('Usage: bun run sync:git [manifest.yaml] [--force=repo-id,repo-id|all]')
const force = scope?.[0] === 'all' ? 'all' : scope
await syncGit(paths[0] ?? 'git-repositories.yaml', { force })
