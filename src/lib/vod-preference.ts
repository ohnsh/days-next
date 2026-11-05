const key = 'days:vod-show-all'
const eventName = 'days:vod-view-change'
let current: boolean | undefined

export function getShowAll() {
  if (current === undefined) {
    try {
      current = localStorage.getItem(key) === 'true'
    } catch {
      current = false
    }
  }
  return current
}

export function setShowAll(value: boolean) {
  current = value
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Keep the preference usable when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(eventName))
}

export function subscribeShowAll(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      current = undefined
      listener()
    }
  }
  window.addEventListener(eventName, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(eventName, listener)
    window.removeEventListener('storage', onStorage)
  }
}
