import { resolve } from 'node:path'
import { githubItem, youtubeItem, type GithubRepo, type GithubCommit, type YoutubeItem } from '../src/lib/sources'
import type { SourceItem } from '../src/lib/types'
import { replaceSource } from './db'

const root = resolve(process.argv[2] || '../days/.days')
const repos: GithubRepo[] = await Bun.file(`${root}/github/repos.json`).json()
const commits: SourceItem[] = []
for (const repo of repos.filter(r => !r.private)) {
  const rows: GithubCommit[] = await Bun.file(`${root}/github/commits/${repo.name}.json`).json()
  for (const commit of rows) { const item = githubItem(repo, commit); if (item) commits.push(item) }
}
const uploads: YoutubeItem[] = await Bun.file(`${root}/youtube/uploads.json`).json()
const shorts: YoutubeItem[] = await Bun.file(`${root}/youtube/shorts.json`).json()
const shortIds = new Set(shorts.map(s => s.snippet.resourceId.videoId))
const videos = uploads.map(v => youtubeItem(v, shortIds)).filter((v): v is SourceItem => v !== null)
await replaceSource('github', commits)
await replaceSource('youtube', videos)
