/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import type { Update } from 'typegram';

export interface Env {
	BOT_TOKEN: string;
}
export default {
	async fetch(request, env, ctx): Promise<Response> {
		if (request.method === 'POST') {
			const update: Update.MessageUpdate = await request.json();

			// Type guard for messages
			const chatId = update.message.chat.id;

			// Reply
			await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chat_id: chatId,
					text: 'Hello from Cloudflare Worker v1 👋',
				}),
			});

			return new Response('ok');
		}

		return new Response('Hello World!');
	},
} satisfies ExportedHandler<Env>;
