import cloudflareProvider from '@astrojs/cloudflare/cache/provider'
import type { CacheProviderFactory } from 'astro'

// Keep the adapter's tagging/purging behavior, but bound staleness on errors.
// Astro's CacheOptions currently exposes maxAge/swr, not stale-if-error.
const factory: CacheProviderFactory = (config) => {
  const provider = cloudflareProvider(config)
  return {
    ...provider,
    setHeaders(options, request) {
      const headers = provider.setHeaders!(options, request)
      const policy = headers.get('Cloudflare-CDN-Cache-Control')
      if (policy)
        headers.set('Cloudflare-CDN-Cache-Control', `${policy}, stale-if-error=0`)
      return headers
    },
  }
}
export default factory
