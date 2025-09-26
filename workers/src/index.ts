import { handleCommand } from './handlers/commands'
import { runScheduledJob } from './handlers/cron'

export interface Env {
	BOT_TOKEN: string
	DB: D1Database
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		if (request.method === 'POST' && url.pathname === '/webhook') {
			return handleCommand(request, env)
		} else {
			console.log('runScheduledJob')
			runScheduledJob(env, ctx)
		}
		return new Response('OOK', { status: 200 })
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<Response> {
		return runScheduledJob(env, ctx)
	},
}
