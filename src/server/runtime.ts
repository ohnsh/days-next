import { getSecret } from 'astro:env/server'
import { database } from './database'

export const daysDatabase = () =>
  database(getSecret('DAYS_DATABASE_URL'), getSecret('DAYS_AUTH_TOKEN'))
export const vodBaseUrl = () => getSecret('VOD_BASE_URL') || 'https://vod.ohn.sh'
export const vodAdminToken = () => getSecret('VOD_ADMIN_API_TOKEN') || ''
