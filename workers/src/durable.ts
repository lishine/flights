import { DurableObject } from 'cloudflare:workers'
import { Env } from './env'
import { runScheduledJob } from './handlers/cron'
import { handleCommand } from './handlers/commands'
import { resetSchema } from './schema'
import { CRON_PERIOD_SECONDS } from './utils/constants'
import { sendTelegramMessage } from './services/telegram'

export class FlightDO extends DurableObject<Env> {
	private alarmCount: number = 0
	private instanceStartTime: number = Date.now() // Add this
	private requestCount: number = 0 // Add this

	constructor(ctx: DurableObjectState, env: Env) {
		console.log('constructor')
		super(ctx, env)

		ctx.blockConcurrencyWhile(async () => {
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

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		this.requestCount++ // Increment on every request

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

		if (request.method === 'POST' && url.pathname === '/webhook') {
			return handleCommand(request, this.env, this.ctx)
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
		const alarmId = Math.random().toString(36).substring(7)
		const currentCount = this.getAlarmCount()
		const newCount = currentCount + 1
		
		// Check if there's already an alarm scheduled (potential race condition)
		const existingAlarm = await this.ctx.storage.getAlarm()
		let alarmMessage = `⏰ [ALARM-${alarmId}] Alarm fired! Previous count: ${currentCount}, New count: ${newCount}\nCurrent time: ${new Date().toISOString()}`
		
		if (existingAlarm) {
			alarmMessage += `\n⚠️ WARNING: Existing alarm found at ${new Date(existingAlarm).toISOString()}`
		}
		
		await this.sendAdminMessage(alarmMessage)

		runScheduledJob(this.env, this.ctx)

		this.setAlarmCount(newCount)

		const period = CRON_PERIOD_SECONDS * 1000
		const nextAlarmTime = Date.now() + period
		await this.sendAdminMessage(`⏰ [ALARM-${alarmId}] Setting next alarm for ${period}ms from now (${new Date(nextAlarmTime).toISOString()})`)
		await this.ctx.storage.setAlarm(nextAlarmTime)
		await this.sendAdminMessage(`✅ [ALARM-${alarmId}] Alarm completed`)
	}

	// Helper method to send messages to admin
	private async sendAdminMessage(message: string): Promise<void> {
		try {
			await sendTelegramMessage(parseInt(this.env.ADMIN_CHAT_ID), message, this.env, false)
		} catch (error) {
			console.error('Failed to send admin message:', error)
		}
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
