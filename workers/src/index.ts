import { Bot } from 'grammy'
import { FlightDO } from './durable'
import { Env } from './env'
import { sendTelegramMessage, sendAdmin } from './services/telegram'
import { getCurrentIdtDateStringNoCache, getCurrentIdtTimeNoCache } from './utils/dateTime'
import { setupBotHandlers, BotContext } from './handlers/commands'

////// Export the Durable Object class so the runtime can find it
export { FlightDO }

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const stub = env.FLIGHTS_DO.getByName('alarm')
		const url = new URL(request.url)

		if (request.method === 'POST' && url.pathname === '/webhook') {
			// Create bot instance with webhook handling
			const bot = new Bot<BotContext>(env.BOT_TOKEN)

			// Set up middleware to pass env and ctx to handlers
			bot.use(async (ctx, next) => {
				;(ctx as any).env = env
				;(ctx as any).ctx = stub
				await next()
			})

			// Set up all bot handlers
			setupBotHandlers(bot)

			// Handle webhook
			try {
				const update = (await request.json()) as any
				await bot.handleUpdate(update)
				return new Response('OK')
			} catch (error) {
				console.error('Webhook handling error:', error)
				return new Response('Error', { status: 500 })
			}
		}

		console.log('wwwwwworker request')

		if (request.method === 'POST' && url.pathname === '/deploy-webhook') {
			try {
				console.log('deploy-webhook')
				const body = (await request.json()) as { version: string; update_date: string; release_url?: string }
				const version = body.version
				const updateDate = body.update_date
				const releaseUrl = body.release_url

				await env.METADATA.put('version', version)
				await env.METADATA.put('last_deploy_date', updateDate)

				let message = `✅ *Deployment Successful*\n\nVersion: \`${version}\`\nDate: ${updateDate}\nTime: ${getCurrentIdtDateStringNoCache()}`
				if (releaseUrl) {
					message += `\n\n[View Release](${releaseUrl})`
				}

				console.log({ 'env.ADMIN_CHAT_ID': env.ADMIN_CHAT_ID })
				await sendAdmin(message, env, { props: { debug: true } }, 'deploy')

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

		if (request.method === 'GET' && url.pathname === '/reset-schema') {
			return stub.fetch(request)
		}

		if (request.method === 'GET' && url.pathname === '/lifetime') {
			return stub.fetch(request)
		}

		// Health check endpoint
		if (request.method === 'GET' && url.pathname === '/health') {
			const health = {
				status: 'healthy',
				timestamp: getCurrentIdtTimeNoCache().toISOString(),
				version: (await env.METADATA.get('version')) || 'unknown',
				last_deploy: (await env.METADATA.get('last_deploy_date')) || 'unknown',
			}
			return new Response(JSON.stringify(health, null, 2), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}

		// Default response with API information
		const apiInfo = {
			name: 'ffFlights API',
			status: 'running',
			endpoints: {
				health: 'GET /health - Service health check',
				webhook: 'POST /webhook - Flight webhook handler',
				deploy: 'POST /deploy-webhook - Deployment notification handler',
				reset: 'GET /reset-schema - Reset database schema',
			},
			version: (await env.METADATA.get('version')) || 'unknown',
		}

		return new Response(JSON.stringify(apiInfo, null, 2), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		})
	},
}
