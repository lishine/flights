import { FlightDO } from './durable'
import { Env } from './env'
import { sendTelegramMessage } from './services/telegram'
import versionData from '../version.json'

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

		console.log('worker request')

		if (request.method === 'POST' && url.pathname === '/deploy-webhook') {
			try {
				console.log('deploy-webhook')
				const version = versionData.version
				const updateDate = versionData.update_date
				const message = `✅ *Deployment Successful*\n\nVersion: \`${version}\`\nDate: ${updateDate}\nTime: ${new Date().toUTCString()}`
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
		return new Response(`OK`, { status: 200 })
	},
}
