import { handleCommand } from './handlers/commands';
import { runScheduledJob } from './handlers/cron';

export interface Env {
	BOT_TOKEN: string;
	FLIGHT_DATA: KVNamespace;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/flights' && request.method === 'GET') {
			try {
				const cached = await env.FLIGHT_DATA.get('latest-arrivals');
				if (!cached) {
					return new Response('No flight data available', {
						status: 404,
						headers: { 'Content-Type': 'application/json' },
					});
				}
				return new Response(cached, {
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					},
				});
			} catch (error) {
				return new Response('Error fetching flight data', { status: 500 });
			}
		}
		if (request.method === 'POST' && url.pathname === '/webhook') {
			return handleCommand(request, env);
		}
		return new Response('OK', { status: 200 });
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<Response> {
		return runScheduledJob(env, ctx);
	},
};
