import { DurableObject } from 'cloudflare:workers'
import { Bot } from 'grammy'
import { runScheduledJob } from './handlers/cron'
import { setupBotHandlers } from './handlers/commands'
import { resetSchema } from './schema'
import { CRON_PERIOD_SECONDS } from './utils/constants'
import { sendTelegramMessage, sendAdmin } from './services/telegram'
import { BotContext, DOProps } from './types'

export class FlightDO extends DurableObject<Env, DOProps> {
	private bot!: Bot<BotContext>
	private alarmCount: number = 0
	private instanceStartTime: number = Date.now() // Add this
	private requestCount: number = 0 // Add this

	constructor(ctx: DurableObjectState<DOProps>, env: Env) {
		console.log('constructor')
		super(ctx, env)
		this.resetCache()

		ctx.blockConcurrencyWhile(async () => {
			this.bot = new Bot<BotContext>(env.BOT_TOKEN)
			await this.bot.init()
			this.bot.use(async (gramCtx, next) => {
				gramCtx.env = this.env
				gramCtx.DOStore = this.ctx
				await next()
			})
			setupBotHandlers(this.bot)

			this.alarmCount = ctx.storage.kv.get<number>('alarmCount') || 0

			let currentAlarm = await ctx.storage.getAlarm()
			if (currentAlarm == null) {
				console.log('constructor currentAlarm == null')
				const oneMinute = CRON_PERIOD_SECONDS * 1000 // 1 minute in milliseconds
				console.log(`Setting initial alarm for ${oneMinute}ms from now`)
				await ctx.storage.setAlarm(Date.now() + oneMinute)
			}
		})
	}

	private resetCache() {
		Object.assign(this.ctx.props, {
			cache: {},
			debug: false,
		})
	}

	async fetch(request: Request): Promise<Response> {
		this.resetCache() // Reset at start of each request
		const url = new URL(request.url)

		this.requestCount++ // Increment on every request

		if (request.method === 'POST' && url.pathname === '/webhook') {
			try {
				const update = (await request.json()) as any
				await this.bot.handleUpdate(update)
				return new Response('OK')
			} catch (error) {
				console.error('Webhook handling error:', error)
				return new Response('Error', { status: 500 })
			}
		}

		if (url.pathname === '/lifetime') {
			const uptime = Date.now() - this.instanceStartTime
			const uptimeMinutes = Math.floor(uptime / 60000)
			const uptimeSeconds = Math.floor((uptime % 60000) / 1000)

			return new Response(
				`DO Instance Lifetime Stats:\n` +
					`Started: ${new Date(this.instanceStartTime).toISOString()}\n` +
					`Uptime: ${uptimeMinutes}m ${uptimeSeconds}s\n` +
					`Total Requests: ${this.requestCount}\n` +
					`Current Time: ${new Date().toISOString()}`,
				{ headers: { 'Content-Type': 'text/plain' } }
			)
		}

		switch (url.pathname) {
			case '/reset-schema':
				resetSchema(this.ctx)
				// Also restart alarms after schema reset
				this.setAlarmCount(0)
				const oneMinute = CRON_PERIOD_SECONDS * 1000
				await this.ctx.storage.setAlarm(Date.now() + oneMinute)
				console.log('Schema reset and alarm restart triggered')
				return new Response('Schema reset successfully and alarms restarted', {
					headers: { 'Content-Type': 'text/plain' },
				})
			case '/status':
				const count = this.getAlarmCount()
				return new Response(`FlightDO Status - Alarms fired: ${count}`, {
					headers: { 'Content-Type': 'text/plain' },
				})

			case '/reset':
				this.setAlarmCount(0)
				// Force restart the alarm process
				const resetPeriod = CRON_PERIOD_SECONDS * 1000
				await this.ctx.storage.setAlarm(Date.now() + resetPeriod)
				console.log('Manual alarm restart triggered')
				return new Response('Alarm count reset and new alarm set', {
					headers: { 'Content-Type': 'text/plain' },
				})

			default:
				// Return current status with fresh count from storage
				const currentAlarm = await this.ctx.storage.getAlarm()
				const alarmTime = currentAlarm ? new Date(currentAlarm).toISOString() : 'Not set'
				const currentCount = this.getAlarmCount()

				return new Response(`FlightDO Active\nAlarms fired: ${currentCount}\nNext alarm: ${alarmTime}`, {
					headers: { 'Content-Type': 'text/plain' },
				})
		}
	}

	/**
	 * Alarm handler - automatically called by Cloudflare runtime when alarm fires
	 * Uses SQLite-backed synchronous KV API for all storage operations
	 */
	async alarm(): Promise<void> {
		this.resetCache() // Reset at start of each alarm
		const currentCount = this.getAlarmCount()
		const newCount = currentCount + 1

		runScheduledJob(this.env, this.ctx)

		this.setAlarmCount(newCount)

		const period = CRON_PERIOD_SECONDS * 1000
		const nextAlarmTime = Date.now() + period
		await this.ctx.storage.setAlarm(nextAlarmTime)
	}

	/**
	 * Example method using SQLite-backed SQL API (official API)
	 * Demonstrates proper SQL query execution
	 */
	async sayHello(): Promise<string> {
		const result = this.ctx.storage.sql.exec("SELECT 'Hello, World!' as greeting").one()
		return result.greeting as string
	}

	/**
	 * Storage API demonstration methods using SQLite-backed synchronous KV API
	 * These methods show proper usage of the synchronous key-value storage API
	 *
	 * ALL methods use synchronous KV API (ctx.storage.kv.*) for consistency
	 * Only alarm operations use async API (ctx.storage.setAlarm, ctx.storage.getAlarm)
	 */

	/** Get value from storage using synchronous KV API (returns undefined if not found) */
	getStoredValue(key: string): string | undefined {
		return this.ctx.storage.kv.get<string>(key)
	}

	/** Store value in persistent storage using synchronous KV API */
	setStoredValue(key: string, value: string): void {
		this.ctx.storage.kv.put(key, value)
	}

	/** Delete value from storage using synchronous KV API */
	deleteStoredValue(key: string): boolean {
		return this.ctx.storage.kv.delete(key)
	}

	/** List all storage keys using synchronous KV API (for debugging/admin purposes) */
	listStoredKeys(options?: {
		start?: string
		startAfter?: string
		end?: string
		prefix?: string
		reverse?: boolean
		limit?: number
	}): Iterable<[string, unknown]> {
		return this.ctx.storage.kv.list(options)
	}

	/** Get alarm count using synchronous KV API */
	getAlarmCount(): number {
		return this.ctx.storage.kv.get<number>('alarmCount') || 0
	}

	/** Set alarm count using synchronous KV API */
	setAlarmCount(count: number): void {
		this.ctx.storage.kv.put('alarmCount', count)
	}
}
