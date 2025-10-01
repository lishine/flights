import { sendTelegramMessage } from '../services/telegram'
import { addFlightTracking, clearUserTracking } from '../services/tracking'
import { getFlightIdByNumber, getNotTrackedFlights } from '../services/flightData'
import { getCurrentIdtTime } from '../utils/dateTime'
import { formatTrackingListOptimized, formatFlightSuggestions } from '../utils/formatting'
import { isValidFlightCode } from '../utils/validation'
import { VERSION, getTelegramUrl } from '../utils/constants'
import type { Env } from '../env'
import type { Update, CallbackQuery, Message } from 'typegram'
import { ofetch } from 'ofetch'

export const formatTimestampForDisplay = (timestamp: number) => {
	const date = new Date(timestamp)
	return date.toLocaleString('en-GB', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})
}

export const isDataQuery = (query: CallbackQuery) => {
	return 'data' in query
}

export const isTextMessage = (message: Message) => {
	return 'text' in message
}

export const handleCommand = async (request: Request, env: Env, ctx: DurableObjectState) => {
	const update = await request.json<Update>()

	if ('callback_query' in update && update.callback_query) {
		const callbackQuery = update.callback_query
		if (!callbackQuery.message) {
			await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Message too old' }),
			})
			return new Response('OK')
		}

		const chatId = callbackQuery.message.chat.id
		const messageId = callbackQuery.message.message_id

		if (!isDataQuery(callbackQuery)) {
			await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Unsupported callback type' }),
			})
			return new Response('OK')
		}

		const data = callbackQuery.data

		if (data.startsWith('track_suggested:')) {
			const flightCodes = data.split(':')[1].split(',')
			const results = []
			for (const code of flightCodes) {
				if (isValidFlightCode(code)) {
					const flightId = getFlightIdByNumber(code.toUpperCase().replace(' ', ''), ctx)
					if (flightId) {
						addFlightTracking(chatId, flightId, env, ctx)
						results.push(`✓ Now tracking ${code.toUpperCase()}`)
					} else {
						results.push(`❌ Flight not found: ${code}`)
					}
				} else {
					results.push(`❌ Invalid flight code: ${code}`)
				}
			}
			await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Tracking flights...' }),
			})
			await ofetch(`${getTelegramUrl(env)}/editMessageText`, {
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
			const lastUpdatedResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'lastUpdated')
			const updateCountResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'updateCount')
			const dataLengthResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'dataLength')

			const lastUpdated = lastUpdatedResult.toArray()[0] as { value: string } | undefined
			const updateCount = updateCountResult.toArray()[0] as { value: string } | undefined
			const dataLength = dataLengthResult.toArray()[0] as { value: string } | undefined

			if (lastUpdated?.value) {
				const lastUpdateTimestamp = parseInt(lastUpdated.value)
				const lastUpdate = formatTimestampForDisplay(lastUpdateTimestamp)
				responseText =
					`🛩️ *Flight Data Refreshed*\n\n` +
					`📅 Updated: ${lastUpdate}\n` +
					`🔢 Fetches: ${updateCount?.value || 'N/A'}\n` +
					`📊 Flights: ${dataLength?.value || 'N/A'}\n\n` +
					`_Data refreshes every 2 minutes_`
			} else {
				responseText = '❌ No flight data available'
			}
			replyMarkup = { inline_keyboard: [[{ text: '🔄 Refresh Again', callback_data: 'get_flights' }]] }
		} else if (data === 'get_status') {
			const lastUpdatedResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'lastUpdated')
			const updateCountResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'updateCount')

			const lastUpdated = lastUpdatedResult.toArray()[0] as { value: string } | undefined
			const updateCount = updateCountResult.toArray()[0] as { value: string } | undefined

			if (lastUpdated?.value) {
				const timestamp = parseInt(lastUpdated.value)
				const nowIsrael = getCurrentIdtTime().getTime()
				const timeDiff = nowIsrael - timestamp
				const minutesAgo = Math.floor(timeDiff / 60000)
				responseText =
					`📊 *System Status*\n\n` +
					`✅ Online\n` +
					`⏱️ ${minutesAgo}m ago\n` +
					`🔢 ${updateCount?.value || 0} fetches`
			} else {
				responseText = '🔶 System starting up'
			}
		}
		await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ callback_query_id: callbackQuery.id, text: '🔄 Refreshing...' }),
		})
		await ofetch(`${getTelegramUrl(env)}/editMessageText`, {
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
			'/track': () => handleTrack(chatId, text, env, ctx),
			'/tracked': () => handleTracked(chatId, env, ctx),
			'/clear_tracked': () => handleClearTracked(chatId, env, ctx),
			'/test_tracking': () => handleTestTracking(chatId, env, ctx),
			'/flights': () => handleFlights(chatId, env, ctx),
			'/status': () => handleStatus(chatId, env, ctx),
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

const handleStart = async (chatId: number, env: Env) => {
	const message =
		`🤖 Ben Gurion Airport Bot\n\n` +
		`Available commands:\n` +
		`🛩️ /flights - Get latest flight arrivals\n` +
		`📊 /status - System status\n` +
		`🚨 /track LY086 - Track a flight\n` +
		`📋 /tracked - Your tracked flights\n` +
		`🗑️ /clear\\_tracked - Clear all tracked flights\n` +
		`🎯 /test\\_tracking - Suggested flights\n` +
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

const handleTrack = async (chatId: number, text: string, env: Env, ctx: DurableObjectState) => {
	const flightCodes = text.split(' ').slice(1)
	const results = []
	for (const code of flightCodes) {
		if (isValidFlightCode(code)) {
			const flightId = getFlightIdByNumber(code.toUpperCase().replace(' ', ''), ctx)
			if (flightId) {
				addFlightTracking(chatId, flightId, env, ctx)
				results.push(`✓ Now tracking ${code.toUpperCase()}`)
			} else {
				results.push(`❌ Flight not found: ${code}`)
			}
		} else {
			results.push(`❌ Invalid flight code: ${code}`)
		}
	}
	await sendTelegramMessage(chatId, results.join('\n'), env)
}

const handleTracked = async (chatId: number, env: Env, ctx: DurableObjectState) => {
	const message = formatTrackingListOptimized(chatId, env, ctx)
	await sendTelegramMessage(chatId, message, env)
}

const handleClearTracked = async (chatId: number, env: Env, ctx: DurableObjectState) => {
	const clearedCount = await clearUserTracking(chatId, env, ctx)
	const message =
		clearedCount > 0
			? `✅ Cleared ${clearedCount} tracked flight${clearedCount > 1 ? 's' : ''} from your subscriptions.`
			: 'ℹ️ You had no tracked flights to clear.'
	await sendTelegramMessage(chatId, message, env)
}

const handleTestTracking = async (chatId: number, env: Env, ctx: DurableObjectState) => {
	const eligibleFlights = getNotTrackedFlights(chatId, ctx)

	// Format and send suggestions (limit to 5 flights)
	const { text, replyMarkup } = formatFlightSuggestions(eligibleFlights.slice(0, 5))
	await sendTelegramMessage(chatId, text, env, false, replyMarkup)
}

const handleFlights = async (chatId: number, env: Env, ctx: DurableObjectState) => {
	const lastUpdatedResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'lastUpdated')
	const updateCountResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'updateCount')
	const dataLengthResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'dataLength')

	const lastUpdated = lastUpdatedResult.toArray()[0] as { value: string } | undefined
	const updateCount = updateCountResult.toArray()[0] as { value: string } | undefined
	const dataLength = dataLengthResult.toArray()[0] as { value: string } | undefined

	let responseText
	let replyMarkup = { inline_keyboard: [[{ text: '🔄 Refresh Data', callback_data: 'get_flights' }]] }
	if (lastUpdated?.value) {
		const lastUpdateTimestamp = parseInt(lastUpdated.value)
		const lastUpdate = formatTimestampForDisplay(lastUpdateTimestamp)
		responseText =
			`🛩️ *Latest Flight Data*\n\n` +
			`📅 Updated: ${lastUpdate}\n` +
			`🔢 Total fetches: ${updateCount?.value || 'N/A'}\n` +
			`📊 Flights count: ${dataLength?.value || 'N/A'}\n\n` +
			`_Data refreshes every 2 minutes_`
	} else {
		responseText = '❌ No flight data available yet\n\n_The system might still be starting up_'
	}
	await sendTelegramMessage(chatId, responseText, env, false, replyMarkup)
}

const handleStatus = async (chatId: number, env: Env, ctx: DurableObjectState) => {
	const lastUpdatedResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'lastUpdated')
	const updateCountResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'updateCount')
	const errorResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'last-error')

	const lastUpdated = lastUpdatedResult.toArray()[0] as { value: string } | undefined
	const updateCount = updateCountResult.toArray()[0] as { value: string } | undefined
	const errorResultRow = errorResult.toArray()[0] as { value: string } | undefined

	const errorData = errorResultRow?.value
	let responseText = '📊 *System Status*\n\n'
	if (lastUpdated?.value) {
		const timestamp = parseInt(lastUpdated.value)
		const nowIsrael = getCurrentIdtTime().getTime()
		const timeDiff = nowIsrael - timestamp
		const minutesAgo = Math.floor(timeDiff / 60000)
		responseText +=
			`✅ System: Online\n\n` +
			`⏱️ Last update: ${minutesAgo} minutes ago\n\n` +
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
