import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import { cacheCloudflare } from '@astrojs/cloudflare/cache'
import mdx from '@astrojs/mdx'

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [mdx()],
  cache: {
    provider: {
      ...cacheCloudflare(),
      entrypoint: new URL('./src/server/cache-provider.ts', import.meta.url),
    },
  },
  session: false,
  vite: { resolve: { preserveSymlinks: true } },
})
