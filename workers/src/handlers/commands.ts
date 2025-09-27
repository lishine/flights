import { sendTelegramMessage } from '../services/telegram'
import { addFlightTracking, getUserTrackedFlights, clearUserTracking } from '../services/tracking'
import { getCurrentFlights, suggestFlightsToTrack } from '../services/flightData'
import { formatTrackingList, formatFlightSuggestions } from '../utils/formatting'
import { isValidFlightCode } from '../utils/validation'
import { VERSION } from '../utils/constants'
import { DateTime } from 'luxon'
import type { Env } from '../index'
import type { Update, CallbackQuery, Message } from 'typegram'

// Type guard to check if CallbackQuery is DataQuery (has 'data' property)
function isDataQuery(query: CallbackQuery): query is CallbackQuery.DataQuery {
	return 'data' in query
}

// Type guard to check if Message has 'text' property
function isTextMessage(message: Message): message is Message.TextMessage {
	return 'text' in message
}

export async function handleCommand(request: Request, env: Env): Promise<Response> {
	const update = (await request.json()) as Update

	if ('callback_query' in update && update.callback_query) {
		const callbackQuery = update.callback_query
		// Ensure message exists
		if (!callbackQuery.message) {
			await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Message too old' }),
			})
			return new Response('OK')
		}

		const chatId = callbackQuery.message.chat.id
		const messageId = callbackQuery.message.message_id

		// Check if callbackQuery is DataQuery
		if (!isDataQuery(callbackQuery)) {
			await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Unsupported callback type' }),
			})
			return new Response('OK')
		}

		const data = callbackQuery.data

		if (data.startsWith('track_suggested:')) {
			const flightCodes = data.split(':')[1].split(',')
			console.log({ 'to track flightCodes': flightCodes })
			const results = []
			for (const code of flightCodes) {
				console.log({ code: code })
				if (isValidFlightCode(code)) {
					console.log('isvalid', { code: code })
					await addFlightTracking(chatId, code.toUpperCase().replace(' ', ''), env)
					results.push(`✅ Now tracking ${code.toUpperCase()}`)
				} else {
					results.push(`❌ Invalid flight code: ${code}`)
				}
			}
			await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Tracking flights...' }),
			})
			await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chat_id: chatId,
					message_id: messageId,
					text: results.join('\n'),
					parse_mode: 'Markdown',
				}),
			})
			return new Response('OK')
		}

		let responseText = ''
		let replyMarkup = null
		if (data === 'get_flights') {
			const [lastUpdated, updateCount, dataLength] = await Promise.all([
				env.DB.prepare('SELECT value FROM status WHERE key = ?').bind('lastUpdated').first<{ value: string }>(),
				env.DB.prepare('SELECT value FROM status WHERE key = ?').bind('updateCount').first<{ value: string }>(),
				env.DB.prepare('SELECT value FROM status WHERE key = ?').bind('dataLength').first<{ value: string }>(),
			])

			if (lastUpdated?.value) {
				const lastUpdateTimestamp = parseInt(lastUpdated.value)
				const lastUpdate = DateTime.fromMillis(lastUpdateTimestamp)
					.setZone('Asia/Tel_Aviv')
					.toLocaleString(DateTime.DATETIME_MED)
				responseText =
					`✈️ *Flight Data Refreshed*\n\n` +
					`📅 Updated: ${lastUpdate}\n\n` +
					`🔢 Fetches: ${updateCount?.value || 'N/A'}\n\n` +
					`📊 Flights: ${dataLength?.value || 'N/A'}\n\n` +
					`_Data refreshes every 2 minutes_`
			} else {
				responseText = '❌ No flight data available'
			}
			replyMarkup = { inline_keyboard: [[{ text: '🔄 Refresh Again', callback_data: 'get_flights' }]] }
		} else if (data === 'get_status') {
			const [lastUpdated, updateCount] = await Promise.all([
				env.DB.prepare('SELECT value FROM status WHERE key = ?').bind('lastUpdated').first<{ value: string }>(),
				env.DB.prepare('SELECT value FROM status WHERE key = ?').bind('updateCount').first<{ value: string }>(),
			])

			if (lastUpdated?.value) {
				const timestamp = parseInt(lastUpdated.value)
				const timeDiff = Date.now() - timestamp
				const minutesAgo = Math.floor(timeDiff / 60000)
				responseText =
					`📊 *System Status*\n\n` +
					`✅ Online\n\n` +
					`⏰ ${minutesAgo}m ago\n\n` +
					`🔢 ${updateCount?.value || 0} fetches`
			} else {
				responseText = '🔶 System starting up'
			}
		}
		await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ callback_query_id: callbackQuery.id, text: '🔄 Refreshing...' }),
		})
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
		})
		return new Response('OK')
	}

	if ('message' in update && update.message) {
		const chatId = update.message.chat.id
		// Use type guard to check for text property
		if (!isTextMessage(update.message)) {
			await sendTelegramMessage(
				chatId,
				'This bot only supports text commands. Use /help for available commands.',
				env
			)
			return new Response('OK')
		}
		const text = update.message.text

		const commands: { [key: string]: () => Promise<void> } = {
			'/start': () => handleStart(chatId, env),
			'/track': () => handleTrack(chatId, text, env),
			'/tracked': () => handleTracked(chatId, env),
			'/clear_tracked': () => handleClearTracked(chatId, env),
			'/test_tracking': () => handleTestTracking(chatId, env),
			'/flights': () => handleFlights(chatId, env),
			'/status': () => handleStatus(chatId, env),
			'/help': () => handleStart(chatId, env),
		}

		const command = text.split(' ')[0]
		const handler =
			commands[command] ||
			(() => sendTelegramMessage(chatId, `Unknown command. Current version: ${VERSION}`, env))
		await handler()
		return new Response('OK')
	}

	return new Response('OK')
}

async function handleStart(chatId: number, env: Env) {
	const message =
		`🤖 Ben Gurion Airport Bot\n\n` +
		`📝 *Testing Different Spacing Solutions*\n\n` +
		`🔹 Option 1 - Zero Width Space:\n` +
		`✈️ Flight LY123\n\u200B\n` +
		`⏰ Status: On Time\n\u200B\n` +
		`📍 Gate: A1\n\n` +
		`🔹 Option 2 - Invisible Separator:\n` +
		`✈️ Flight LY456<b>\u2063</b>\n` +
		`⏰ Status: Delayed<b>\u2063</b>\n` +
		`📍 Gate: B2<b>\u2063</b>\n\n` +
		`🔹 Option 3 - Text Style Icons:\n` +
		`✈︎ Flight LY789\n` +
		`⏰︎ Status: Boarding\n` +
		`📍︎ Gate: C3\n\n` +
		`🔹 Option 4 - LRM + Hair Space:\n` +
		`✈️ Flight LY111\n\u200E\u200A\n` +
		`⏰ Status: Arrived\n\u200E\u200A\n` +
		`📍 Terminal: 3\n\n` +
		`🔹 Option 5 - Code Wrapped Invisible:\n` +
		`✈️ Flight LY222<code>\u2063</code>\n` +
		`⏰ Status: Cancelled<code>\u2063</code>\n` +
		`📍 Check App<code>\u2063</code>\n\n` +
		`🔹 Option 6 - Mixed Approach:\n` +
		`✈︎ Flight LY333\n\u200B\n` +
		`⏰︎ Status: Delayed\n\u200B\n` +
		`📍︎ Gate Changed\n\n` +
		`🔹 Option 7 - Bold Invisible:\n` +
		`✈️ Flight LY444<b>\u200B</b>\n` +
		`⏰ Status: Boarding<b>\u200B</b>\n` +
		`📍 Gate: A4<b>\u200B</b>\n\n` +
		`🔹 Available Commands:\n` +
		`✈️ /flights - Get latest flight arrivals\n` +
		`📊 /status - System status\n` +
		`🚨 /track LY086 - Track a flight\n` +
		`📋 /tracked - Your tracked flights\n` +
		`🗑️ /clear_tracked - Clear all tracked flights\n` +
		`🎯 /test_tracking - Suggested flights\n` +
		`ℹ️ /help - Show this menu\n\n` +
		`Choose an option:`
	const replyMarkup = {
		inline_keyboard: [
			[
				{ text: '✈️ Get Flights', callback_data: 'get_flights' },
				{ text: '📊 Status', callback_data: 'get_status' },
			],
			[{ text: '🔄 Refresh', callback_data: 'get_flights' }],
		],
	}
	await sendTelegramMessage(chatId, message, env, false, replyMarkup)
}

async function handleTrack(chatId: number, text: string, env: Env) {
	const flightCodes = text.split(' ').slice(1)
	const results = []
	for (const code of flightCodes) {
		if (isValidFlightCode(code)) {
			await addFlightTracking(chatId, code.toUpperCase().replace(' ', ''), env)
			results.push(`✅ Now tracking ${code.toUpperCase()}`)
		} else {
			results.push(`❌ Invalid flight code: ${code}`)
		}
	}
	await sendTelegramMessage(chatId, results.join('\n'), env)
}

async function handleTracked(chatId: number, env: Env) {
	const flights = await getUserTrackedFlights(chatId, env)
	const message = await formatTrackingList(flights, env)
	await sendTelegramMessage(chatId, message, env)
}

async function handleClearTracked(chatId: number, env: Env) {
	const clearedCount = await clearUserTracking(chatId, env)
	const message =
		clearedCount > 0
			? `✅ Cleared ${clearedCount} tracked flight${clearedCount > 1 ? 's' : ''} from your subscriptions.`
			: 'ℹ️ You had no tracked flights to clear.'
	await sendTelegramMessage(chatId, message, env)
}

async function handleTestTracking(chatId: number, env: Env) {
	const suggestions = await suggestFlightsToTrack(chatId, env)
	const { text, replyMarkup } = formatFlightSuggestions(suggestions)
	await sendTelegramMessage(chatId, text, env, false, replyMarkup)
}

async function handleFlights(chatId: number, env: Env) {
	const [lastUpdated, updateCount, dataLength] = await Promise.all([
		env.DB.prepare('SELECT value FROM status WHERE key = ?').bind('lastUpdated').first<{ value: string }>(),
		env.DB.prepare('SELECT value FROM status WHERE key = ?').bind('updateCount').first<{ value: string }>(),
		env.DB.prepare('SELECT value FROM status WHERE key = ?').bind('dataLength').first<{ value: string }>(),
	])

	let responseText
	let replyMarkup = { inline_keyboard: [[{ text: '🔄 Refresh Data', callback_data: 'get_flights' }]] }
	if (lastUpdated?.value) {
		const lastUpdateTimestamp = parseInt(lastUpdated.value)
		const lastUpdate = DateTime.fromMillis(lastUpdateTimestamp)
			.setZone('Asia/Tel_Aviv')
			.toLocaleString(DateTime.DATETIME_MED)
		responseText =
			`✈️ *Latest Flight Data*\n\n` +
			`📅 Updated: ${lastUpdate}\n\n` +
			`🔢 Total fetches: ${updateCount?.value || 'N/A'}\n\n` +
			`📊 Flights count: ${dataLength?.value || 'N/A'}\n\n` +
			`_Data refreshes every 2 minutes_`
	} else {
		responseText = '❌ No flight data available yet\n\n_The system might still be starting up_'
	}
	await sendTelegramMessage(chatId, responseText, env, false, replyMarkup)
}

async function handleStatus(chatId: number, env: Env) {
	const [lastUpdated, updateCount, errorResult] = await Promise.all([
		env.DB.prepare('SELECT value FROM status WHERE key = ?').bind('lastUpdated').first<{ value: string }>(),
		env.DB.prepare('SELECT value FROM status WHERE key = ?').bind('updateCount').first<{ value: string }>(),
		env.DB.prepare('SELECT value FROM status WHERE key = ?').bind('last-error').first<{ value: string }>(),
	])

	const errorData = errorResult?.value
	let responseText = '📊 *System Status*\n\n'
	if (lastUpdated?.value) {
		const timestamp = parseInt(lastUpdated.value)
		const timeDiff = Date.now() - timestamp
		const minutesAgo = Math.floor(timeDiff / 60000)
		responseText +=
			`✅ System: Online\n\n` +
			`⏰ Last update: ${minutesAgo} minutes ago\n\n` +
			`🔢 Total fetches: ${updateCount?.value || 0}`
	} else {
		responseText += '🔶 System: Starting up'
	}
	if (errorData) {
		const error = JSON.parse(errorData)
		const errorTime = new Date(error.timestamp).toLocaleString()
		responseText += `\n\n⚠️ Last error: ${errorTime}`
	}
	await sendTelegramMessage(chatId, responseText, env)
}
