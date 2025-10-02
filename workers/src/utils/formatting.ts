import { getUserTrackedFlightsWithData } from '../services/flightData'
import { getCurrentIdtTime } from './dateTime'
import type { Env } from '../env'
import type { Flight, InlineKeyboardButton, InlineKeyboardMarkup } from '../types'

// Helper function to format time from timestamp
export const formatTimeFromTimestamp = (timestamp: number) => {
	const date = new Date(timestamp)
	return date.toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})
}

// Helper function to get day label from timestamp
export const getDayLabelFromTimestamp = (timestamp: number) => {
	const date = new Date(timestamp)
	const todayIdt = getCurrentIdtTime()
	const tomorrowIdt = new Date(todayIdt)
	tomorrowIdt.setDate(tomorrowIdt.getDate() + 1)

	// Reset time to compare dates only
	const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
	const todayOnly = new Date(todayIdt.getFullYear(), todayIdt.getMonth(), todayIdt.getDate())
	const tomorrowOnly = new Date(tomorrowIdt.getFullYear(), tomorrowIdt.getMonth(), tomorrowIdt.getDate())

	if (dateOnly.getTime() === todayOnly.getTime()) {
		return 'Today'
	} else if (dateOnly.getTime() === tomorrowOnly.getTime()) {
		return 'Tomorrow'
	} else {
		return date.toLocaleDateString('en-US', { weekday: 'long' })
	}
}

export const formatTrackingList = async (userFlights: string[], env: Env) => {
	if (userFlights.length === 0) return "You're not tracking any flights.\nUse /track LY086 to start!"

	// Use the optimized function to get flight data in a single query
	const chatId = parseInt(userFlights[0].split('_')[0]) // Extract chat ID from first flight ID (this is a hack, need to pass chatId properly)
	// Actually, let's modify the function signature to accept chatId instead of userFlights array
	return 'Function needs to be called with chatId parameter for optimization'
}

// New optimized version that takes chatId directly
export const formatTrackingListOptimized = (
	chatId: number,
	env: Env,
	ctx: DurableObjectState
): { text: string; replyMarkup: InlineKeyboardMarkup | null } => {
	const flights = getUserTrackedFlightsWithData(chatId, env, ctx)

	if (flights.length === 0)
		return {
			text: "You're not tracking any flights.\nUse /track LY086 to start!",
			replyMarkup: null,
		}

	let message = ''
	for (const flight of flights) {
		// Extract flight number from flight ID (format: "LY086_1698765432")
		const flightNum = flight.flight_number
		let formattedTime = 'TBA'
		let dayLabel = ''

		if (flight.eta) {
			formattedTime = formatTimeFromTimestamp(flight.eta)
			dayLabel = getDayLabelFromTimestamp(flight.eta)
		}

		message += `🛩️ *${escapeMarkdown(flightNum)}*\n`
		message += `Status: ${escapeMarkdown(flight.status || 'Unknown')}\n`
		message += `City: ${escapeMarkdown(flight.city || 'Unknown')}\n`
		message += `Airline: ${escapeMarkdown(flight.airline || 'Unknown')}\n`
		message += `⏱️ Arrival: ${escapeMarkdown(dayLabel ? `${dayLabel}, ${formattedTime}` : formattedTime)}\n\n`
	}

	// Create untrack buttons - 3 per row
	const inlineKeyboard: InlineKeyboardButton[][] = []
	let currentRow: InlineKeyboardButton[] = []

	flights.forEach((flight, index) => {
		currentRow.push({
			text: `❌ ${flight.flight_number}`,
			callback_data: `untrack_single:${flight.id}`,
		})

		// Start a new row after every 3 buttons
		if ((index + 1) % 3 === 0 || index === flights.length - 1) {
			inlineKeyboard.push([...currentRow])
			currentRow = []
		}
	})

	return {
		text: message,
		replyMarkup: {
			inline_keyboard: inlineKeyboard,
		},
	}
}

// Helper function to escape Markdown special characters
export const escapeMarkdown = (text: string) => {
	if (!text) return ''
	return text
		.replace(/\*/g, '\\*') // Escape asterisks
		.replace(/_/g, '\\_') // Escape underscores
		.replace(/\[/g, '\\[') // Escape opening brackets
		.replace(/\]/g, '\\]') // Escape closing brackets
		.replace(/\(/g, '\\(') // Escape opening parentheses
		.replace(/\)/g, '\\)') // Escape closing parentheses
		.replace(/`/g, '\\`') // Escape backticks
		.replace(/~/g, '\\~') // Escape tildes
}

export const formatFlightSuggestions = (flights: Flight[]) => {
	if (flights.length === 0) {
		return {
			text: 'No flights available for tracking right now (need 1+ hour until arrival).',
			replyMarkup: null,
		}
	}
	let message = '🎯 *Suggested Flights to Track:*\n\nThese flights arrive next:\n\n'
	const inlineKeyboard: InlineKeyboardButton[][] = []

	flights.forEach((flight, index) => {
		let formattedTime = 'TBA'
		let dayLabel = ''

		if (flight.eta) {
			formattedTime = formatTimeFromTimestamp(flight.eta)
			dayLabel = getDayLabelFromTimestamp(flight.eta)
		}

		message += `${index + 1}. 🛩️ *${escapeMarkdown(flight.flight_number)}*\n`
		message += `   City: ${escapeMarkdown(flight.city || 'Unknown')}\n`
		message += `   Airline: ${escapeMarkdown(flight.airline || 'Unknown')}\n`
		message += `   ⏱️ Arrival: ${escapeMarkdown(dayLabel ? `${dayLabel}, ${formattedTime}` : formattedTime)}\n\n`

		// Add individual track button for each flight
		inlineKeyboard.push([
			{
				text: `✈️ Track ${flight.flight_number}`,
				callback_data: `track_single:${flight.flight_number}`,
			},
		])
	})

	message += `Use: \`/track ${flights.map((f) => escapeMarkdown(f.flight_number)).join(' ')}\`\n`
	message += `Or track individually: \`/track LY086\``

	// Add "Track All" button at the bottom
	inlineKeyboard.push([
		{
			text: '✈️ Track All Suggested',
			callback_data: `track_suggested:${flights.map((f) => f.flight_number).join(',')}`,
		},
	])

	return {
		text: message,
		replyMarkup: {
			inline_keyboard: inlineKeyboard,
		},
	}
}
