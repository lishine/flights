# Phase 3: Grammy Integration

**Estimated Time**: 2 hours  
**Goal**: Replace raw Telegram API calls with Grammy framework

---

## Changes in This Phase

### 1. Create Bot Service

**File**: `workers/src/services/bot.ts` (NEW)

```typescript
import { Bot } from 'grammy'
import type { Env } from '../env'

/**
 * Creates and configures Grammy bot instance
 */
export const createBot = (env: Env) => {
	const bot = new Bot(env.BOT_TOKEN)
	
	// Global error handler
	bot.catch((err) => {
		const ctx = err.ctx
		console.error(`Error while handling update ${ctx.update.update_id}:`)
		console.error('Error:', err.error)
		
		// Try to notify user of error
		if (ctx.chat) {
			ctx.reply('❌ An error occurred. Please try again later.').catch(console.error)
		}
	})
	
	return bot
}
```

---

### 2. Update Telegram Service to Use Grammy

**File**: `workers/src/services/telegram.ts`

Replace entire file with simpler Grammy-based version:

```typescript
import { Bot } from 'grammy'
import type { Env } from '../env'

/**
 * Send a Telegram message using Grammy
 * This is a helper for sending messages outside of command handlers
 */
export const sendTelegramMessage = async (
	bot: Bot,
	chatId: number,
	text: string,
	options: {
		disableNotification?: boolean
		replyMarkup?: any
	} = {}
) => {
	try {
		await bot.api.sendMessage(chatId, text, {
			parse_mode: 'Markdown',
			disable_notification: options.disableNotification || false,
			disable_web_page_preview: false,
			reply_markup: options.replyMarkup
		})
	} catch (error) {
		console.error('Failed to send Telegram message:', {
			chatId,
			error: error instanceof Error ? error.message : 'Unknown error',
			textLength: text.length,
			timestamp: new Date().toISOString()
		})
	}
}
```

---

### 3. Refactor Command Handlers

**File**: `workers/src/handlers/commands.ts`

Complete refactor to use Grammy. This is the biggest change:

```typescript
import { Bot } from 'grammy'
import type { Context } from 'grammy'
import { sendTelegramMessage } from '../services/telegram'
import { addFlightTracking, clearUserTracking, untrackFlight } from '../services/tracking'
import { getFlightIdByNumber, getNotTrackedFlights, generateFakeFlights } from '../services/flightData'
import { getCurrentIdtTime, formatTimeAgo, formatTimestampForDisplay } from '../utils/dateTime'
import { formatTrackingListOptimized, formatFlightSuggestions, escapeMarkdown } from '../utils/formatting'
import { isValidFlightCode } from '../utils/validation'
import { CRON_PERIOD_SECONDS } from '../utils/constants'
import { isAdminUser } from '../middleware/admin'
import type { Env } from '../env'
import type { DurableObjectState } from 'cloudflare:workers'
import versionData from '../../version.json'

/**
 * Setup all bot commands and handlers
 */
export const setupCommands = (bot: Bot, ctx: DurableObjectState, env: Env) => {
	// Shared function to build status message
	const buildStatusMessage = () => {
		const lastUpdatedResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'lastUpdated')
		const updateCountResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'updateCount')
		const dataLengthResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'dataLength')
		const errorResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'last-error')

		const lastUpdated = lastUpdatedResult.toArray()[0] as { value: string } | undefined
		const updateCount = updateCountResult.toArray()[0] as { value: string } | undefined
		const dataLength = dataLengthResult.toArray()[0] as { value: string } | undefined
		const errorResultRow = errorResult.toArray()[0] as { value: string } | undefined

		const errorData = errorResultRow?.value

		let statusMessage = '📊 *System Status*\n\n'

		const timestamp = lastUpdated?.value ? parseInt(lastUpdated.value) || 0 : 0
		if (lastUpdated?.value && timestamp > 0 && timestamp < getCurrentIdtTime().getTime()) {
			const lastUpdate = formatTimestampForDisplay(timestamp)
			const timeAgo = formatTimeAgo(timestamp)
			const totalFetches = updateCount?.value ? parseInt(updateCount.value) || 0 : 0
			const flightsCount = dataLength?.value ? parseInt(dataLength.value) || 0 : 0

			statusMessage +=
				`✅ System: Online\n\n` +
				`📅 Last updated: ${escapeMarkdown(lastUpdate)} (${escapeMarkdown(timeAgo)})\n` +
				`📊 Flights count: ${flightsCount}\n` +
				`🔢 Total fetches: ${totalFetches}\n\n` +
				`📦 Version: ${escapeMarkdown(versionData.version)}\n` +
				`📦 Code updated: ${escapeMarkdown(versionData.update_date)}\n`
		} else {
			statusMessage +=
				'🔶 System: Starting up\n\n' +
				`📦 Version: ${escapeMarkdown(versionData.version)}\n` +
				`📦 Code updated: ${escapeMarkdown(versionData.update_date)}\n`
		}

		if (errorData) {
			const error = JSON.parse(errorData)
			const errorTime = new Date(error.timestamp).toLocaleString()
			statusMessage += `\n\n⚠️ Last error: ${escapeMarkdown(errorTime)}`
		}

		return statusMessage + `\n\n_⏱️ Data refreshes every ${CRON_PERIOD_SECONDS} seconds_`
	}

	// /start command
	bot.command('start', async (gramCtx) => {
		await gramCtx.reply('Welcome! Use /help for available commands.')
	})

	// /help command
	bot.command('help', async (gramCtx) => {
		const helpText = 
			'*Available Commands*\n\n' +
			'/track LY086 - Track a flight\n' +
			'/status - System status\n' +
			'/clear_tracked - Clear tracked flights'
		await gramCtx.reply(helpText, { parse_mode: 'Markdown' })
	})

	// /track command
	bot.command('track', async (gramCtx) => {
		const chatId = gramCtx.chat.id
		const args = gramCtx.match.trim().split(/\s+/)
		
		if (args.length === 0 || args[0] === '') {
			await gramCtx.reply('Usage: /track LY086 [OE2147 ...]')
			return
		}

		const results = []
		for (const code of args) {
			if (isValidFlightCode(code)) {
				const flightId = getFlightIdByNumber(code.toUpperCase().replace(' ', ''), ctx)
				if (flightId) {
					addFlightTracking(chatId, flightId, env, ctx)
					results.push(`✓ Now tracking ${code.toUpperCase()}`)
				} else {
					results.push(`❌ Flight not found: ${code}`)
				}
			} else {
				results.push(`❌ Invalid flight code: ${code}`)
			}
		}
		await gramCtx.reply(results.join('\n'))
	})

	// /clear_tracked command
	bot.command('clear_tracked', async (gramCtx) => {
		const chatId = gramCtx.chat.id
		const clearedCount = clearUserTracking(chatId, env, ctx)
		const message =
			clearedCount > 0
				? `✅ Cleared ${clearedCount} tracked flight${clearedCount > 1 ? 's' : ''} from your subscriptions.`
				: 'ℹ️ You had no tracked flights to clear.'
		await gramCtx.reply(message)
	})

	// /status command
	bot.command('status', async (gramCtx) => {
		const responseText = buildStatusMessage()
		const inlineKeyboard = [
			[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
			[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
			[{ text: '🔄 Refresh Status', callback_data: 'get_status' }],
		]
		await gramCtx.reply(responseText, { 
			parse_mode: 'Markdown',
			reply_markup: { inline_keyboard: inlineKeyboard }
		})
	})

	// /test command (admin only)
	bot.command('test', async (gramCtx) => {
		const chatId = gramCtx.from?.id
		
		if (!isAdminUser(chatId, env)) {
			await gramCtx.reply('❌ Admin only command')
			return
		}

		try {
			// Clear existing fake flights
			ctx.storage.sql.exec("DELETE FROM flights WHERE flight_number LIKE 'FAKE_%'")

			// Add new fake flights
			const fakeFlights = generateFakeFlights()
			for (const flight of fakeFlights) {
				ctx.storage.sql.exec(
					`INSERT INTO flights (id, flight_number, status, sta, eta, city, airline, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					flight.id,
					flight.flight_number,
					flight.status,
					flight.sta,
					flight.eta,
					flight.city,
					flight.airline,
					flight.created_at,
					flight.updated_at
				)
			}

			await gramCtx.reply(
				`✅ Added ${fakeFlights.length} test flights to the database.\n\n` +
				`Use /status to see flight suggestions with the test data.`
			)
		} catch (error) {
			console.error('Error adding test data:', error)
			await gramCtx.reply('❌ Failed to add test data. Please try again.')
		}
	})

	// Callback query handlers
	bot.callbackQuery('get_status', async (gramCtx) => {
		const responseText = buildStatusMessage()
		const replyMarkup = {
			inline_keyboard: [
				[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
				[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
				[{ text: '🔄 Refresh Status', callback_data: 'get_status' }],
			],
		}
		await gramCtx.answerCallbackQuery('🔄 Refreshing...')
		await gramCtx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: replyMarkup
		})
	})

	bot.callbackQuery('show_tracked', async (gramCtx) => {
		const chatId = gramCtx.callbackQuery.message?.chat.id
		if (!chatId) return

		const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(chatId, env, ctx)
		const responseText = `🚨 *Your Tracked Flights*\n\n${trackedMessage}`
		
		const navigationButtons = [
			[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
			[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
		]
		const finalMarkup = {
			inline_keyboard: [...(trackedMarkup?.inline_keyboard || []), ...navigationButtons],
		}

		await gramCtx.answerCallbackQuery()
		await gramCtx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: finalMarkup
		})
	})

	bot.callbackQuery('show_suggestions', async (gramCtx) => {
		const chatId = gramCtx.callbackQuery.message?.chat.id
		if (!chatId) return

		const eligibleFlights = getNotTrackedFlights(chatId, ctx)
		const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(eligibleFlights.slice(0, 5))
		const responseText = `🎯 *Flight Suggestions*\n\n${text}`
		
		const replyMarkup = {
			inline_keyboard: [
				[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
				[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
				...(suggestionsMarkup?.inline_keyboard || []),
			],
		}

		await gramCtx.answerCallbackQuery()
		await gramCtx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: replyMarkup
		})
	})

	// Handle track_suggested callback
	bot.callbackQuery(/^track_suggested:(.+)$/, async (gramCtx) => {
		const chatId = gramCtx.callbackQuery.message?.chat.id
		if (!chatId) return

		const flightCodes = gramCtx.match[1].split(',')
		const results = []
		
		for (const code of flightCodes) {
			if (isValidFlightCode(code)) {
				const flightId = getFlightIdByNumber(code.toUpperCase().replace(' ', ''), ctx)
				if (flightId) {
					addFlightTracking(chatId, flightId, env, ctx)
					results.push(`✓ Now tracking ${code.toUpperCase()}`)
				} else {
					results.push(`❌ Flight not found: ${code}`)
				}
			} else {
				results.push(`❌ Invalid flight code: ${code}`)
			}
		}
		
		await gramCtx.answerCallbackQuery('Tracking flights...')
		await gramCtx.editMessageText(results.join('\n'), { parse_mode: 'Markdown' })
	})

	// Handle track_single callback
	bot.callbackQuery(/^track_single:(.+)$/, async (gramCtx) => {
		const chatId = gramCtx.callbackQuery.message?.chat.id
		if (!chatId) return

		const flightNumber = gramCtx.match[1]
		const flightId = getFlightIdByNumber(flightNumber.toUpperCase().replace(' ', ''), ctx)
		
		if (flightId) {
			addFlightTracking(chatId, flightId, env, ctx)
			await gramCtx.answerCallbackQuery('Tracking flight...')
			await gramCtx.reply(`✓ Now tracking ${flightNumber.toUpperCase()}`)
		} else {
			await gramCtx.answerCallbackQuery('Flight not found')
		}
	})

	// Handle untrack_single callback
	bot.callbackQuery(/^untrack_single:(.+)$/, async (gramCtx) => {
		const chatId = gramCtx.callbackQuery.message?.chat.id
		if (!chatId) return

		const flightId = gramCtx.match[1]
		untrackFlight(chatId, flightId, env, ctx)
		
		await gramCtx.answerCallbackQuery('Untracking flight...')
		
		// Update the message to show new tracked flights list
		const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(chatId, env, ctx)
		const responseText = `🚨 *Your Tracked Flights*\n\n${trackedMessage}`
		
		const navigationButtons = [
			[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
			[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
		]
		const finalMarkup = {
			inline_keyboard: [...(trackedMarkup?.inline_keyboard || []), ...navigationButtons],
		}

		await gramCtx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: finalMarkup
		})
	})
}

/**
 * Handle incoming webhook update using Grammy
 */
export const handleUpdate = async (bot: Bot, update: any) => {
	await bot.handleUpdate(update)
}
```

---

### 4. Update Durable Object to Use Grammy

**File**: `workers/src/durable.ts`

Update the webhook handler:

```typescript
import { DurableObject } from 'cloudflare:workers'
import { Env } from './env'
import { runScheduledJob } from './handlers/cron'
import { setupCommands, handleUpdate } from './handlers/commands'
import { createBot } from './services/bot'
import { resetSchema } from './schema'
import { CRON_PERIOD_SECONDS } from './utils/constants'
import { checkRateLimits, getRequestIP } from './middleware/rateLimit'

export class FlightDO extends DurableObject<Env> {
	private alarmCount: number = 0

	constructor(ctx: DurableObjectState, env: Env) {
		console.log('constructor')
		super(ctx, env)

		ctx.blockConcurrencyWhile(async () => {
			this.alarmCount = ctx.storage.kv.get<number>('alarmCount') || 0

			let currentAlarm = await ctx.storage.getAlarm()
			if (currentAlarm == null) {
				console.log('constructor currentAlarm == null')
				const oneMinute = CRON_PERIOD_SECONDS * 1000
				console.log(`Setting initial alarm for ${oneMinute}ms from now`)
				await ctx.storage.setAlarm(Date.now() + oneMinute)
			}
		})
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		if (request.method === 'POST' && url.pathname === '/webhook') {
			try {
				const update = await request.json()
				
				// Rate limiting
				let chatId: number | undefined
				if ('message' in update && update.message) {
					chatId = update.message.chat.id
				} else if ('callback_query' in update && update.callback_query?.message) {
					chatId = update.callback_query.message.chat.id
				}
				
				if (chatId) {
					const ip = getRequestIP(request)
					const rateLimitResult = checkRateLimits(chatId, ip, this.ctx)
					
					if (!rateLimitResult.allowed) {
						console.warn(`Rate limit exceeded for chatId ${chatId}, reason: ${rateLimitResult.reason}`)
						return new Response('Too Many Requests', { status: 429 })
					}
				}
				
				// Create bot and setup commands
				const bot = createBot(this.env)
				setupCommands(bot, this.ctx, this.env)
				
				// Handle update with Grammy
				await handleUpdate(bot, update)
				
				return new Response('OK')
			} catch (error) {
				console.error('Error processing webhook:', error)
				return new Response('Internal Server Error', { status: 500 })
			}
		}

		switch (url.pathname) {
			case '/reset-schema':
				resetSchema(this.ctx)
				return new Response('Schema reset successfully', {
					headers: { 'Content-Type': 'text/plain' },
				})
			case '/status':
				const count = this.getAlarmCount()
				return new Response(`FlightDO Status - Alarms fired: ${count}`, {
					headers: { 'Content-Type': 'text/plain' },
				})

			case '/reset':
				this.setAlarmCount(0)
				return new Response('Alarm count reset and new alarm set', {
					headers: { 'Content-Type': 'text/plain' },
				})

			default:
				const currentAlarm = await this.ctx.storage.getAlarm()
				const alarmTime = currentAlarm ? new Date(currentAlarm).toISOString() : 'Not set'
				const currentCount = this.getAlarmCount()

				return new Response(`FlightDO Active\nAlarms fired: ${currentCount}\nNext alarm: ${alarmTime}`, {
					headers: { 'Content-Type': 'text/plain' },
				})
		}
	}

	async alarm(): Promise<void> {
		console.log('alarm')
		runScheduledJob(this.env, this.ctx)
		const currentCount = this.getAlarmCount()
		const newCount = currentCount + 1
		console.log(`Alarm fired! Count: ${newCount}`)
		this.setAlarmCount(newCount)
		const period = CRON_PERIOD_SECONDS * 1000
		console.log(`Setting next alarm for ${period}ms from now`)
		await this.ctx.storage.setAlarm(Date.now() + period)
	}

	async sayHello(): Promise<string> {
		const result = this.ctx.storage.sql.exec("SELECT 'Hello, World!' as greeting").one()
		return result.greeting as string
	}

	private getAlarmCount(): number {
		return this.ctx.storage.kv.get<number>('alarmCount') || 0
	}

	private setAlarmCount(count: number): void {
		this.ctx.storage.kv.put('alarmCount', count)
	}
}
```

---

### 5. Update Alerts Handler (for cron notifications)

**File**: `workers/src/handlers/alerts.ts`

Update to use Grammy for sending notifications:

```typescript
import { createBot } from '../services/bot'
import { sendTelegramMessage } from '../services/telegram'
// ... rest of imports

export const sendAlerts = async (
	changedFlights: Flight[],
	env: Env,
	ctx: DurableObjectState
) => {
	const bot = createBot(env)
	
	for (const flight of changedFlights) {
		const subscribers = getFlightSubscribers(flight.id, ctx)
		
		for (const chatId of subscribers) {
			const message = formatFlightAlert(flight)
			await sendTelegramMessage(bot, chatId, message, { disableNotification: false })
		}
	}
}
```

---

## Acceptance Criteria

### ✅ Code Compiles
```bash
cd workers
npx tsc --noEmit
```

### ✅ Build Succeeds
```bash
cd workers
npm run build
```

### ✅ No Direct Telegram API Calls
Search for direct ofetch Telegram calls (should only find in sendTelegramMessage):
```bash
cd workers
grep -r "api.telegram.org" src/
```

Should only appear in `src/services/telegram.ts` via Grammy.

---

## Testing

Deploy to dev and test manually (Phase 5).

---

## Rollback

```bash
git checkout workers/src/services/bot.ts
git checkout workers/src/services/telegram.ts
git checkout workers/src/handlers/commands.ts
git checkout workers/src/durable.ts
git checkout workers/src/handlers/alerts.ts
```

---

## Next Phase

Once all acceptance criteria pass, proceed to **Phase 4: Approval System**.
