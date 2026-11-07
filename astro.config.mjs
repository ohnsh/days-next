import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import { cacheCloudflare } from '@astrojs/cloudflare/cache'
import mdx from '@astrojs/mdx'
import react from '@astrojs/react'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { validatePosterOverrides } from './src/lib/poster-overrides.ts'

validatePosterOverrides(
  parse(
    readFileSync(new URL('./src/data/poster-overrides.yaml', import.meta.url), 'utf8')
  )
)

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [mdx(), react()],
  cache: {
    provider: {
      ...cacheCloudflare(),
      entrypoint: new URL('./src/server/cache-provider.ts', import.meta.url),
    },
  },
  session: false,
  vite: { resolve: { preserveSymlinks: true } },
})
