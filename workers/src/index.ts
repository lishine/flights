import { handleCommand } from './handlers/commands'
import { runScheduledJob } from './handlers/cron'
import { FlightDO } from './durable'
import { Env } from './env'

// Export the Durable Object class so the runtime can find it
export { FlightDO }

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)
		// Get durable object instance by name (using pathname as the name)

		if (request.method === 'POST' && url.pathname === '/webhook') {
			return handleCommand(request, env)
		}

		// For testing durable object endpoints
		if (url.pathname.startsWith('/alarm/')) {
			const stub = env.FLIGHTS_DO.getByName('alarm')
			// Forward request to durable object
			return await stub.fetch(request)
		} else {
			// 	const stub = env.FLIGHTS_DO.getByName('alarm')

			// const greeting = await stub.sayHello()
			const greeting = 'ggg'

			return new Response(`OK ${greeting}`, { status: 200 })
		}
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<Response> {
		return runScheduledJob(env, ctx)
	},
}
