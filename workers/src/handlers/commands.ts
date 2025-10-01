import { sendTelegramMessage } from '../services/telegram'
import { addFlightTracking, clearUserTracking, untrackFlight } from '../services/tracking'
import { getFlightIdByNumber, getNotTrackedFlights, generateFakeFlights } from '../services/flightData'
import { getCurrentIdtTime, formatTimeAgo, formatTimestampForDisplay } from '../utils/dateTime'
import { formatTrackingListOptimized, formatFlightSuggestions } from '../utils/formatting'
import { isValidFlightCode } from '../utils/validation'
import { getTelegramUrl } from '../utils/constants'
import type { Env } from '../env'
import type { Update, CallbackQuery, Message } from 'typegram'
import { ofetch } from 'ofetch'
import versionData from '../../version.json'

export const isDataQuery = (query: CallbackQuery) => {
	return 'data' in query
}

export const isTextMessage = (message: Message) => {
	return 'text' in message
}

// Shared function to build status message - eliminates code duplication
const buildStatusMessage = (ctx: DurableObjectState) => {
	const lastUpdatedResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'lastUpdated')
	const updateCountResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'updateCount')
	const dataLengthResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'dataLength')
	const errorResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'last-error')

	const lastUpdated = lastUpdatedResult.toArray()[0] as { value: string } | undefined
	const updateCount = updateCountResult.toArray()[0] as { value: string } | undefined
	const dataLength = dataLengthResult.toArray()[0] as { value: string } | undefined
	const errorResultRow = errorResult.toArray()[0] as { value: string } | undefined

	const errorData = errorResultRow?.value

	// Build flight data section
	let flightDataSection = ''
	const lastUpdateTimestamp = lastUpdated?.value ? parseInt(lastUpdated.value) || 0 : 0
	if (lastUpdated?.value && lastUpdateTimestamp > 0 && lastUpdateTimestamp < Date.now()) {
		const lastUpdate = formatTimestampForDisplay(lastUpdateTimestamp)
		const totalFetches = updateCount?.value ? parseInt(updateCount.value) || 0 : 0
		const flightsCount = dataLength?.value ? parseInt(dataLength.value) || 0 : 0
		flightDataSection =
			`🛩️ *Latest Flight Data*\n\n` +
			`📅 Updated: ${lastUpdate}\n` +
			`🔢 Total fetches: ${totalFetches}\n` +
			`📊 Flights count: ${flightsCount}\n\n`
	} else {
		flightDataSection = '❌ No flight data available yet\n\n'
	}

	// Build system status section
	let statusSection = '📊 *System Status*\n\n'
	const timestamp = lastUpdated?.value ? parseInt(lastUpdated.value) || 0 : 0
	if (lastUpdated?.value && timestamp > 0 && timestamp < Date.now()) {
		const timeAgo = formatTimeAgo(timestamp)
		const totalFetches = updateCount?.value ? parseInt(updateCount.value) || 0 : 0
		statusSection +=
			`✅ System: Online\n\n` +
			`⏱️ Last update: ${timeAgo}\n\n` +
			`🔢 Total fetches: ${totalFetches}\n` +
			`📦 Version: ${versionData.version}\n` +
			`📦 Code updated: ${versionData.update_date}\n`
	} else {
		statusSection += '🔶 System: Starting up'
	}

	// Add error information if present
	if (errorData) {
		const error = JSON.parse(errorData)
		const errorTime = new Date(error.timestamp).toLocaleString()
		statusSection += `\n\n⚠️ Last error: ${errorTime}`
	}

	const responseText = flightDataSection + statusSection + '\n\n_Data refreshes every 2 minutes_'

	return responseText
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

		if (data.startsWith('track_single:')) {
			const flightNumber = data.split(':')[1]
			// Reuse handleTrack function by constructing a command-like text
			await handleTrack(chatId, `/track ${flightNumber}`, env, ctx)

			await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Tracking flight...' }),
			})
			// Don't need to edit the message since handleTrack will send a new one
			return new Response('OK')
		}

		if (data.startsWith('untrack_single:')) {
			const flightId = data.split(':')[1]
			await handleUntrack(chatId, flightId, env, ctx)

			await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Untracking flight...' }),
			})

			// Update the message to show the new tracked flights list
			const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(chatId, env, ctx)
			const responseText = `🚨 *Your Tracked Flights*\n\n${trackedMessage}`

			// Combine the untrack buttons with navigation buttons
			const navigationButtons = [
				[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
				[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
			]
			const finalMarkup = {
				inline_keyboard: [...(trackedMarkup?.inline_keyboard || []), ...navigationButtons],
			}

			await ofetch(`${getTelegramUrl(env)}/editMessageText`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chat_id: chatId,
					message_id: messageId,
					text: responseText,
					parse_mode: 'Markdown',
					reply_markup: finalMarkup,
				}),
			})
			return new Response('OK')
		}

		let responseText = ''
		let replyMarkup = null
		if (data === 'get_status') {
			responseText = buildStatusMessage(ctx)
			replyMarkup = {
				inline_keyboard: [
					[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
					[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
					[{ text: '🔄 Refresh Status', callback_data: 'get_status' }],
				],
			}
		} else if (data === 'show_tracked') {
			const trackedMessage = formatTrackingListOptimized(chatId, env, ctx)
			responseText = `🚨 *Your Tracked Flights*\n\n${trackedMessage}`
			replyMarkup = {
				inline_keyboard: [
					[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
					[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
				],
			}
		} else if (data === 'show_suggestions') {
			const eligibleFlights = getNotTrackedFlights(chatId, ctx)
			const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(eligibleFlights.slice(0, 5))
			responseText = `🎯 *Flight Suggestions*\n\n${text}`
			replyMarkup = {
				inline_keyboard: [
					[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
					[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
					...(suggestionsMarkup?.inline_keyboard || []),
				],
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
			'/track': () => handleTrack(chatId, text, env, ctx),
			'/clear_tracked': () => handleClearTracked(chatId, env, ctx),
			'/status': () => handleStatus(chatId, env, ctx),
			'/test': () => handleTestData(chatId, env, ctx),
		}
		const command = text.split(' ')[0]
		const handler =
			commands[command] ||
			(() =>
				sendTelegramMessage(
					chatId,
					`Unknown command.\n` +
						`📦 Version: ${versionData.version}\n` +
						`📦 Code updated: ${versionData.update_date}\n`,
					env
				))
		await handler()
		return new Response('OK')
	}

	return new Response('OK')
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

const handleUntrack = async (chatId: number, flightId: string, env: Env, ctx: DurableObjectState) => {
	// Remove the flight from tracking using the untrackFlight function
	untrackFlight(chatId, flightId, env, ctx)
}

const handleClearTracked = async (chatId: number, env: Env, ctx: DurableObjectState) => {
	const clearedCount = clearUserTracking(chatId, env, ctx)
	const message =
		clearedCount > 0
			? `✅ Cleared ${clearedCount} tracked flight${clearedCount > 1 ? 's' : ''} from your subscriptions.`
			: 'ℹ️ You had no tracked flights to clear.'
	await sendTelegramMessage(chatId, message, env)
}

const handleTestTracking = async (chatId: number, env: Env, ctx: DurableObjectState) => {
	const eligibleFlights = getNotTrackedFlights(chatId, ctx)

	const { text, replyMarkup } = formatFlightSuggestions(eligibleFlights.slice(0, 5))
	await sendTelegramMessage(chatId, text, env, false, replyMarkup)
}

const handleStatus = async (chatId: number, env: Env, ctx: DurableObjectState) => {
	// Build the main status message
	const responseText = buildStatusMessage(ctx)

	// Build inline keyboard with action buttons
	const inlineKeyboard = [
		[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
		[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
		[{ text: '🔄 Refresh Status', callback_data: 'get_status' }],
	]

	await sendTelegramMessage(chatId, responseText, env, false, { inline_keyboard: inlineKeyboard })
}

const handleTestData = async (chatId: number, env: Env, ctx: DurableObjectState) => {
	try {
		// Clear existing fake flights
		ctx.storage.sql.exec("DELETE FROM flights WHERE flight_number LIKE 'FAKE_%'")

		// Add new fake flights
		const fakeFlights = generateFakeFlights()
		for (const flight of fakeFlights) {
			ctx.storage.sql.exec(
				`INSERT INTO flights (id, flight_number, status, sta, eta, city, airline, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				flight.id,
				flight.flight_number,
				flight.status,
				flight.sta,
				flight.eta,
				flight.city,
				flight.airline,
				flight.created_at,
				flight.updated_at
			)
		}

		await sendTelegramMessage(
			chatId,
			`✅ Added ${fakeFlights.length} test flights to the database.\n\n` +
				`Use /test-tracking to see flight suggestions with the test data.`,
			env
		)
	} catch (error) {
		console.error('Error adding test data:', error)
		await sendTelegramMessage(chatId, '❌ Failed to add test data. Please try again.', env)
	}
}
