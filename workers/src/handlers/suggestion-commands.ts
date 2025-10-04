import { getNotTrackedFlightsFromStatus } from '../services/flightData'
import { formatFlightSuggestions } from '../utils/formatting'
import type { Env } from '../env'
import type { DOProps } from '../types'

export const handleShowSuggestions = async (chatId: number, env: Env, ctx: DurableObjectState<DOProps>) => {
	// Reset pagination cursor when showing suggestions fresh
	ctx.storage.kv.put(`pagination_cursor_${chatId}`, '0')

	const eligibleFlights = getNotTrackedFlightsFromStatus(chatId, ctx)

	// SEND DEBUG MESSAGE TO YOUR CHAT
	//await sendAdmin(
	//	`🐛 DEBUG INFO:\n` +
	//	`Total eligible flights: ${eligibleFlights.length}\n` +
	//`Will show Next button: ${eligibleFlights.length > 5 ? '✅ YES' : '❌ NO'}\n` +
	//`Showing flights: 1-${Math.min(5, eligibleFlights.length)}`,
	//env
	//)

	const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(
		eligibleFlights.slice(0, 5),
		0,
		eligibleFlights.length,
		ctx
	)

	// Build navigation buttons
	const navigationButtons = [
		[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
		[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
	]

	// Build pagination buttons - show Next if there are more than 5 flights
	const paginationRow = []
	if (eligibleFlights.length > 5) {
		paginationRow.push({ text: 'Next ➡️', callback_data: 'suggestions_page:1' })
	}

	// Combine all buttons: nav buttons, then pagination (if exists), then track buttons
	const allButtons = [...navigationButtons]

	if (paginationRow.length > 0) {
		allButtons.push(paginationRow)
	}

	allButtons.push(...(suggestionsMarkup?.inline_keyboard || []))

	// Add debug info to the response text
	const debugInfo = `\n\n🐛 *Debug:* ${eligibleFlights.length} eligible flights, Next button: ${eligibleFlights.length > 5 ? 'YES' : 'NO'}`
	const responseText = `🎯 *Flight Suggestions*\n\n${text}${debugInfo}`

	const replyMarkup = {
		inline_keyboard: allButtons,
	}

	return { responseText, replyMarkup }
}

export const handleSuggestionsPage = async (
	chatId: number,
	page: number,
	env: Env,
	ctx: DurableObjectState<DOProps>
) => {
	// Handle pagination
	const eligibleFlights = getNotTrackedFlightsFromStatus(chatId, ctx)
	const startIndex = page * 5
	const endIndex = startIndex + 5
	const pageFlights = eligibleFlights.slice(startIndex, endIndex)

	// Update cursor in storage
	ctx.storage.kv.put(`pagination_cursor_${chatId}`, page.toString())

	const { text, replyMarkup: suggestionsMarkup } = formatFlightSuggestions(
		pageFlights,
		page,
		eligibleFlights.length,
		ctx
	)
	const responseText = `🎯 *Flight Suggestions*\n\n${text}`

	// Build navigation buttons
	const navigationButtons = [
		[{ text: '🚨 View Tracked Flights', callback_data: 'show_tracked' }],
		[{ text: '🔄 Back to Status', callback_data: 'get_status' }],
	]

	// Build pagination buttons row
	const paginationRow = []
	if (page > 0) {
		paginationRow.push({ text: '⬅️ Previous', callback_data: `suggestions_page:${page - 1}` })
	}
	if (endIndex < eligibleFlights.length) {
		paginationRow.push({ text: 'Next ➡️', callback_data: `suggestions_page:${page + 1}` })
	}

	// Combine all buttons: nav buttons, then pagination (if exists), then track buttons
	const allButtons = [...navigationButtons]

	if (paginationRow.length > 0) {
		allButtons.push(paginationRow)
	}

	allButtons.push(...(suggestionsMarkup?.inline_keyboard || []))

	const replyMarkup = {
		inline_keyboard: allButtons,
	}

	return { responseText, replyMarkup }
}
