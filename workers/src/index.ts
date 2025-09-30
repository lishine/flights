import { handleCommand } from './handlers/commands'
import { runScheduledJob } from './handlers/cron'
import { FlightDO } from './durable'
import { Env } from './env'

// Export the Durable Object class so the runtime can find it
export { FlightDO }

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		console.log('00')
		const url = new URL(request.url)
		// Get durable object instance by name (using pathname as the name)

		if (request.method === 'POST' && url.pathname === '/webhook') {
			return handleCommand(request, env)
		}

		// For testing durable object endpoints
		if (url.pathname.startsWith('/alarm/')) {
			console.log('11')
			const stub = env.FLIGHTS_DO.getByName('alarm')
			return await stub.fetch(request)
			// const greeting = 'ggg'
			// return new Response(`OK ${greeting}`, { status: 200 })
		} else {
			console.log('22_')
			// 	const stub = env.FLIGHTS_DO.getByName('alarm')

			// const greeting = await stub.sayHello()
			const greeting = 'ggg'

			return new Response(`OK ${greeting}`, { status: 200 })
		}
	},

	// async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<Response> {
	// console.log('-11')
	// return runScheduledJob(env, ctx)
	// },
}
