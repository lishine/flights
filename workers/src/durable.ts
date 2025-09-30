/**
 * FlightDO - SQLite-backed Durable Object using Cloudflare's Synchronous KV API
 *
 * This class uses SYNCHRONOUS KV API throughout:
 * - SQLite-backed storage (recommended, replaces obsolete KV backend)
 * - blockConcurrencyWhile() for proper initialization
 * - Synchronous KV API methods (ctx.storage.kv.get, ctx.storage.kv.put, ctx.storage.kv.delete)
 * - SQL API via ctx.storage.sql
 * - Point-in-Time Recovery support
 * - Proper alarm counter synchronization across instances
 *
 * Migration configured in wrangler.toml with new_sqlite_classes = ["FlightDO"]
 *
 * API Reference: https://developers.cloudflare.com/durable-objects/api/storage-api/
 */
import { DurableObject } from 'cloudflare:workers'
import { Env } from './env'
import { runScheduledJob } from './handlers/cron'

export class FlightDO extends DurableObject<Env> {
	private alarmCount: number = 0

	constructor(ctx: DurableObjectState, env: Env) {
		console.log('constructor')
		super(ctx, env)

		// Use blockConcurrencyWhile() to ensure no requests are delivered until initialization completes
		ctx.blockConcurrencyWhile(async () => {
			// Initialize alarm count using synchronous KV API directly
			this.alarmCount = ctx.storage.kv.get<number>('alarmCount') || 0

			// Set up initial alarm if not already set
			let currentAlarm = await ctx.storage.getAlarm()
			if (currentAlarm == null) {
				console.log('constructor currentAlarm == null')
				const oneMinute = 60 * 1000 // 1 minute in milliseconds
				console.log(`Setting initial alarm for ${oneMinute}ms from now`)
				await ctx.storage.setAlarm(Date.now() + oneMinute)
			}
		})
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		switch (url.pathname) {
			case '/status':
				// Get fresh count using synchronous helper method
				const count = this.getAlarmCount()
				return new Response(`FlightDO Status - Alarms fired: ${count}`, {
					headers: { 'Content-Type': 'text/plain' },
				})

			case '/reset':
				// Reset counter and set new alarm using sync helper method
				this.setAlarmCount(0)
				// const oneMinute = 60 * 1000
				// await this.ctx.storage.setAlarm(Date.now() + oneMinute)
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
		console.log('alarm')

		runScheduledJob(this.env)

		// Get current count, increment, and store using sync helper methods
		const currentCount = this.getAlarmCount()
		const newCount = currentCount + 1

		console.log(`Alarm fired! Count: ${newCount}`)

		// Store updated count using sync helper method
		this.setAlarmCount(newCount)

		// Set next alarm for 1 minute from now
		const oneMinute = 30 * 1000
		console.log(`Setting next alarm for ${oneMinute}ms from now`)
		await this.ctx.storage.setAlarm(Date.now() + oneMinute)
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
