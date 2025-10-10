import { FlightDO } from './durable'
import { getCurrentIdtDateStringNoCache, getCurrentIdtTimeNoCache } from './utils/dateTime'
import { Bot } from 'grammy'

////// Export the Durable Object class so the runtime can find it
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
			return stub.fetch(request)
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
