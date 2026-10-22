import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import { cacheCloudflare } from '@astrojs/cloudflare/cache'

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'compile' }),
  cache: {
    provider: {
      ...cacheCloudflare(),
      entrypoint: new URL('./src/server/cache-provider.ts', import.meta.url),
    },
  },
  session: false,
  vite: { resolve: { preserveSymlinks: true } },
})
