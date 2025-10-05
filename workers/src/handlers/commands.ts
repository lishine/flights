import { Bot, Context } from 'grammy'
import { sendTelegramMessage, sendAdmin } from '../services/telegram'
import { addFlightTracking, clearUserTracking, untrackFlight } from '../services/tracking'
import { getFlightIdByNumber, getNotTrackedFlights } from '../services/flightData'
import {
	formatTrackingListOptimized,
	formatFlightSuggestions,
	escapeMarkdown,
	formatTimestampForDisplay,
	formatTimeAgo,
} from '../utils/formatting'
import { isValidFlightCode } from '../utils/validation'
import { CRON_PERIOD_SECONDS } from '../utils/constants'
import type { BotContext, DOProps } from '../types'

const buildStatusMessage = async (ctx: BotContext) => {
	const version = (await ctx.env.METADATA.get('version')) || 'Unknown'
	const lastDeployDate = (await ctx.env.METADATA.get('last_deploy_date')) || 'Unknown'

	const lastUpdatedResult = ctx.DOStore.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'lastUpdated')
	const updateCountResult = ctx.DOStore.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'updateCount')
	const dataLengthResult = ctx.DOStore.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'dataLength')
	const errorResult = ctx.DOStore.storage.sql.exec('SELECT value FROM status WHERE key = ?', 'last-error')

	const lastUpdated = lastUpdatedResult.toArray()[0] as { value: string } | undefined
	const updateCount = updateCountResult.toArray()[0] as { value: string } | undefined
	const dataLength = dataLengthResult.toArray()[0] as { value: string } | undefined
	const errorResultRow = errorResult.toArray()[0] as { value: string } | undefined

	const errorData = errorResultRow?.value

	let statusMessage = '📊 *System Status*\n\n'

	const timestamp = lastUpdated?.value ? parseInt(lastUpdated.value) || 0 : 0
	if (lastUpdated?.value && timestamp > 0) {
		const lastUpdate = formatTimestampForDisplay(timestamp)
		const timeAgo = formatTimeAgo(timestamp, ctx.DOStore)
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

	if (errorData) {
		const error = JSON.parse(errorData)
		const errorTime = new Date(error.timestamp).toLocaleString()
		statusMessage += `\n\n⚠️ Last error: ${escapeMarkdown(errorTime)}`
	}

	const responseText = statusMessage + `\n\n_⏱️ Data refreshes every ${CRON_PERIOD_SECONDS} seconds_`

	return responseText
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

	bot.callbackQuery('get_status', async (ctx) => {
		if (!ctx.chat) return
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
		if (!ctx.chat) return
		const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(
			ctx.chat.id,
			ctx.env,
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
		if (!ctx.chat) return
		ctx.DOStore.storage.kv.put(`pagination_cursor_${ctx.chat.id}`, '0')

		const eligibleFlights = getNotTrackedFlights(ctx.chat.id, ctx.DOStore)

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

		const debugInfo = `\n\n🐛 *Debug:* ${eligibleFlights.length} eligible flights, Next button: ${eligibleFlights.length > 5 ? 'YES' : 'NO'}`
		const responseText = `🎯 *Flight Suggestions*\n\n${text}${debugInfo}`

		await ctx.editMessageText(responseText, {
			parse_mode: 'Markdown',
			reply_markup: { inline_keyboard: allButtons },
		})
		await ctx.answerCallbackQuery('🔄 Refreshing...')
	})

	bot.callbackQuery(/^suggestions_page:(\d+)$/, async (ctx) => {
		if (!ctx.chat) return
		const page = parseInt(ctx.match[1])
		const eligibleFlights = getNotTrackedFlights(ctx.chat.id, ctx.DOStore)
		const startIndex = page * 5
		const endIndex = startIndex + 5
		const pageFlights = eligibleFlights.slice(startIndex, endIndex)

		ctx.DOStore.storage.kv.put(`pagination_cursor_${ctx.chat.id}`, page.toString())

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

	bot.callbackQuery(/^track_suggested:(.+)$/, async (ctx) => {
		if (!ctx.chat) return
		const flightCodes = ctx.match[1].split(',')
		const results = []
		for (const code of flightCodes) {
			if (isValidFlightCode(code)) {
				const flightId = getFlightIdByNumber(code.toUpperCase().replace(' ', ''), ctx.DOStore)
				if (flightId) {
					addFlightTracking(ctx.chat.id, flightId, ctx.env, ctx.DOStore)
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
		const cursorStr = ctx.DOStore.storage.kv.get<string>(cursorKey) || '0'
		const currentPage = parseInt(cursorStr) || 0
		const nextPage = currentPage + 1

		const eligibleFlights = getNotTrackedFlights(ctx.chat.id, ctx.DOStore)
		const startIndex = nextPage * 5
		const endIndex = startIndex + 5
		const pageFlights = eligibleFlights.slice(startIndex, endIndex)

		ctx.DOStore.storage.kv.put(cursorKey, nextPage.toString())

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
		if (!ctx.chat) return
		const flightNumber = ctx.match[1]
		await handleTrackSingle(ctx, flightNumber)
	})

	bot.callbackQuery(/^untrack_single:(.+)$/, async (ctx) => {
		if (!ctx.chat) return
		const flightId = ctx.match[1]
		await handleUntrack(ctx, flightId)

		const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(
			ctx.chat.id,
			ctx.env,
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
		if (!ctx.chat) return
		const clearedCount = clearUserTracking(ctx.chat.id, ctx.env, ctx.DOStore)

		const { text: trackedMessage, replyMarkup: trackedMarkup } = formatTrackingListOptimized(
			ctx.chat.id,
			ctx.env,
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
		const version = (await ctx.env.METADATA.get('version')) || 'Unknown'
		const lastDeployDate = (await ctx.env.METADATA.get('last_deploy_date')) || 'Unknown'
		await ctx.reply(`Unknown command.\n📦 Version: ${version}\n📦 Code updated: ${lastDeployDate}`, {
			parse_mode: 'Markdown',
		})
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
	if (!ctx.chat) return
	const text = ctx.message?.text || ''
	const flightCodes = text.split(' ').slice(1)
	const results = []
	for (const code of flightCodes) {
		if (isValidFlightCode(code)) {
			const flightId = getFlightIdByNumber(code.toUpperCase().replace(' ', ''), ctx.DOStore)
			if (flightId) {
				addFlightTracking(ctx.chat.id, flightId, ctx.env, ctx.DOStore)
				results.push(`✓ Now tracking ${code.toUpperCase()}`)
			} else {
				results.push(`❌ Flight not found: ${code}`)
			}
		} else {
			results.push(`❌ Invalid flight code: ${code}`)
		}
	}
	await sendTelegramMessage(ctx.chat.id, results.join('\n'), ctx.env)
}

const handleTrackSingle = async (ctx: BotContext, flightNumber: string) => {
	if (!ctx.chat) return
	const code = flightNumber.toUpperCase().replace(' ', '')
	let result = ''
	if (isValidFlightCode(code)) {
		const flightId = getFlightIdByNumber(code, ctx.DOStore)
		if (flightId) {
			addFlightTracking(ctx.chat.id, flightId, ctx.env, ctx.DOStore)
			result = `✓ Now tracking ${code}`
		} else {
			result = `❌ Flight not found: ${code}`
		}
	} else {
		result = `❌ Invalid flight code: ${code}`
	}
	await sendTelegramMessage(ctx.chat.id, result, ctx.env)
}

const handleUntrack = async (ctx: BotContext, flightId: string) => {
	if (!ctx.chat) return
	untrackFlight(ctx.chat.id, flightId, ctx.env, ctx.DOStore)
}

const handleClearTracked = async (ctx: BotContext) => {
	if (!ctx.chat) return
	const clearedCount = clearUserTracking(ctx.chat.id, ctx.env, ctx.DOStore)
	const message =
		clearedCount > 0
			? `✅ Cleared ${clearedCount} tracked flight${clearedCount > 1 ? 's' : ''} from your subscriptions.`
			: 'ℹ️ You had no tracked flights to clear.'
	await sendTelegramMessage(ctx.chat.id, message, ctx.env)
}

const handleStatus = async (ctx: BotContext) => {
	if (!ctx.chat) return
	const responseText = await buildStatusMessage(ctx)

	const inlineKeyboard = [
		[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
		[{ text: '🎯 Show Flight Suggestions', callback_data: 'show_suggestions' }],
	]

	await sendTelegramMessage(ctx.chat.id, responseText, ctx.env, false, { inline_keyboard: inlineKeyboard })
}
