import {
  githubItem,
  youtubeItem,
  type GithubRepo,
  type GithubCommit,
  type YoutubeItem,
} from '../src/lib/sources'
import type { SourceItem } from '../src/lib/types'
import { replaceSource } from './db'
import { mkdir } from 'node:fs/promises'

// Conditional requests save bandwidth while still reconciling amended commits,
// repository visibility changes, and removals across the complete snapshot.
type GithubPage = { etag: string; next: string; items: unknown[] }
const githubCache: Record<string, GithubPage> = await Bun.file('.data/github-http.json')
  .json()
  .catch(() => ({}))

async function githubPages<T>(url: string): Promise<T[]> {
  const all: T[] = []
  while (url) {
    const cached = githubCache[url]
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}),
      },
      signal: AbortSignal.timeout(30000),
    })
    if (response.status === 304 && cached) {
      all.push(...(cached.items as T[]))
      url = cached.next
      continue
    }
    // GitHub represents a repository with no commits as 409.
    if (response.status === 409 && new URL(url).pathname.endsWith('/commits')) break
    if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`)
    const items = (await response.json()) as T[]
    const next = response.headers.get('link')?.match(/<([^>]+)>; rel="next"/)?.[1] ?? ''
    githubCache[url] = { etag: response.headers.get('etag') || '', next, items }
    all.push(...items)
    url = next
  }
  return all
}
async function syncGithub() {
  if (!process.env.GITHUB_TOKEN) throw new Error('Set GITHUB_TOKEN')
  const repos = await githubPages<GithubRepo>(
    'https://api.github.com/user/repos?sort=pushed&per_page=100'
  )
  const items: SourceItem[] = []
  for (const repo of repos.filter((r) => !r.private)) {
    const url = new URL(repo.commits_url.replace(/\{.*\}/, ''))
    url.searchParams.set('per_page', '100')
    if (repo.name === 'mdn-content') url.searchParams.set('author', 'ohnsh')
    const commits = await githubPages<GithubCommit>(url.href)
    for (const c of commits) {
      const item = githubItem(repo, c)
      if (item) items.push(item)
    }
  }
  await replaceSource('github', items)
  await mkdir('.data', { recursive: true })
  await Bun.write('.data/github-http.json', JSON.stringify(githubCache))
}
async function youtubeApi<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://youtube.googleapis.com/youtube/v3/${path}`)
  url.search = new URLSearchParams({ ...params, key: process.env.YT_API_KEY! }).toString()
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`YouTube: HTTP ${response.status}`)
  return response.json() as Promise<T>
}
async function playlist(id: string) {
  let token = ''
  const items: YoutubeItem[] = []
  do {
    const page = await youtubeApi<{ items: YoutubeItem[]; nextPageToken?: string }>(
      'playlistItems',
      { playlistId: id, part: 'snippet', maxResults: '50', ...(token ? { pageToken: token } : {}) }
    )
    items.push(...page.items)
    token = page.nextPageToken ?? ''
  } while (token)
  return items
}
async function syncYoutube() {
  if (!process.env.YT_API_KEY) throw new Error('Set YT_API_KEY')
  const channel = await youtubeApi<{
    items: { contentDetails: { relatedPlaylists: { uploads: string } } }[]
  }>('channels', { part: 'contentDetails', forHandle: 'ohn-sh' })
  const id: string = channel.items[0].contentDetails.relatedPlaylists.uploads
  const [uploads, shorts] = await Promise.all([playlist(id), playlist(id.replace(/^UU/, 'UUSH'))])
  const shortIds = new Set(shorts.map((v) => v.snippet.resourceId.videoId))
  await replaceSource(
    'youtube',
    uploads.map((v) => youtubeItem(v, shortIds)).filter((v): v is SourceItem => v !== null)
  )
}
const source = process.argv[2] || 'all'
if (!['all', 'github', 'youtube'].includes(source))
  throw new Error('Expected github, youtube, or all')
if (source !== 'youtube') await syncGithub()
if (source !== 'github') await syncYoutube()
