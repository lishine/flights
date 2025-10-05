import type { Env } from '../env'

export const TELEGRAM_API = 'https://api.telegram.org/bot'
export const FLIGHTRADAR24_URL = 'https://www.flightradar24.com/data/flights'
export const VERCEL_FLIGHTS_API_URL = 'https://flights-taupe.vercel.app/api/tlv-arrivals'

export const CRON_PERIOD_SECONDS = 180

export const getTelegramUrl = (env: Env) => `${TELEGRAM_API}${env.BOT_TOKEN}`
