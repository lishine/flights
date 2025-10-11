import { DurableObject } from 'cloudflare:workers'
import { Bot } from 'grammy'
import { runScheduledJob } from './handlers/cron'
import { setupBotHandlers } from './handlers/commands'
import { resetSchema } from './schema'
import { CRON_PERIOD_SECONDS, ALARM_MIN_PERIOD, ALARM_MAX_PERIOD } from './utils/constants'
import { BotContext, DOProps } from './types'
import { getCurrentIdtTimeNoCache, getCurrentIdtDateStringNoCache } from './utils/dateTime'

export class FlightDO extends DurableObject<Env, DOProps> {
	private bot!: Bot<BotContext>
	private gramCtx!: BotContext
	private instanceStartTime: number = Date.now() // Add this
	private requestCount: number = 0 // Add this

	constructor(ctx: DurableObjectState<DOProps>, env: Env) {
		console.log('constructor')
		super(ctx, env)
		this.resetCache()

		// Initialize gramCtx with minimal implementation for use by alarm handler

		ctx.blockConcurrencyWhile(async () => {
			this.gramCtx = {
				env: this.env,
				DOStore: this.ctx,
				sendTelegramMessage: async (
					text: string,
					options?: {
						disableNotification?: boolean
						replyMarkup?: any
						sendAdmin?: 'debug' | 'deploy' | 'log'
						chatId?: number
					}
				) => {
					let chatId: number
					if (options?.sendAdmin) {
						const type = options.sendAdmin
						if (type === 'debug' && !this.ctx.props.debug) return
						chatId = parseInt(env.ADMIN_CHAT_ID)
					} else if (options?.chatId) {
						chatId = options?.chatId
					} else {
						chatId = this.gramCtx.validChatId!
					}
					try {
						console.log(`Sending Telegram message to ${chatId}, length: ${text.length}`)

						await this.bot.api.sendMessage(chatId, text, {
							parse_mode: 'Markdown',
							disable_notification: options?.disableNotification ?? false,
							reply_markup: options?.replyMarkup,
						})
					} catch (error) {
						if (error instanceof Error) {
							const errorDetails: any = {
								message: error.message,
								name: error.name,
								chatId,
								textLength: text.length,
								hasReplyMarkup: !!options?.replyMarkup,
								textPreview: text.length > 100 ? text.substring(0, 100) + '...' : text,
								timestamp: getCurrentIdtTimeNoCache().toISOString(),
							}

							console.error('Failed to send Telegram message:', errorDetails)
						} else {
							console.error('Failed to send Telegram message (non-Error object):', {
								error,
								chatId,
								textLength: text.length,
								timestamp: getCurrentIdtTimeNoCache().toISOString(),
							})
						}
					}
				},
			} as BotContext

			this.bot.use(async (gramCtx, next) => {
				if (!gramCtx.chatId) {
					return
				}
				this.gramCtx.validChatId = gramCtx.chatId

				gramCtx = Object.assign(gramCtx, this.gramCtx)

				await next()
			})
			setupBotHandlers(this.bot)
		})
	}

	private resetCache() {
		Object.assign(this.ctx.props, {
			cache: {},
			debug: false,
		})
	}

	/**
	 * Common method to schedule alarm with random delay
	 */
	private async scheduleAlarm(): Promise<void> {
		const randomDelay = ALARM_MIN_PERIOD + Math.random() * (ALARM_MAX_PERIOD - ALARM_MIN_PERIOD)
		const nextAlarmTime = Date.now() + randomDelay
		await this.ctx.storage.setAlarm(nextAlarmTime)
		console.log(`Alarm scheduled for ${new Date(nextAlarmTime).toISOString()} (${randomDelay}ms)`)
	}

	async fetch(request: Request): Promise<Response> {
		this.resetCache() // Reset at start of each request
		const url = new URL(request.url)

		this.requestCount++ // Increment on every request

		// Check if this is a Telegram webhook request
		const isTelegramRequest = request.method === 'POST' && url.pathname === '/webhook'

		if (isTelegramRequest) {
			// Check if alarm is running
			const currentAlarm = await this.ctx.storage.getAlarm()

			if (currentAlarm == null) {
				console.log('No alarm running, scheduling new alarm and running job')
				await this.scheduleAlarm()
			}

			try {
				const update = (await request.json()) as any
				await this.bot.handleUpdate(update)
				return new Response('OK')
			} catch (error) {
				console.error('Webhook handling error:', error)
				return new Response('Error', { status: 500 })
			}
		}

		if (request.method === 'POST' && url.pathname === '/deploy-webhook') {
			try {
				console.log('deploy-webhook')
				const body = (await request.json()) as { version: string; update_date: string; release_url?: string }
				const version = body.version
				const updateDate = body.update_date
				const releaseUrl = body.release_url

				await this.env.METADATA.put('version', version)
				await this.env.METADATA.put('last_deploy_date', updateDate)

				let message = `✅ *Deployment Successful*\n\nVersion: \`${version}\`\nDate: ${updateDate}\nTime: ${getCurrentIdtDateStringNoCache()}`
				if (releaseUrl) {
					message += `\n\n[View Release](${releaseUrl})`
				}

				console.log({ 'env.ADMIN_CHAT_ID': this.env.ADMIN_CHAT_ID })

				// Create a minimal context for sending the message
				const adminChatId = parseInt(this.env.ADMIN_CHAT_ID)
				try {
					await this.bot.api.sendMessage(adminChatId, message, {
						parse_mode: 'Markdown',
					})
				} catch (telegramError) {
					console.error('Failed to send deployment notification:', telegramError)
				}

				return new Response(JSON.stringify({ success: true, version }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
			} catch (error) {
				console.error('Deploy webhook error:', error)
				return new Response(JSON.stringify({ error: 'Failed to send notification' }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				})
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
				const oneMinute = CRON_PERIOD_SECONDS * 1000
				await this.ctx.storage.setAlarm(Date.now() + oneMinute)
				console.log('Schema reset and alarm restart triggered')
				return new Response('Schema reset successfully and alarms restarted', {
					headers: { 'Content-Type': 'text/plain' },
				})
			case '/status':
				return new Response(`FlightDO Status - Running`, {
					headers: { 'Content-Type': 'text/plain' },
				})

			case '/reset':
				// Force restart the alarm process
				const resetPeriod = CRON_PERIOD_SECONDS * 1000
				await this.ctx.storage.setAlarm(Date.now() + resetPeriod)
				console.log('Manual alarm restart triggered')
				return new Response('New alarm set', {
					headers: { 'Content-Type': 'text/plain' },
				})

			default:
				// Return current status
				const currentAlarm = await this.ctx.storage.getAlarm()
				const alarmTime = currentAlarm ? new Date(currentAlarm).toISOString() : 'Not set'

				return new Response(`FlightDO Active\nNext alarm: ${alarmTime}`, {
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

		// Run the scheduled job
		runScheduledJob(this.gramCtx)

		// Schedule next alarm using common method
		await this.scheduleAlarm()
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
}
