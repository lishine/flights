import { getUserTrackedFlights } from '../services/flightData'
import { getCurrentIdtTime } from './dateTime'
import type { Flight, InlineKeyboardButton, InlineKeyboardMarkup, DOProps } from '../types'

export const formatTimeFromTimestamp = (timestamp: number) => {
	const date = new Date(timestamp)
	return date.toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})
}
export const formatDateFromTimestamp = (timestamp: number) => {
	const date = new Date(timestamp)
	return date.toLocaleString('en-GB', {
		hour12: false,
	})
}

export const getDayLabelFromTimestamp = (timestamp: number, ctx: DurableObjectState<DOProps>) => {
	const date = new Date(timestamp)
	const todayIdt = getCurrentIdtTime(ctx)
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

export const formatTimeAgo = (timestamp: number, ctx: DurableObjectState<DOProps>): string => {
	if (!timestamp || timestamp === 0) {
		return '- not updated'
	}

	const now = getCurrentIdtTime(ctx).getTime()
	const diffMs = now - timestamp
	const diffMinutes = Math.floor(diffMs / 60000)

	if (diffMinutes < 1) {
		return 'just now'
	} else if (diffMinutes < 60) {
		return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`
	} else if (diffMinutes < 1440) {
		const hours = Math.floor(diffMinutes / 60)
		return `${hours} hour${hours > 1 ? 's' : ''} ago`
	} else {
		const days = Math.floor(diffMinutes / 1440)
		return `${days} day${days > 1 ? 's' : ''} ago`
	}
}

export const formatTimestampForDisplay = (timestamp: number): string => {
	if (!timestamp || timestamp === 0) {
		return '- not updated'
	}

	const date = new Date(timestamp)
	return date.toISOString().split('T')[0]
}

export const formatTrackingListOptimized = (
	chatId: number,
	env: Env,
	ctx: DurableObjectState<DOProps>
): { text: string; replyMarkup: InlineKeyboardMarkup | null } => {
	const flights = getUserTrackedFlights(chatId, ctx)

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
			dayLabel = getDayLabelFromTimestamp(flight.eta, ctx)
		}

		message += `🛩️ *${escapeMarkdown(flightNum)}*\n`
		message += `City: ${escapeMarkdown(flight.city || 'Unknown')}\n`
		message += `Airline: ${escapeMarkdown(flight.airline || 'Unknown')}\n`
		message += `Status: ${escapeMarkdown(flight.status || 'Unknown')}\n`
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

export const formatFlightSuggestions = (
	flights: Flight[],
	currentPage: number = 0,
	totalFlights: number = 0,
	ctx?: DurableObjectState<DOProps>
) => {
	if (flights.length === 0) {
		return {
			text: 'No flights available for tracking right now (need 1+ hour until arrival).',
			replyMarkup: null,
		}
	}

	const startFlightNumber = currentPage * 5 + 1
	const endFlightNumber = startFlightNumber + flights.length - 1

	let message = `🎯 These flights arrive next:\n\n`

	// Add page info if we have pagination
	if (totalFlights > 5) {
		message += `📄 Showing flights ${startFlightNumber}-${endFlightNumber} of ${totalFlights}\n\n`
	}

	const inlineKeyboard: InlineKeyboardButton[][] = []

	flights.forEach((flight, index) => {
		let formattedTime = 'TBA'
		let dayLabel = ''

		if (flight.eta) {
			formattedTime = formatTimeFromTimestamp(flight.eta)
			dayLabel = getDayLabelFromTimestamp(flight.eta, ctx!)
		}

		const globalIndex = startFlightNumber + index - 1
		message += `${globalIndex + 1}. 🛩️ *${escapeMarkdown(flight.flight_number)}*\n`
		message += `   City: ${escapeMarkdown(flight.city || 'Unknown')}\n`
		message += `   Airline: ${escapeMarkdown(flight.airline || 'Unknown')}\n`
		message += `   Status: ${escapeMarkdown(flight.status || 'Unknown')}\n`
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
