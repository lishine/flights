import { Bot, Context } from 'grammy'
import { addFlightTracking, clearUserTracking, untrackFlight } from '../services/tracking'
import { getFlightIdByNumber, getNotTrackedFlights } from '../services/flightData'
import {
	formatTrackingListOptimized,
	formatFlightSuggestions,
	escapeMarkdown,
	formatTimestampForDisplay,
	formatTimeAgo,
	parseFlightNumber,
} from '../utils/formatting'
import { CRON_PERIOD_SECONDS } from '../utils/constants'
import type { BotContext } from '../types'

const buildStatusMessage = async (ctx: BotContext) => {
	const version = (await ctx.env.METADATA.get('version')) || 'Unknown'
	const lastDeployDate = (await ctx.env.METADATA.get('last_deploy_date')) || 'Unknown'

	// Single SQL query to get all status data at once
	const statusResults = ctx.DOStore.storage.sql
		.exec(
			`
		SELECT key, value
		FROM status
		WHERE key IN ('lastUpdated', 'updateCount', 'dataLength', 'last-error')
	`
		)
		.toArray() as { key: string; value: string }[]

	// Create a map for easier access to status values
	const statusMap = new Map<string, string>()
	statusResults.forEach((row) => statusMap.set(row.key, row.value))

	// Extract values with defaults
	const lastUpdatedValue = statusMap.get('lastUpdated') || ''
	const updateCountValue = statusMap.get('updateCount') || '0'
	const dataLengthValue = statusMap.get('dataLength') || '0'
	const errorData = statusMap.get('last-error')

	// Parse numeric values safely
	const timestamp = parseInt(lastUpdatedValue) || 0
	const totalFetches = parseInt(updateCountValue) || 0
	const flightsCount = parseInt(dataLengthValue) || 0

	// Build status message
	let statusMessage = '📊 *System Status*\n\n'

	if (timestamp > 0) {
		const lastUpdate = formatTimestampForDisplay(timestamp)
		const timeAgo = formatTimeAgo(timestamp, ctx.DOStore)

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

	if (errorData) {
		try {
			const error = JSON.parse(errorData)
			const errorTime = new Date(error.timestamp).toLocaleString()
			statusMessage += `\n\n⚠️ Last error: ${escapeMarkdown(errorTime)}`
		} catch (e) {
			// Fallback if error data is malformed
			statusMessage += `\n\n⚠️ Last error: Unable to parse error data`
		}
	}

	return statusMessage + `\n\n_⏱️ Data refreshes every ${CRON_PERIOD_SECONDS} seconds_`
}

export const setupBotHandlers = (bot: Bot<BotContext>) => {
	bot.command('track', async (ctx) => {
		await handleTrack(ctx)
	})

	bot.command('clear_tracked', async (ctx) => {
		await handleClearTracked(ctx)
	})

	bot.command('status', async (ctx) => {
		await handleStatus(ctx)
	})

	bot.command('untrack', async (ctx) => {})

	bot.callbackQuery('get_status', async (ctx) => {
		const responseText = await buildStatusMessage(ctx)
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
		const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(
			ctx.validChatId,
			ctx.DOStore
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
		const eligibleFlights = getNotTrackedFlights(ctx.validChatId, ctx.DOStore)

		const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(
			eligibleFlights.slice(0, 5),
			0,
			eligibleFlights.length,
			ctx.DOStore
		)

		const navigationButtons = [[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }]]
		const paginationRow =
			eligibleFlights.length > 5 ? [{ text: 'Next ➡️', callback_data: 'suggestions_page:1' }] : []

		const allButtons = [...navigationButtons]
		if (paginationRow.length > 0) allButtons.push(paginationRow)
		allButtons.push(...(suggestionsMarkup?.inline_keyboard || []))

		const responseText = `🎯 *Flight Suggestions*\n\n${text}`

		await ctx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: { inline_keyboard: allButtons },
		})
		await ctx.answerCallbackQuery('🔄 Refreshing...')
	})

	bot.callbackQuery(/^suggestions_page:(\d+)$/, async (ctx) => {
		const page = parseInt(ctx.match[1])
		const eligibleFlights = getNotTrackedFlights(ctx.validChatId, ctx.DOStore)
		const startIndex = page * 5
		const endIndex = startIndex + 5
		const pageFlights = eligibleFlights.slice(startIndex, endIndex)

		const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(
			pageFlights,
			page,
			eligibleFlights.length,
			ctx.DOStore
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

	bot.callbackQuery(/^track_suggested:(\d+):(.+)$/, async (ctx) => {
		const currentPage = parseInt(ctx.match[1])
		const flightIds = ctx.match[2].split(',')
		const results = []
		for (const flightId of flightIds) {
			const flightNumber = parseFlightNumber(flightId)
			addFlightTracking(ctx.validChatId, flightId, ctx.DOStore)
			results.push(`✓ Now tracking ${flightNumber.toUpperCase()}`)
		}

		await ctx.answerCallbackQuery('Tracking flights...')

		const nextPage = currentPage + 1

		const eligibleFlights = getNotTrackedFlights(ctx.validChatId, ctx.DOStore)
		const startIndex = nextPage * 5
		const endIndex = startIndex + 5
		const pageFlights = eligibleFlights.slice(startIndex, endIndex)

		const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(
			pageFlights,
			nextPage,
			eligibleFlights.length,
			ctx.DOStore
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

	bot.callbackQuery(/^track_single:(.+)$/, async (ctx) => {
		const flightNumber = ctx.match[1]
		await handleTrackSingle(ctx, flightNumber)
	})

	bot.callbackQuery(/^untrack_single:(.+)$/, async (ctx) => {
		const flightId = ctx.match[1]
		await handleUntrack(ctx, flightId)

		const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(
			ctx.validChatId,
			ctx.DOStore
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
		const clearedCount = clearUserTracking(ctx.validChatId, ctx.DOStore)

		const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(
			ctx.validChatId,
			ctx.DOStore
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

	bot.on('message:text', async (ctx) => {
		const text = ctx.message?.text || ''

		// Handle checkbox button trigger
		if (text.trim() === 'c') {
			await handleCheckboxCommand(ctx)
			return
		}

		const version = (await ctx.env.METADATA.get('version')) || 'Unknown'
		const lastDeployDate = (await ctx.env.METADATA.get('last_deploy_date')) || 'Unknown'
		await ctx.reply(`Unknown command.\n📦 Version: ${version}\n📦 Code updated: ${lastDeployDate}`, {
			parse_mode: 'Markdown',
		})
	})

	bot.callbackQuery(/^toggle_checkbox:(\d+):(true|false)$/, async (ctx) => {
		await handleCheckboxToggle(ctx)
	})

	bot.callbackQuery(/.*/, async (ctx) => {
		if (!ctx.callbackQuery.message) {
			await ctx.answerCallbackQuery({ text: 'This message is too old to interact with', show_alert: true })
			return
		}
		await ctx.answerCallbackQuery({ text: 'Unsupported callback type', show_alert: true })
	})
}

const handleTrack = async (ctx: BotContext) => {
	const text = ctx.message?.text || ''
	const flightCodes = text.split(' ').slice(1)
	const results = []
	for (const code of flightCodes) {
		const flightId = getFlightIdByNumber(code.toUpperCase().replace(' ', ''), ctx.DOStore)
		if (flightId) {
			addFlightTracking(ctx.validChatId, flightId, ctx.DOStore)
			results.push(`✓ Now tracking ${code.toUpperCase()}`)
		} else {
			results.push(`❌ Flight not found: ${code}`)
		}
	}
	await ctx.sendTelegramMessage(results.join('\n'))
}

const handleTrackSingle = async (ctx: BotContext, flightNumber: string) => {
	const code = flightNumber.toUpperCase().replace(' ', '')
	let result = ''
	const flightId = getFlightIdByNumber(code, ctx.DOStore)
	if (flightId) {
		addFlightTracking(ctx.validChatId, flightId, ctx.DOStore)
		result = `✓ Now tracking ${code}`
	} else {
		result = `❌ Flight not found: ${code}`
	}
	await ctx.sendTelegramMessage(result)
}

const handleUntrack = async (ctx: BotContext, flightId: string) => {
	untrackFlight(ctx.validChatId, flightId, ctx.DOStore)
}

const handleClearTracked = async (ctx: BotContext) => {
	const clearedCount = clearUserTracking(ctx.validChatId, ctx.DOStore)
	const message =
		clearedCount > 0
			? `✅ Cleared ${clearedCount} tracked flight${clearedCount > 1 ? 's' : ''} from your subscriptions.`
			: 'ℹ️ You had no tracked flights to clear.'
	await ctx.sendTelegramMessage(message)
}

const handleStatus = async (ctx: BotContext) => {
	const responseText = await buildStatusMessage(ctx)

	const inlineKeyboard = [
		[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
		[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
	]

	await ctx.sendTelegramMessage(responseText, {
		disableNotification: false,
		replyMarkup: { inline_keyboard: inlineKeyboard },
	})
}

const handleCheckboxCommand = async (ctx: BotContext) => {
	// Start with first checkbox selected (default)
	const selectedCheckbox = 0

	// Create 4 checkbox buttons with radio button behavior
	const checkboxes = []
	for (let i = 0; i < 4; i++) {
		const isSelected = i === selectedCheckbox
		const checkboxText = isSelected ? '☑️' : '☐'
		checkboxes.push({
			text: `${checkboxText} Option ${i + 1}`,
			callback_data: `toggle_checkbox:${i}:${isSelected}`,
		})
	}

	const replyMarkup = {
		inline_keyboard: [checkboxes],
	}

	await ctx.reply('🔘 *Checkbox Demo*\n\nSelect one option below (only one can be selected):', {
		parse_mode: 'Markdown',
		reply_markup: replyMarkup,
	})
}

const handleCheckboxToggle = async (ctx: BotContext) => {
	// Get checkbox index and current state from callback data
	const checkboxIndex = parseInt(ctx.match![1])
	const currentStateStr = ctx.match![2]
	const currentState = currentStateStr === 'true'

	// If clicking the same checkbox that's already selected, just answer the callback
	if (currentState) {
		await ctx.answerCallbackQuery(`Option ${checkboxIndex + 1} is already selected!`)
		return
	}

	// For radio button behavior, we always select the clicked checkbox
	const selectedCheckbox = checkboxIndex

	// Create 4 checkbox buttons with updated states
	const checkboxes = []
	for (let i = 0; i < 4; i++) {
		const isSelected = i === selectedCheckbox
		const checkboxText = isSelected ? '☑️' : '☐'
		checkboxes.push({
			text: `${checkboxText} Option ${i + 1}`,
			callback_data: `toggle_checkbox:${i}:${isSelected}`,
		})
	}

	const replyMarkup = {
		inline_keyboard: [checkboxes],
	}

	// Send state change notification
	const stateMessage = `✅ Option ${selectedCheckbox + 1} is now selected!`

	try {
		await ctx.editMessageText(
			`🔘 *Checkbox Demo*\n\n${stateMessage}\n\nSelect one option below (only one can be selected):`,
			{
				parse_mode: 'Markdown',
				reply_markup: replyMarkup,
			}
		)
	} catch (error) {
		// Handle the case where the message content hasn't changed
		// This can happen if there's a race condition or duplicate clicks
		console.error('Error editing message:', error)
	}

	await ctx.answerCallbackQuery(stateMessage)
}
