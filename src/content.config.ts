import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '**/[^_]*.{md,mdx}' }),
  schema: z
    .object({
      title: z.string(),
      date: z.coerce.date(),
      draft: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
      excerpt: z.string().optional(),
    })
    .transform((data) => ({ ...data, day: data.date.toISOString().slice(0, 10) })),
})

export const collections = { posts }
