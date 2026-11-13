import type { SourceItem } from './types'

const categoryOrder = ['🎙️', '🤳', '🐶', '🏃‍♂️', '🎣', '🚗']
export function orderedVideos(items: SourceItem[]) {
  const rank = (category: string) => {
    const index = categoryOrder.indexOf(category)
    return index < 0 ? categoryOrder.length : index
  }
  return items
    .filter((item) => item.source === 'youtube')
    .sort((a, b) => {
      const ac = a.tags[0] ?? '',
        bc = b.tags[0] ?? ''
      return (
        rank(ac) - rank(bc) ||
        ac.localeCompare(bc) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id)
      )
    })
}
