# Flight Tracking Bot - Design Document

## Overview

A Telegram bot that tracks flight arrivals at Ben Gurion Airport, sending real-time alerts to users for specific flights. It supports bulk tracking, flight suggestions with a "Track All" button, and FlightRadar24 links for live tracking. The bot uses Cloudflare Workers and KV for scalability and minimal maintenance.

## Architecture

- **Platform**: Single Cloudflare Worker with TypeScript, dual handlers:
  - `fetch`: Handles Telegram webhook (`/webhook`) and flight data endpoint (`/flights`)
  - `scheduled`: Runs every 2 minutes to fetch data and send alerts
- **External API**: Vercel-hosted Puppeteer scraper (`https://flights-taupe.vercel.app/api/tlv-arrivals`)
- **Storage**: Cloudflare KV for flight data, user tracking, and metadata
- **File Structure**: Modular TypeScript files for maintainability

### File Structure

```
src/
├── index.ts              # Main entry point (fetch/scheduled handlers)
├── handlers/
│   ├── commands.ts       # Bot command handlers
│   ├── cron.ts          # Scheduled job logic
│   └── alerts.ts        # Alert sending logic
├── services/
│   ├── flightData.ts    # Flight data operations
│   ├── tracking.ts      # User tracking operations
│   └── telegram.ts      # Telegram API interactions
├── utils/
│   ├── validation.ts    # Flight code validation
│   ├── formatting.ts    # Message formatting
│   └── constants.ts     # Constants and configuration
└── types/
    └── index.ts         # Type definitions
```

## Core Features

- **Flight Data Collection**: Fetches data every 2 minutes from Vercel API, stores in KV with 24h TTL.
- **User Tracking**: Users track flights with `/track LY086 OE2147` (bulk support); auto-cleanup 2 hours after landing.
- **Alerts**: Sends Telegram push notifications for changes in status or arrival time.
- **Flight Suggestions**: `/test-tracking` suggests 5 flights arriving 1+ hour from now with a "Track All" button.
- **Commands**: `/start`, `/track`, `/mytracking`, `/test-tracking`, `/flights`, `/status`, `/help`.
- **FlightRadar24 Links**: Included in alerts and `/mytracking` output.

## Data Storage Structure

- **KV Keys**:
  - `latest-arrivals`: Current flight data (24h TTL)
  - `prev-arrivals`: Previous flight data for comparison (24h TTL)
  - `tracking:LY086`: List of user IDs tracking flight LY086 (7d TTL)
  - `user_tracks:user123`: List of flights tracked by user123 (7d TTL)
  - `update-counter`: Fetch count (no TTL)
  - `last-error`: Error logging (no TTL)

## Bot Commands

- `/start`, `/help`: Welcome message with buttons
- `/track LY086 OE2147`: Track one or multiple flights
- `/mytracking`: List tracked flights with status, times, and FlightRadar24 links
- `/test-tracking`: Suggest 5 upcoming flights with a "Track All" button
- `/flights`: Show current arrivals with refresh button
- `/status`: System health status
- **Inline Buttons**: For `/flights` (Refresh), `/status` (Status), `/test-tracking` (Track All)

## Alert Format

```
🚨 *Flight Update: LY086*
📍 Status: FINAL
🕒 Time: 02:11 (was 05:10)
📍 From BANGKOK
📊 [Track Live](https://www.flightradar24.com/data/flights/ly086)
```

## Technical Details

- **Platform**: Cloudflare Workers (free tier)
- **Cron**: Every 2 minutes (`*/2 * * * *`)
- **Storage**: Cloudflare KV with TTL
- **Bot Token**: Stored as a secret (`BOT_TOKEN`)
- **Auto-Cleanup**: Removes tracking data 2 hours after landing
- **Scalability**: Single worker handles unlimited users
- **Validation**: Flight codes (e.g., `LY086`) validated via regex
- **Error Handling**: Retry logic for Vercel API, error logging to KV
- **Build Tool**: `esbuild` for bundling TypeScript files

## Key Benefits

- Real-time alerts with push notifications
- Zero infrastructure management
- Automatic scaling
- Free tier compatible
- Simple UX with auto-cleanup
- Flight suggestions with easy tracking
- Modular TypeScript code for maintainability

## Vercel API Data Structure

The Vercel API (`https://flights-taupe.vercel.app/api/tlv-arrivals`) returns:

```json
{
  "Flights": [
    {
      "Airline": "EL AL ISRAEL AIRLINES",
      "Flight": "LY 086",
      "Terminal": "3",
      "Status": "FINAL",
      "City": "BANGKOK",
      "Country": null,
      "StatusColor": "none",
      "ScheduledDateTime": "/Date(1758777000000)/",
      "ScheduledDate": "25/09",
      "ScheduledTime": "05:10",
      "UpdatedDateTime": "/Date(1758852660000)/",
      "UpdatedDate": "26/09",
      "UpdatedTime": "02:11",
      "CurrentCultureName": "en-US"
    },
    ...
  ]
}
```

- **Mapped Fields**: `Flight` → `flightNumber`, `Status` → `status`, `ScheduledTime` → `scheduledArrival`, `UpdatedTime` → `actualArrival`, `City` → `origin`, `Gate` → `'TBA'` (not provided).

## Setup Instructions

1. **Install Dependencies**:
   ```bash
   npm install --save-dev esbuild wrangler typescript
   npm install typegram
   ```
2. **Update `package.json`**:
   ```json
   {
   	"scripts": {
   		"build": "esbuild src/index.ts --bundle --outfile=dist/worker.js --format=iife --platform=worker",
   		"deploy": "wrangler deploy",
   		"dev": "wrangler dev"
   	},
   	"devDependencies": {
   		"esbuild": "^0.23.0",
   		"wrangler": "^3.0.0",
   		"typescript": "^5.0.0"
   	},
   	"dependencies": {
   		"typegram": "^5.4.0"
   	}
   }
   ```
3. **Update `wrangler.toml`**:
   ```toml
   name = "flights"
   main = "dist/worker.js"
   compatibility_date = "2025-09-24"
   observability = { enabled = true }
   triggers = { crons = ["*/2 * * * *"] }
   [[kv_namespaces]]
   binding = "FLIGHT_DATA"
   id = "154a282737544f8792497759d05f0771"
   ```
   - **Changes**: Updated `main` to `dist/worker.js` for bundled output.
4. **Set Bot Token**:
   ```bash
   wrangler secret put BOT_TOKEN
   ```
   Enter your Telegram bot token when prompted.
5. **Create Directory Structure**:
   Create the `src/` folder with subdirectories (`handlers/`, `services/`, `utils/`, `types/`) and add the files below.
6. **Build and Deploy**:
   ```bash
   npm run build
   npm run deploy
   ```
7. **Test Locally**:
   ```bash
   npm run dev
   ```
   Use a tool like `ngrok` to test the `/webhook` endpoint locally.

## TypeScript Code

Below are all the TypeScript files for the enhanced bot.

### `src/index.ts`

```typescript
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
```

### `src/handlers/commands.ts`

```typescript
import { sendTelegramMessage } from '../services/telegram';
import { addFlightTracking, getUserTrackedFlights } from '../services/tracking';
import { getCurrentFlights, suggestFlightsToTrack } from '../services/flightData';
import { formatTrackingList, formatFlightSuggestions } from '../utils/formatting';
import { isValidFlightCode } from '../utils/validation';
import type { Env } from '../index';
import type { Update, CallbackQuery } from 'typegram';

export async function handleCommand(request: Request, env: Env): Promise<Response> {
	const update = (await request.json()) as Update;
	const callbackQuery = update.callback_query as CallbackQuery | undefined;
	const message = update.message;

	if (callbackQuery) {
		const chatId = callbackQuery.message.chat.id;
		const messageId = callbackQuery.message.message_id;
		const data = callbackQuery.data;

		if (data.startsWith('track_suggested:')) {
			const flightCodes = data.split(':')[1].split(',');
			const results = [];
			for (const code of flightCodes) {
				if (isValidFlightCode(code)) {
					await addFlightTracking(chatId, code.toUpperCase(), env);
					results.push(`✅ Now tracking ${code.toUpperCase()}`);
				} else {
					results.push(`❌ Invalid flight code: ${code}`);
				}
			}
			await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Tracking flights...' }),
			});
			await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chat_id: chatId,
					message_id: messageId,
					text: results.join('\n'),
					parse_mode: 'Markdown',
				}),
			});
			return new Response('OK');
		}

		let responseText = '';
		let replyMarkup = null;
		if (data === 'get_flights') {
			const flightData = await env.FLIGHT_DATA.get('latest-arrivals');
			if (flightData) {
				const parsed = JSON.parse(flightData);
				const lastUpdate = new Date(parsed.lastUpdated).toLocaleString();
				responseText =
					`✈️ *Flight Data Refreshed*\n\n` +
					`📅 Updated: ${lastUpdate}\n` +
					`🔢 Fetches: ${parsed.updateCount || 'N/A'}\n` +
					`📊 Flights: ${parsed.data?.length || 'N/A'}\n\n` +
					`_Data refreshes every 2 minutes_`;
			} else {
				responseText = '❌ No flight data available';
			}
			replyMarkup = { inline_keyboard: [[{ text: '🔄 Refresh Again', callback_data: 'get_flights' }]] };
		} else if (data === 'get_status') {
			const flightData = await env.FLIGHT_DATA.get('latest-arrivals');
			if (flightData) {
				const parsed = JSON.parse(flightData);
				const timeDiff = Date.now() - parsed.timestamp;
				const minutesAgo = Math.floor(timeDiff / 60000);
				responseText = `📊 *System Status*\n\n` + `✅ Online\n` + `⏰ ${minutesAgo}m ago\n` + `🔢 ${parsed.updateCount} fetches`;
			} else {
				responseText = '🔶 System starting up';
			}
		}
		await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ callback_query_id: callbackQuery.id, text: '🔄 Refreshing...' }),
		});
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
		return new Response('OK');
	}

	if (!message) return new Response('OK');
	const chatId = message.chat.id;
	const text = message.text || '';

	const commands: { [key: string]: () => Promise<void> } = {
		'/start': () => handleStart(chatId, env),
		'/track': () => handleTrack(chatId, text, env),
		'/mytracking': () => handleMyTracking(chatId, env),
		'/test-tracking': () => handleTestTracking(chatId, env),
		'/flights': () => handleFlights(chatId, env),
		'/status': () => handleStatus(chatId, env),
		'/help': () => handleStart(chatId, env),
	};

	const command = text.split(' ')[0];
	const handler = commands[command] || (() => sendTelegramMessage(chatId, 'Unknown command', env));
	await handler();
	return new Response('OK');
}

async function handleStart(chatId: number, env: Env) {
	const message =
		`🤖 Ben Gurion Airport Bot\n\n` +
		`Available commands:\n` +
		`✈️ /flights - Get latest flight arrivals\n` +
		`📊 /status - System status\n` +
		`🚨 /track LY086 - Track a flight\n` +
		`📋 /mytracking - Your tracked flights\n` +
		`🎯 /test-tracking - Suggested flights\n` +
		`ℹ️ /help - Show this menu\n\n` +
		`Choose an option:`;
	const replyMarkup = {
		inline_keyboard: [
			[
				{ text: '✈️ Get Flights', callback_data: 'get_flights' },
				{ text: '📊 Status', callback_data: 'get_status' },
			],
			[{ text: '🔄 Refresh', callback_data: 'get_flights' }],
		],
	};
	await sendTelegramMessage(chatId, message, env, false, replyMarkup);
}

async function handleTrack(chatId: number, text: string, env: Env) {
	const flightCodes = text.split(' ').slice(1);
	const results = [];
	for (const code of flightCodes) {
		if (isValidFlightCode(code)) {
			await addFlightTracking(chatId, code.toUpperCase().replace(' ', ''), env);
			results.push(`✅ Now tracking ${code.toUpperCase()}`);
		} else {
			results.push(`❌ Invalid flight code: ${code}`);
		}
	}
	await sendTelegramMessage(chatId, results.join('\n'), env);
}

async function handleMyTracking(chatId: number, env: Env) {
	const flights = await getUserTrackedFlights(chatId, env);
	const message = await formatTrackingList(flights, env);
	await sendTelegramMessage(chatId, message, env);
}

async function handleTestTracking(chatId: number, env: Env) {
	const suggestions = await suggestFlightsToTrack(env);
	const { text, replyMarkup } = formatFlightSuggestions(suggestions);
	await sendTelegramMessage(chatId, text, env, false, replyMarkup);
}

async function handleFlights(chatId: number, env: Env) {
	const flightData = await env.FLIGHT_DATA.get('latest-arrivals');
	let responseText;
	let replyMarkup = { inline_keyboard: [[{ text: '🔄 Refresh Data', callback_data: 'get_flights' }]] };
	if (flightData) {
		const parsed = JSON.parse(flightData);
		const lastUpdate = new Date(parsed.lastUpdated).toLocaleString();
		responseText =
			`✈️ *Latest Flight Data*\n\n` +
			`📅 Updated: ${lastUpdate}\n` +
			`🔢 Total fetches: ${parsed.updateCount || 'N/A'}\n` +
			`📊 Flights count: ${parsed.data?.length || 'N/A'}\n\n` +
			`_Data refreshes every 2 minutes_`;
	} else {
		responseText = '❌ No flight data available yet\n\n_The system might still be starting up_';
	}
	await sendTelegramMessage(chatId, responseText, env, false, replyMarkup);
}

async function handleStatus(chatId: number, env: Env) {
	const flightData = await env.FLIGHT_DATA.get('latest-arrivals');
	const errorData = await env.FLIGHT_DATA.get('last-error');
	let responseText = '📊 *System Status*\n\n';
	if (flightData) {
		const parsed = JSON.parse(flightData);
		const timeDiff = Date.now() - parsed.timestamp;
		const minutesAgo = Math.floor(timeDiff / 60000);
		responseText += `✅ System: Online\n` + `⏰ Last update: ${minutesAgo} minutes ago\n` + `🔢 Total fetches: ${parsed.updateCount}`;
	} else {
		responseText += '🔶 System: Starting up';
	}
	if (errorData) {
		const error = JSON.parse(errorData);
		const errorTime = new Date(error.timestamp).toLocaleString();
		responseText += `\n\n⚠️ Last error: ${errorTime}`;
	}
	await sendTelegramMessage(chatId, responseText, env);
}
```

### `src/handlers/cron.ts`

```typescript
import { fetchLatestFlights, cleanupCompletedFlights } from '../services/flightData';
import { sendFlightAlerts } from './alerts';
import type { Env } from '../index';

export async function runScheduledJob(env: Env, ctx: ExecutionContext): Promise<Response> {
	try {
		const currentFlights = await fetchLatestFlights(env);
		const currentCount = Number((await env.FLIGHT_DATA.get('update-counter')) || '0') + 1;
		const dataWithMeta = {
			data: currentFlights,
			updateCount: currentCount,
			timestamp: Date.now(),
			lastUpdated: new Date().toISOString(),
			source: 'vercel-api',
		};
		await env.FLIGHT_DATA.put('latest-arrivals', JSON.stringify(dataWithMeta), { expirationTtl: 86400 });
		await env.FLIGHT_DATA.put('update-counter', currentCount.toString());
		await sendFlightAlerts(currentFlights, env);
		await cleanupCompletedFlights(currentFlights, env);
		return new Response('Cron job completed');
	} catch (error) {
		console.error('Cron job failed:', error);
		await env.FLIGHT_DATA.put(
			'last-error',
			JSON.stringify({
				error: error instanceof Error ? error.message : 'Unknown error',
				timestamp: new Date().toISOString(),
			})
		);
		return new Response('Cron job failed', { status: 500 });
	}
}
```

### `src/handlers/alerts.ts`

```typescript
import { sendTelegramMessage } from '../services/telegram';
import type { Env } from '../index';
import type { Flight } from '../types';

export async function sendFlightAlerts(currentFlights: Flight[], env: Env) {
	const prevFlights = JSON.parse((await env.FLIGHT_DATA.get('prev-arrivals')) || '{}') as Record<string, Flight>;
	for (const flight of currentFlights) {
		const prevFlight = prevFlights[flight.flightNumber];
		if (prevFlight) {
			const changes = detectChanges(prevFlight, flight);
			if (changes.length > 0) {
				const trackingUsers = JSON.parse((await env.FLIGHT_DATA.get(`tracking:${flight.flightNumber}`)) || '[]') as string[];
				for (const userId of trackingUsers) {
					await sendAlert(Number(userId), flight, changes, env);
				}
			}
		}
	}
	await env.FLIGHT_DATA.put('prev-arrivals', JSON.stringify(currentFlights.reduce((acc, f) => ({ ...acc, [f.flightNumber]: f }), {})), {
		expirationTtl: 86400,
	});
}

function detectChanges(prevFlight: Flight, currentFlight: Flight): string[] {
	const changes: string[] = [];
	if (prevFlight.status !== currentFlight.status) changes.push(`📍 Status: ${currentFlight.status}`);
	if (prevFlight.actualArrival !== currentFlight.actualArrival)
		changes.push(`🕒 Time: ${currentFlight.actualArrival} (was ${prevFlight.actualArrival})`);
	if (prevFlight.gate !== currentFlight.gate && currentFlight.gate !== 'TBA') changes.push(`🚪 Gate: ${currentFlight.gate}`);
	return changes;
}

async function sendAlert(userId: number, flight: Flight, changes: string[], env: Env) {
	const message = `🚨 *Flight Update: ${flight.flightNumber}*\n\n${changes.join('\n')}\n\n📍 From ${
		flight.origin || 'Unknown'
	}\n📊 [Track Live](https://www.flightradar24.com/data/flights/${flight.flightNumber.toLowerCase()})`;
	await sendTelegramMessage(userId, message, env, false);
}
```

### `src/services
