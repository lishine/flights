import { sendTelegramMessage } from '../services/telegram'
import { addFlightTracking, clearUserTracking, untrackFlight } from '../services/tracking'
import { getFlightIdByNumber, getNotTrackedFlights, generateFakeFlights, storeFlights } from '../services/kvFlightData'
import { getCurrentIdtTime, formatTimeAgo, formatTimestampForDisplay } from '../utils/dateTime'
import { formatTrackingListOptimized, formatFlightSuggestions, escapeMarkdown } from '../utils/formatting'
import { isValidFlightCode } from '../utils/validation'
import { CRON_PERIOD_SECONDS, getTelegramUrl } from '../utils/constants'
import type { Env } from '../env'
import type { Update, CallbackQuery, Message } from 'typegram'
import { ofetch } from 'ofetch'

export const isDataQuery = (query: CallbackQuery) => {
	return 'data' in query
}

export const isTextMessage = (message: Message) => {
	return 'text' in message
}

// Shared function to build status message - eliminates code duplication
const buildStatusMessage = async (env: Env, ctx: DurableObjectState) => {
	const version = await env.METADATA.get('version') || 'Unknown'
	const lastDeployDate = await env.METADATA.get('last_deploy_date') || 'Unknown'
	
	const lastUpdatedResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'lastUpdated')
	const updateCountResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'updateCount')
	const dataLengthResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'dataLength')
	const errorResult = ctx.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'last-error')

	const lastUpdated = lastUpdatedResult.toArray()[0] as { value: string } | undefined
	const updateCount = updateCountResult.toArray()[0] as { value: string } | undefined
	const dataLength = dataLengthResult.toArray()[0] as { value: string } | undefined
	const errorResultRow = errorResult.toArray()[0] as { value: string } | undefined

	const errorData = errorResultRow?.value

	// Build unified status message
	let statusMessage = '📊 *System Status*\n\n'

	const timestamp = lastUpdated?.value ? parseInt(lastUpdated.value) || 0 : 0
	if (lastUpdated?.value && timestamp > 0) {
		const lastUpdate = formatTimestampForDisplay(timestamp)
		const timeAgo = formatTimeAgo(timestamp)
		const totalFetches = updateCount?.value ? parseInt(updateCount.value) || 0 : 0
		const flightsCount = dataLength?.value ? parseInt(dataLength.value) || 0 : 0

		statusMessage +=
			`✅ System: Online\n\n` +
			`📅 Last updated: ${escapeMarkdown(lastUpdate)} (${escapeMarkdown(timeAgo)})\n` +
			`📊 Flights count: ${flightsCount}\n` +
			`🔢 Total fetches: ${totalFetches}\n\n` +
			`📦 Version: ${escapeMarkdown(version)}\n` +
			`📦 Code updated: ${escapeMarkdown(lastDeployDate)}\n`
	} else {
		statusMessage +=
			'🔶 System: Starting up\n\n' +
			`📦 Version: ${escapeMarkdown(version)}\n` +
			`📦 Code updated: ${escapeMarkdown(lastDeployDate)}\n`
	}

	// Add error information if present
	if (errorData) {
		const error = JSON.parse(errorData)
		const errorTime = new Date(error.timestamp).toLocaleString()
		statusMessage += `\n\n⚠️ Last error: ${escapeMarkdown(errorTime)}`
	}

	const responseText = statusMessage + `\n\n_⏱️ Data refreshes every ${CRON_PERIOD_SECONDS} seconds_`

	return responseText
}

export const handleCommand = async (request: Request, env: Env, ctx: DurableObjectState) => {
	const update = await request.json<Update>()

	if ('callback_query' in update && update.callback_query) {
		const callbackQuery = update.callback_query
		if (!callbackQuery.message) {
			// Try to answer the callback query but handle the case where the message is too old
			try {
				await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						callback_query_id: callbackQuery.id,
						text: 'This message is too old to interact with',
						show_alert: true,
					}),
				})
			} catch (error) {
				console.error('Failed to answer callback query for old message:', {
					callbackQueryId: callbackQuery.id,
					error: error instanceof Error ? error.message : 'Unknown error',
					status: error instanceof Error && 'status' in error ? (error as any).status : 'N/A',
				})
				// Don't rethrow - just log the error since we can't handle old messages anyway
			}
			return new Response('OK')
		}

		const chatId = callbackQuery.message.chat.id
		const messageId = callbackQuery.message.message_id

		if (!isDataQuery(callbackQuery)) {
			try {
				await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						callback_query_id: callbackQuery.id,
						text: 'Unsupported callback type',
						show_alert: true,
					}),
				})
			} catch (error) {
				console.error('Failed to answer unsupported callback query:', {
					callbackQueryId: callbackQuery.id,
					error: error instanceof Error ? error.message : 'Unknown error',
					status: error instanceof Error && 'status' in error ? (error as any).status : 'N/A',
				})
			}
			return new Response('OK')
		}

		const data = callbackQuery.data

		if (data.startsWith('track_suggested:')) {
			const flightCodes = data.split(':')[1].split(',')
			const results = []
			for (const code of flightCodes) {
				if (isValidFlightCode(code)) {
					const flightId = await getFlightIdByNumber(code.toUpperCase().replace(' ', ''), ctx)
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
			try {
				await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Tracking flights...' }),
				})
			} catch (error) {
				console.error('Failed to answer track_suggested callback query:', {
					callbackQueryId: callbackQuery.id,
					flightCodes,
					error: error instanceof Error ? error.message : 'Unknown error',
					status: error instanceof Error && 'status' in error ? (error as any).status : 'N/A',
				})
			}
			try {
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
			} catch (error) {
				console.error('Failed to edit message for track_suggested:', {
					chatId,
					messageId,
					results,
					error: error instanceof Error ? error.message : 'Unknown error',
					status: error instanceof Error && 'status' in error ? (error as any).status : 'N/A',
				})
			}
			return new Response('OK')
		}

		if (data.startsWith('track_single:')) {
			const flightNumber = data.split(':')[1]
			// Reuse handleTrack function by constructing a command-like text
			await handleTrack(chatId, `/track ${flightNumber}`, env, ctx)

			try {
				await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Tracking flight...' }),
				})
			} catch (error) {
				console.error('Failed to answer track_single callback query:', {
					callbackQueryId: callbackQuery.id,
					flightNumber,
					error: error instanceof Error ? error.message : 'Unknown error',
					status: error instanceof Error && 'status' in error ? (error as any).status : 'N/A',
				})
			}
			// Don't need to edit the message since handleTrack will send a new one
			return new Response('OK')
		}

		if (data.startsWith('untrack_single:')) {
			const flightId = data.split(':')[1]
			await handleUntrack(chatId, flightId, env, ctx)

			try {
				await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Untracking flight...' }),
				})
			} catch (error) {
				console.error('Failed to answer untrack_single callback query:', {
					callbackQueryId: callbackQuery.id,
					flightId,
					error: error instanceof Error ? error.message : 'Unknown error',
					status: error instanceof Error && 'status' in error ? (error as any).status : 'N/A',
				})
			}

			// Update the message to show the new tracked flights list
			const { text: trackedMessage, replyMarkup: trackedMarkup } = await formatTrackingListOptimized(chatId, env, ctx)
			const responseText = `🚨 *Your Tracked Flights*\n\n${trackedMessage}`

			// Combine the untrack buttons with navigation buttons
			const navigationButtons = [
				[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
				[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
			]
			const finalMarkup = {
				inline_keyboard: [...(trackedMarkup?.inline_keyboard || []), ...navigationButtons],
			}

			try {
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
			} catch (error) {
				console.error('Failed to edit message for untrack_single:', {
					chatId,
					messageId,
					responseText,
					error: error instanceof Error ? error.message : 'Unknown error',
					status: error instanceof Error && 'status' in error ? (error as any).status : 'N/A',
				})
			}
			return new Response('OK')
		}

		let responseText = ''
		let replyMarkup = null
		if (data === 'get_status') {
			responseText = await buildStatusMessage(env, ctx)
			replyMarkup = {
				inline_keyboard: [
					[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
					[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
					[{ text: '🔄 Refresh Status', callback_data: 'get_status' }],
				],
			}
		} else if (data === 'show_tracked') {
			const { text: trackedMessage, replyMarkup: trackedMarkup } = await formatTrackingListOptimized(chatId, env, ctx)
			responseText = `🚨 *Your Tracked Flights*\n\n${trackedMessage}`
			// Combine the untrack buttons with navigation buttons
			const navigationButtons = [
				[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
				[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
			]
			replyMarkup = {
				inline_keyboard: [...(trackedMarkup?.inline_keyboard || []), ...navigationButtons],
			}
		} else if (data === 'show_suggestions') {
			const eligibleFlights = await getNotTrackedFlights(chatId, ctx)
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
		try {
			await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callback_query_id: callbackQuery.id, text: '🔄 Refreshing...' }),
			})
		} catch (error) {
			console.error('Failed to answer general callback query:', {
				callbackQueryId: callbackQuery.id,
				data,
				error: error instanceof Error ? error.message : 'Unknown error',
				status: error instanceof Error && 'status' in error ? (error as any).status : 'N/A',
			})
		}
		try {
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
		} catch (error) {
			// Telegram returns 400 if message content is identical - this is expected and not an error
			const is400Error = error instanceof Error && 'status' in error && (error as any).status === 400
			if (!is400Error) {
				console.error('Failed to edit message for general callback:', {
					chatId,
					messageId,
					data,
					responseText,
					error: error instanceof Error ? error.message : 'Unknown error',
					status: error instanceof Error && 'status' in error ? (error as any).status : 'N/A',
				})
			}
		}
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
			(async () => {
				const version = await env.METADATA.get('version') || 'Unknown'
				const lastDeployDate = await env.METADATA.get('last_deploy_date') || 'Unknown'
				await sendTelegramMessage(
					chatId,
					`Unknown command.\n` +
						`📦 Version: ${version}\n` +
						`📦 Code updated: ${lastDeployDate}\n`,
					env
				)
			})
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
			const flightId = await getFlightIdByNumber(code.toUpperCase().replace(' ', ''), ctx)
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
	const eligibleFlights = await getNotTrackedFlights(chatId, ctx)

	const { text, replyMarkup } = formatFlightSuggestions(eligibleFlights.slice(0, 5))
	await sendTelegramMessage(chatId, text, env, false, replyMarkup)
}

const handleStatus = async (chatId: number, env: Env, ctx: DurableObjectState) => {
	// Build the main status message
	const responseText = await buildStatusMessage(env, ctx)

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
		// Generate fake flights
		const fakeFlights = generateFakeFlights()
		
		// Store fake flights in KV (this replaces SQLite storage)
		await storeFlights(fakeFlights, ctx)

		await sendTelegramMessage(
			chatId,
			`✅ Added ${fakeFlights.length} test flights to KV storage.\n\n` +
				`Use /test-tracking to see flight suggestions with the test data.`,
			env
		)
	} catch (error) {
		console.error('Error adding test data:', error)
		await sendTelegramMessage(chatId, '❌ Failed to add test data. Please try again.', env)
	}
}
