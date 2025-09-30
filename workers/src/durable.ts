/**
 * FlightDO - SQLite-backed Durable Object using Cloudflare's new SQLite API
 *
 * This class uses:
 * - SQLite-backed storage (recommended, replaces obsolete KV backend)
 * - blockConcurrencyWhile() for proper initialization
 * - Synchronous KV API methods via ctx.storage.kv.*
 * - SQL API via ctx.storage.sql
 * - Point-in-Time Recovery support
 *
 * Migration configured in wrangler.toml with new_sqlite_classes = ["FlightDO"]
 *
 * API Reference: https://developers.cloudflare.com/durable-objects/api/storage-api/
 */
import { DurableObject } from 'cloudflare:workers'
import { Env } from './env'

export class FlightDO extends DurableObject<Env> {
	private alarmCount: number = 0

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)

		// Use blockConcurrencyWhile() to ensure no requests are delivered until initialization completes
		ctx.blockConcurrencyWhile(async () => {
			// Initialize instance variables using SQLite-backed synchronous KV API
			this.alarmCount = ctx.storage.kv.get<number>('alarmCount') || 0

			// Set up initial alarm if not already set
			let currentAlarm = await ctx.storage.getAlarm()
			if (currentAlarm == null) {
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
				return new Response(`FlightDO Status - Alarms fired: ${this.alarmCount}`, {
					headers: { 'Content-Type': 'text/plain' },
				})

			case '/reset':
				// Reset counter and set new alarm
				this.alarmCount = 0
				this.ctx.storage.kv.put('alarmCount', 0)
				const oneMinute = 60 * 1000
				await this.ctx.storage.setAlarm(Date.now() + oneMinute)
				return new Response('Alarm count reset and new alarm set', {
					headers: { 'Content-Type': 'text/plain' },
				})

			default:
				// Return current status (alarm count already initialized in constructor)
				const currentAlarm = await this.ctx.storage.getAlarm()
				const alarmTime = currentAlarm ? new Date(currentAlarm).toISOString() : 'Not set'

				return new Response(`FlightDO Active\nAlarms fired: ${this.alarmCount}\nNext alarm: ${alarmTime}`, {
					headers: { 'Content-Type': 'text/plain' },
				})
		}
	}

	/**
	 * Alarm handler - automatically called by Cloudflare runtime when alarm fires
	 * Uses SQLite-backed synchronous KV API methods
	 */
	async alarm(): Promise<void> {
		// Increment counter and log (using SQLite-backed synchronous KV API)
		this.alarmCount++
		console.log(`Alarm fired! Count: ${this.alarmCount}`)

		// Store updated count using synchronous KV API
		this.ctx.storage.kv.put('alarmCount', this.alarmCount)

		// Set next alarm for 1 minute from now
		const oneMinute = 60 * 1000
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
}
