import { defineLiveCollection } from 'astro:content'
import { daysLoader } from './loaders/days'

export const collections = { days: defineLiveCollection({ loader: daysLoader() }) }
