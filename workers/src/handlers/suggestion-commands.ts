import { getNotTrackedFlightsFromStatus } from '../services/flightData'
import { formatFlightSuggestions } from '../utils/formatting'
import type { Env } from '../env'
import type { DOProps } from '../types'

// First load of suggestions
export const handleShowSuggestions = async (chatId: number, env: Env, ctx: DurableObjectState<DOProps>) => {
	// Reset pagination cursor when showing suggestions fresh
	ctx.storage.kv.put(`pagination_cursor_${chatId}`, '0')

	const eligibleFlights = getNotTrackedFlightsFromStatus(chatId, ctx)

	const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(
		eligibleFlights.slice(0, 5),
		0,
		eligibleFlights.length,
		ctx
	)

	// Navigation buttons
	const navigationButtons = [
		[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
		[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
	]

	// Track all button
	const actionRow = [{ text: '✅ Track All Suggested', callback_data: `track_all_suggested:0` }]

	// Pagination
	const paginationRow: any[] = []
	if (eligibleFlights.length > 5) {
		paginationRow.push({ text: 'Next ➡️', callback_data: 'suggestions_page:1' })
	}

	// Combine buttons
	const allButtons = [...navigationButtons]
	allButtons.push(actionRow)

	if (paginationRow.length > 0) {
		allButtons.push(paginationRow)
	}

	allButtons.push(...(suggestionsMarkup?.inline_keyboard || []))

	// Debug info
	const debugInfo = `\n\n🐛 *Debug:* ${eligibleFlights.length} eligible flights, Next button: ${
		eligibleFlights.length > 5 ? 'YES' : 'NO'
	}`
	const responseText = `🎯 *Flight Suggestions*\n\n${text}${debugInfo}`

	const replyMarkup = {
		inline_keyboard: allButtons,
	}

	return { responseText, replyMarkup }
}

// Paginated suggestions
export const handleSuggestionsPage = async (
	chatId: number,
	page: number,
	env: Env,
	ctx: DurableObjectState<DOProps>
) => {
	const eligibleFlights = getNotTrackedFlightsFromStatus(chatId, ctx)
	const startIndex = page * 5
	const endIndex = startIndex + 5
	const pageFlights = eligibleFlights.slice(startIndex, endIndex)

	// Update cursor
	ctx.storage.kv.put(`pagination_cursor_${chatId}`, page.toString())

	const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(
		pageFlights,
		page,
		eligibleFlights.length,
		ctx
	)

	const responseText = `🎯 *Flight Suggestions*\n\n${text}`

	// Navigation
	const navigationButtons = [
		[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
		[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
	]

	// Track all button
	const actionRow = [{ text: '✅ Track All Suggested', callback_data: `track_all_suggested:${page}` }]

	// Pagination row
	const paginationRow: any[] = []
	if (page > 0) {
		paginationRow.push({ text: '⬅️ Previous', callback_data: `suggestions_page:${page - 1}` })
	}
	if (endIndex < eligibleFlights.length) {
		paginationRow.push({ text: 'Next ➡️', callback_data: `suggestions_page:${page + 1}` })
	}

	// Combine buttons
	const allButtons = [...navigationButtons]
	allButtons.push(actionRow)

	if (paginationRow.length > 0) {
		allButtons.push(paginationRow)
	}

	allButtons.push(...(suggestionsMarkup?.inline_keyboard || []))

	const replyMarkup = {
		inline_keyboard: allButtons,
	}

	return { responseText, replyMarkup }
}
