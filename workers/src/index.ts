import { FlightDO } from './durable'
import { Env } from './env'
import { sendTelegramMessage } from './services/telegram'

// Export the Durable Object class so the runtime can find it
export { FlightDO }

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const stub = env.FLIGHTS_DO.getByName('alarm')
		const url = new URL(request.url)

		if (request.method === 'POST' && url.pathname === '/webhook') {
			const dbStub = env.FLIGHTS_DO.getByName('alarm')
			return dbStub.fetch(request)
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

				let message = `✅ *Deployment Successful*\n\nVersion: \`${version}\`\nDate: ${updateDate}\nTime: ${new Date().toUTCString()}`
				if (releaseUrl) {
					message += `\n\n[View Release](${releaseUrl})`
				}

				console.log({ 'env.ADMIN_CHAT_ID': env.ADMIN_CHAT_ID })
				await sendTelegramMessage(parseInt(env.ADMIN_CHAT_ID), message, env, false)

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

		// Health check endpoint
		if (request.method === 'GET' && url.pathname === '/health') {
			const health = {
				status: 'healthy',
				timestamp: new Date().toISOString(),
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
			name: 'fFlights API',
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
