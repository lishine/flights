import { FlightDO } from './durable'
import { Env } from './env'

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

		// For testing durable object endpoints
		if (url.pathname.startsWith('/alarm/')) {
			return await stub.fetch(request)
		}
		return new Response(`OK`, { status: 200 })
	},
}
