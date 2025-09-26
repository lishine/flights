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
	FLIGHT_DATA: KVNamespace;
}

export default {
	// Handle HTTP requests (Telegram webhook + flight data API)
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Serve flight data on /flights endpoint
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

		// Handle Telegram webhook
		if (request.method === 'POST') {
			try {
				const update: any = await request.json();

				// Handle button clicks (callback queries) first
				if (update.callback_query) {
					const callbackQuery = update.callback_query;
					const chatId = callbackQuery.message.chat.id;
					const messageId = callbackQuery.message.message_id;
					const data = callbackQuery.data;

					let responseText = '';
					let replyMarkup = null;

					if (data === 'get_flights') {
						try {
							const flightData = await env.FLIGHT_DATA.get('latest-arrivals');
							if (flightData) {
								const parsed = JSON.parse(flightData);
								const lastUpdate = new Date(parsed.lastUpdated).toLocaleString();
								responseText = `✈️ *Flight Data Refreshed*
								
📅 Updated: ${lastUpdate}
🔢 Fetches: ${parsed.updateCount || 'N/A'}
📊 Flights: ${parsed.data?.Flights?.length || 'N/A'}

_Data refreshes every 2 minutes_`;
							} else {
								responseText = '❌ No flight data available';
							}
						} catch (error) {
							responseText = '❌ Error fetching flights';
						}

						replyMarkup = {
							inline_keyboard: [[{ text: '🔄 Refresh Again', callback_data: 'get_flights' }]],
						};
					} else if (data === 'get_status') {
						try {
							const flightData = await env.FLIGHT_DATA.get('latest-arrivals');
							if (flightData) {
								const parsed = JSON.parse(flightData);
								const timeDiff = Date.now() - parsed.timestamp;
								const minutesAgo = Math.floor(timeDiff / 60000);
								responseText = `📊 *System Status*\n\n✅ Online\n⏰ ${minutesAgo}m ago\n🔢 ${parsed.updateCount} fetches`;
							} else {
								responseText = '🔶 System starting up';
							}
						} catch (error) {
							responseText = '❌ Status unavailable';
						}
					}

					// Answer callback query first (removes loading spinner)
					await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							callback_query_id: callbackQuery.id,
							text: '🔄 Refreshing...', // Optional loading text
						}),
					});

					// Edit the existing message instead of sending new one
					await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							chat_id: chatId,
							message_id: messageId,
							text: responseText,
							parse_mode: 'Markdown',
							reply_markup: replyMarkup,
						}),
					});

					return new Response('ok');
				}

				// Handle regular text messages
				if (update.message) {
					const chatId = update.message.chat.id;
					const messageText = update.message.text || '';

					let responseText = 'Hello from Cloudflare Worker v1 👋';
					let replyMarkup = null;

					// Handle different commands
					if (messageText.toLowerCase().includes('/start') || messageText.toLowerCase().includes('/help')) {
						responseText = `🤖 Ben Gurion Airport Bot

Available commands:
✈️ /flights - Get latest flight arrivals
📊 /status - System status
ℹ️ /help - Show this menu

Choose an option:`;

						replyMarkup = {
							inline_keyboard: [
								[
									{ text: '✈️ Get Flights', callback_data: 'get_flights' },
									{ text: '📊 Status', callback_data: 'get_status' },
								],
								[{ text: '🔄 Refresh', callback_data: 'get_flights' }],
							],
						};
					} else if (messageText.toLowerCase().includes('/flights')) {
						try {
							const flightData = await env.FLIGHT_DATA.get('latest-arrivals');
							if (flightData) {
								const parsed = JSON.parse(flightData);
								const lastUpdate = new Date(parsed.lastUpdated).toLocaleString();
								responseText = `✈️ *Latest Flight Data*
								
📅 Updated: ${lastUpdate}
🔢 Total fetches: ${parsed.updateCount || 'N/A'}
📊 Flights count: ${parsed.data?.Flights?.length || 'N/A'}

_Data refreshes every 2 minutes_`;
							} else {
								responseText = '❌ No flight data available yet\n\n_The system might still be starting up_';
							}
						} catch (error) {
							responseText = '❌ Error fetching flight data';
						}

						replyMarkup = {
							inline_keyboard: [[{ text: '🔄 Refresh Data', callback_data: 'get_flights' }]],
						};
					} else if (messageText.toLowerCase().includes('/status')) {
						try {
							const flightData = await env.FLIGHT_DATA.get('latest-arrivals');
							const errorData = await env.FLIGHT_DATA.get('last-error');

							let statusText = '📊 *System Status*\n\n';

							if (flightData) {
								const parsed = JSON.parse(flightData);
								const timeDiff = Date.now() - parsed.timestamp;
								const minutesAgo = Math.floor(timeDiff / 60000);
								statusText += `✅ System: Online\n⏰ Last update: ${minutesAgo} minutes ago\n🔢 Total fetches: ${parsed.updateCount}`;
							} else {
								statusText += '🔶 System: Starting up';
							}

							if (errorData) {
								const error = JSON.parse(errorData);
								const errorTime = new Date(error.timestamp).toLocaleString();
								statusText += `\n\n⚠️ Last error: ${errorTime}`;
							}

							responseText = statusText;
						} catch (error) {
							responseText = '❌ Unable to fetch status';
						}
					}

					// Send message with optional buttons
					const messagePayload: any = {
						chat_id: chatId,
						text: responseText,
						parse_mode: 'Markdown',
					};

					if (replyMarkup) {
						messagePayload.reply_markup = replyMarkup;
					}

					await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(messagePayload),
					});
				}

				return new Response('ok');
			} catch (error) {
				console.error('Telegram webhook error:', error);
				return new Response('Error processing update', { status: 500 });
			}
		}

		return new Response('Hello World!');
	},

	// Handle cron jobs (flight data fetching)
	// @ts-ignore
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		try {
			console.log('Starting scheduled flight data fetch...');

			// Increment counter
			const currentCount = (await env.FLIGHT_DATA.get('update-counter')) || '0';
			const newCount = parseInt(currentCount) + 1;

			// Call your Vercel endpoint
			const response = await fetch('https://flights-taupe.vercel.app/api/tlv-arrivals');

			if (!response.ok) {
				throw new Error(`Vercel API returned ${response.status}`);
			}

			const flightData = await response.json();

			// Store in KV with metadata
			const dataWithMeta = {
				data: flightData,
				updateCount: newCount,
				timestamp: Date.now(),
				lastUpdated: new Date().toISOString(),
				source: 'vercel-api',
			};

			await env.FLIGHT_DATA.put('latest-arrivals', JSON.stringify(dataWithMeta));
			await env.FLIGHT_DATA.put('update-counter', newCount.toString());

			console.log(`Flight data updated successfully (fetch #${newCount})`);
		} catch (error) {
			console.error('Failed to update flight data:', error);

			// Store error info for debugging
			await env.FLIGHT_DATA.put(
				'last-error',
				JSON.stringify({
					error: error instanceof Error ? error.message : 'Unknown error',
					timestamp: new Date().toISOString(),
				})
			);
		}
	},
} satisfies ExportedHandler<Env>;
