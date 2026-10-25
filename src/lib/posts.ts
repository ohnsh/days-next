import type { CollectionEntry } from 'astro:content'

export type PostEntry = CollectionEntry<'posts'>

const visiblePost = (post: PostEntry) => import.meta.env.DEV || !post.data.draft
const byDate = (a: PostEntry, b: PostEntry) =>
  b.data.day.localeCompare(a.data.day) || a.id.localeCompare(b.id)

export async function getAllPosts(): Promise<PostEntry[]> {
  const { getCollection } = await import('astro:content')
  return (await getCollection('posts', visiblePost)).sort(byDate)
}

export async function getPostsForDay(day: string): Promise<PostEntry[]> {
  const { getCollection } = await import('astro:content')
  return (await getCollection('posts', (post) => visiblePost(post) && post.data.day === day)).sort(
    byDate
  )
}

export async function getPostsInRange(firstDay: string, lastDay: string): Promise<PostEntry[]> {
  const { getCollection } = await import('astro:content')
  return (
    await getCollection(
      'posts',
      (post) => visiblePost(post) && post.data.day >= firstDay && post.data.day <= lastDay
    )
  ).sort(byDate)
}

export function postUrl(post: Pick<PostEntry, 'id'>): string {
  return `/posts/${post.id}/`
}

export function shiftHeadingsHtml(html: string, offset: number): string {
  const amount = Math.max(0, Math.floor(offset))
  if (amount === 0) return html

  const protectedBlocks: string[] = []
  const withoutCode = html.replace(
    /<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    (block) => `\u0000HEADING_PROTECTED_${protectedBlocks.push(block) - 1}\u0000`
  )
  const shifted = withoutCode.replace(/<(\/?)h([1-6])(\b[^>]*)>/gi, (_tag, slash, level, rest) => {
    return `<${slash}h${Math.min(6, Number(level) + amount)}${rest}>`
  })
  return shifted.replace(/\u0000HEADING_PROTECTED_(\d+)\u0000/g, (_match, index) =>
    protectedBlocks[Number(index)]
  )
}

interface HtmlBlock {
  html: string
  paragraph: boolean
}

const voidElements = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
  'source', 'track', 'wbr',
])

function tagEnd(html: string, from: number): number {
  let quote = ''
  for (let i = from; i < html.length; i += 1) {
    const char = html[i]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return i + 1
    }
  }
  return html.length
}

/** Split rendered HTML into its top-level text, comment, and element blocks. */
function topLevelBlocks(html: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = []
  let cursor = 0

  while (cursor < html.length) {
    const open = html.indexOf('<', cursor)
    if (open === -1) {
      blocks.push({ html: html.slice(cursor), paragraph: false })
      break
    }
    if (open > cursor) blocks.push({ html: html.slice(cursor, open), paragraph: false })

    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4)
      const after = end === -1 ? html.length : end + 3
      blocks.push({ html: html.slice(open, after), paragraph: false })
      cursor = after
      continue
    }

    const firstEnd = tagEnd(html, open + 1)
    const firstTag = html.slice(open, firstEnd)
    const match = firstTag.match(/^<([a-z][\w:-]*)\b/i)
    if (!match || /^<\//.test(firstTag) || /^<!|^<\?/.test(firstTag)) {
      blocks.push({ html: firstTag, paragraph: false })
      cursor = firstEnd
      continue
    }

    const name = match[1].toLowerCase()
    const paragraph = name === 'p'
    if (voidElements.has(name) || /\/\s*>$/.test(firstTag)) {
      blocks.push({ html: firstTag, paragraph })
      cursor = firstEnd
      continue
    }

    const stack = [name]
    let scan = firstEnd
    while (scan < html.length && stack.length) {
      const nextOpen = html.indexOf('<', scan)
      if (nextOpen === -1) {
        scan = html.length
        break
      }
      if (html.startsWith('<!--', nextOpen)) {
        const commentEnd = html.indexOf('-->', nextOpen + 4)
        scan = commentEnd === -1 ? html.length : commentEnd + 3
        continue
      }
      const end = tagEnd(html, nextOpen + 1)
      const token = html.slice(nextOpen, end)
      const tag = token.match(/^<(\/)?([a-z][\w:-]*)\b/i)
      if (tag) {
        const tagName = tag[2].toLowerCase()
        if (tag[1]) {
          const matching = stack.lastIndexOf(tagName)
          if (matching !== -1) stack.length = matching
        } else if (!voidElements.has(tagName) && !/\/\s*>$/.test(token)) {
          stack.push(tagName)
        }
      }
      scan = end
    }
    blocks.push({ html: html.slice(open, scan), paragraph })
    cursor = scan
  }

  return blocks
}

export function extractExcerptHtml(
  html: string,
  maxParagraphs = 2
): { html: string; hasMore: boolean } {
  const marker = html.indexOf('<!-- excerpt -->')
  if (marker !== -1) {
    const excerpt = html.slice(0, marker).trimEnd()
    return { html: excerpt, hasMore: html.slice(marker + '<!-- excerpt -->'.length).trim().length > 0 }
  }

  const blocks = topLevelBlocks(html)
  let paragraphs = 0
  let end = 0
  let hasMore = false
  for (const block of blocks) {
    if (!block.html.trim()) {
      if (!hasMore) end += block.html.length
      continue
    }
    if (paragraphs >= maxParagraphs) {
      hasMore = true
      break
    }
    if (block.paragraph) paragraphs += 1
    end += block.html.length
  }

  return { html: html.slice(0, end).trimEnd(), hasMore }
}
