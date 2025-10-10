
export const TELEGRAM_API = 'https://api.telegram.org/bot'
export const FLIGHTRADAR24_URL = 'https://www.flightradar24.com/data/flights'
export const VERCEL_FLIGHTS_API_URL = 'https://flights-taupe.vercel.app/api/tlv-arrivals'

export const CRON_PERIOD_SECONDS = 180

// Alarm timing constants (in milliseconds)
export const ALARM_MIN_PERIOD = 2 * 60 * 1000  // 2 minutes
export const ALARM_MAX_PERIOD = 3 * 60 * 1000  // 3 minutes

// Storage key for last alarm run
export const LAST_ALARM_RUN_KEY = 'last_alarm_run'

export const getTelegramUrl = (env: Env) => `${TELEGRAM_API}${env.BOT_TOKEN}`
