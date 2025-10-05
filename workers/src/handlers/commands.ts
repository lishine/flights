import { Bot, Context } from 'grammy'
import { sendTelegramMessage, sendAdmin } from '../services/telegram'
import { addFlightTracking, clearUserTracking, untrackFlight } from '../services/tracking'
import { getFlightIdByNumber, getNotTrackedFlights, generateFakeFlights, storeFlights } from '../services/flightData'
import {
	formatTrackingListOptimized,
	formatFlightSuggestions,
	escapeMarkdown,
	formatTimestampForDisplay,
	formatTimeAgo,
} from '../utils/formatting'
import { isValidFlightCode } from '../utils/validation'
import { CRON_PERIOD_SECONDS } from '../utils/constants'
import type { Env } from '../env'
import type { DOProps } from '../types'

// Extend Context to include our custom properties
export interface BotContext extends Context {
	env: Env
	ctx: DurableObjectState<DOProps>
}

const buildStatusMessage = async (env: Env, ctx: DurableObjectState<DOProps>) => {
	const version = (await env.METADATA.get('version')) || 'Unknown'
	const lastDeployDate = (await env.METADATA.get('last_deploy_date')) || 'Unknown'

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
		const timeAgo = formatTimeAgo(timestamp, ctx)
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

export const setupBotHandlers = (bot: Bot<BotContext>) => {
	// Command handlers
	bot.command('track', async (ctx) => {
		if (!ctx.chat) return
		const text = ctx.message?.text || ''
		await handleTrack(ctx.chat.id, text, ctx.env, ctx.ctx)
	})

	bot.command('clear_tracked', async (ctx) => {
		await handleClearTracked(ctx.chat.id, ctx.env, ctx.ctx)
	})

	bot.command('status', async (ctx) => {
		await handleStatus(ctx.chat.id, ctx.env, ctx.ctx)
	})

	bot.command('test', async (ctx) => {
		await handleTestData(ctx.chat.id, ctx.env, ctx.ctx)
	})

	// Callback query handlers
	bot.callbackQuery('get_status', async (ctx) => {
		if (!ctx.chat) return
		const responseText = await buildStatusMessage(ctx.env, ctx.ctx)
		const replyMarkup = {
			inline_keyboard: [
				[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
				[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
			],
		}

		await ctx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: replyMarkup,
		})
		await ctx.answerCallbackQuery('🔄 Refreshing...')
	})

	bot.callbackQuery('show_tracked', async (ctx) => {
		if (!ctx.chat) return
		const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(
			ctx.chat.id,
			ctx.env,
			ctx.ctx
		)
		const responseText = `🚨 *Your Tracked Flights*\n\n${trackedMessage}`

		const navigationButtons = [[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }]]
		const replyMarkup = {
			inline_keyboard: [
				...(trackedMarkup?.inline_keyboard || []),
				...navigationButtons,
				[{ text: '🗑️ Untrack All', callback_data: 'untrack_all' }],
			],
		}

		await ctx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: replyMarkup,
		})
		await ctx.answerCallbackQuery('🔄 Refreshing...')
	})

	bot.callbackQuery('show_suggestions', async (ctx) => {
		if (!ctx.chat) return
		ctx.ctx.storage.kv.put(`pagination_cursor_${ctx.chat.id}`, '0')

		const eligibleFlights = getNotTrackedFlights(ctx.chat.id, ctx.ctx)

		const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(
			eligibleFlights.slice(0, 5),
			0,
			eligibleFlights.length,
			ctx.ctx
		)

		const navigationButtons = [[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }]]
		const paginationRow =
			eligibleFlights.length > 5 ? [{ text: 'Next ➡️', callback_data: 'suggestions_page:1' }] : []

		const allButtons = [...navigationButtons]
		if (paginationRow.length > 0) allButtons.push(paginationRow)
		allButtons.push(...(suggestionsMarkup?.inline_keyboard || []))

		const debugInfo = `\n\n🐛 *Debug:* ${eligibleFlights.length} eligible flights, Next button: ${eligibleFlights.length > 5 ? 'YES' : 'NO'}`
		const responseText = `🎯 *Flight Suggestions*\n\n${text}${debugInfo}`

		await ctx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: { inline_keyboard: allButtons },
		})
		await ctx.answerCallbackQuery('🔄 Refreshing...')
	})

	bot.callbackQuery(/^suggestions_page:\d+$/, async (ctx) => {
		if (!ctx.chat) return
		const page = parseInt(ctx.match[1])
		const eligibleFlights = getNotTrackedFlights(ctx.chat.id, ctx.ctx)
		const startIndex = page * 5
		const endIndex = startIndex + 5
		const pageFlights = eligibleFlights.slice(startIndex, endIndex)

		ctx.ctx.storage.kv.put(`pagination_cursor_${ctx.chat.id}`, page.toString())

		const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(
			pageFlights,
			page,
			eligibleFlights.length,
			ctx.ctx
		)
		const responseText = `🎯 *Flight Suggestions*\n\n${text}`

		const navigationButtons = [[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }]]
		const paginationRow = []
		if (page > 0) paginationRow.push({ text: '⬅️ Previous', callback_data: `suggestions_page:${page - 1}` })
		if (endIndex < eligibleFlights.length)
			paginationRow.push({ text: 'Next ➡️', callback_data: `suggestions_page:${page + 1}` })

		const allButtons = [...navigationButtons]
		if (paginationRow.length > 0) allButtons.push(paginationRow)
		allButtons.push(...(suggestionsMarkup?.inline_keyboard || []))

		await ctx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: { inline_keyboard: allButtons },
		})
		await ctx.answerCallbackQuery('🔄 Refreshing...')
	})

	bot.callbackQuery(/^track_suggested:.+$/, async (ctx) => {
		if (!ctx.chat) return
		const flightCodes = ctx.match[1].split(',')
		const results = []
		for (const code of flightCodes) {
			if (isValidFlightCode(code)) {
				const flightId = getFlightIdByNumber(code.toUpperCase().replace(' ', ''), ctx.ctx)
				if (flightId) {
					addFlightTracking(ctx.chat.id, flightId, ctx.env, ctx.ctx)
					results.push(`✓ Now tracking ${code.toUpperCase()}`)
				} else {
					results.push(`❌ Flight not found: ${code}`)
				}
			} else {
				results.push(`❌ Invalid flight code: ${code}`)
			}
		}

		await ctx.answerCallbackQuery('Tracking flights...')

		const cursorKey = `pagination_cursor_${ctx.chat.id}`
		const cursorStr = ctx.ctx.storage.kv.get<string>(cursorKey) || '0'
		const currentPage = parseInt(cursorStr) || 0
		const nextPage = currentPage + 1

		const eligibleFlights = getNotTrackedFlights(ctx.chat.id, ctx.ctx)
		const startIndex = nextPage * 5
		const endIndex = startIndex + 5
		const pageFlights = eligibleFlights.slice(startIndex, endIndex)

		ctx.ctx.storage.kv.put(cursorKey, nextPage.toString())

		const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(
			pageFlights,
			nextPage,
			eligibleFlights.length,
			ctx.ctx
		)

		let responseText = `🎯 *Flight Suggestions*\n\n${text}\n\n${results.join('\n')}`

		const navigationButtons = [[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }]]
		const paginationRow = []
		if (nextPage > 0) paginationRow.push({ text: '⬅️ Previous', callback_data: `suggestions_page:${nextPage - 1}` })
		if (endIndex < eligibleFlights.length)
			paginationRow.push({ text: 'Next ➡️', callback_data: `suggestions_page:${nextPage + 1}` })

		const allButtons = [...navigationButtons]
		if (paginationRow.length > 0) allButtons.push(paginationRow)
		allButtons.push(...(suggestionsMarkup?.inline_keyboard || []))

		await ctx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: { inline_keyboard: allButtons },
		})
	})

	bot.callbackQuery(/^track_single:.+$/, async (ctx) => {
		if (!ctx.chat) return
		const flightNumber = ctx.match[1]
		await handleTrack(ctx.chat.id, `/track ${flightNumber}`, ctx.env, ctx.ctx)
		await ctx.answerCallbackQuery('Tracking flight...')
	})

	bot.callbackQuery(/^untrack_single:.+$/, async (ctx) => {
		if (!ctx.chat) return
		const flightId = ctx.match[1]
		await handleUntrack(ctx.chat.id, flightId, ctx.env, ctx.ctx)
		await ctx.answerCallbackQuery('Untracking flight...')

		const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(
			ctx.chat.id,
			ctx.env,
			ctx.ctx
		)
		const responseText = `🚨 *Your Tracked Flights*\n\n${trackedMessage}`

		const navigationButtons = [
			[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
			[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
		]
		const finalMarkup = {
			inline_keyboard: [...(trackedMarkup?.inline_keyboard || []), ...navigationButtons],
		}

		await ctx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: finalMarkup,
		})
	})

	bot.callbackQuery('untrack_all', async (ctx) => {
		if (!ctx.chat) return
		const clearedCount = clearUserTracking(ctx.chat.id, ctx.env, ctx.ctx)

		const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(
			ctx.chat.id,
			ctx.env,
			ctx.ctx
		)
		const responseText =
			clearedCount > 0
				? `✅ Cleared ${clearedCount} tracked flight${clearedCount > 1 ? 's' : ''} from your subscriptions.\n\n🚨 *Your Tracked Flights*\n\n${trackedMessage}`
				: 'ℹ️ You had no tracked flights to clear.\n\n🚨 *Your Tracked Flights*\n\n' + trackedMessage

		const navigationButtons = [[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }]]
		const finalMarkup = {
			inline_keyboard: [...(trackedMarkup?.inline_keyboard || []), ...navigationButtons],
		}

		await ctx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: finalMarkup,
		})
		await ctx.answerCallbackQuery('🔄 Refreshing...')
	})

	// Handle unknown commands
	bot.on('message:text', async (ctx) => {
		const version = (await ctx.env.METADATA.get('version')) || 'Unknown'
		const lastDeployDate = (await ctx.env.METADATA.get('last_deploy_date')) || 'Unknown'
		await ctx.reply(`Unknown command.\n📦 Version: ${version}\n📦 Code updated: ${lastDeployDate}`, {
			parse_mode: 'Markdown',
		})
	})

	// Handle old callback queries
	bot.callbackQuery(/.*/, async (ctx) => {
		if (!ctx.callbackQuery.message) {
			await ctx.answerCallbackQuery({ text: 'This message is too old to interact with', show_alert: true })
			return
		}
		await ctx.answerCallbackQuery({ text: 'Unsupported callback type', show_alert: true })
	})
}

const handleTrack = async (chatId: number, text: string, env: Env, ctx: DurableObjectState<DOProps>) => {
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

const handleUntrack = async (chatId: number, flightId: string, env: Env, ctx: DurableObjectState<DOProps>) => {
	// Remove the flight from tracking using the untrackFlight function
	untrackFlight(chatId, flightId, env, ctx)
}

const handleClearTracked = async (chatId: number, env: Env, ctx: DurableObjectState<DOProps>) => {
	const clearedCount = clearUserTracking(chatId, env, ctx)
	const message =
		clearedCount > 0
			? `✅ Cleared ${clearedCount} tracked flight${clearedCount > 1 ? 's' : ''} from your subscriptions.`
			: 'ℹ️ You had no tracked flights to clear.'
	await sendTelegramMessage(chatId, message, env)
}

const handleTestTracking = async (chatId: number, env: Env, ctx: DurableObjectState<DOProps>) => {
	const eligibleFlights = getNotTrackedFlights(chatId, ctx)

	const { text, replyMarkup } = formatFlightSuggestions(eligibleFlights.slice(0, 5), 0, eligibleFlights.length, ctx)
	await sendTelegramMessage(chatId, text, env, false, replyMarkup)
}

const handleStatus = async (chatId: number, env: Env, ctx: DurableObjectState<DOProps>) => {
	// Build the main status message
	const responseText = await buildStatusMessage(env, ctx)

	// Build inline keyboard with action buttons
	const inlineKeyboard = [
		[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
		[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
	]

	await sendTelegramMessage(chatId, responseText, env, false, { inline_keyboard: inlineKeyboard })
}

const handleTestData = async (chatId: number, env: Env, ctx: DurableObjectState<DOProps>) => {
	try {
		// Generate fake flights
		const fakeFlights = generateFakeFlights(ctx)

		// Store fake flights using new JSON approach (replaces SQLite storage)
		storeFlights(fakeFlights, ctx)

		await sendTelegramMessage(
			chatId,
			`✅ Added ${fakeFlights.length} test flights using JSON storage.\n\n` +
				`Use /test-tracking to see flight suggestions with the test data.`,
			env
		)
	} catch (error) {
		console.error('Error adding test data:', error)
		await sendTelegramMessage(chatId, '❌ Failed to add test data. Please try again.', env)
	}
}
