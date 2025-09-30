import { getUserTrackedFlightsWithData } from '../services/tracking'
import { getCurrentIdtTime } from './dateTime'
import type { Env } from '../env'
import type { D1Flight } from '../types'

// Helper function to format time from timestamp
function formatTimeFromTimestamp(timestamp: number): string {
	const date = new Date(timestamp)
	return date.toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})
}

// Helper function to get day label from timestamp
function getDayLabelFromTimestamp(timestamp: number): string {
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

export async function formatTrackingList(userFlights: string[], env: Env): Promise<string> {
	if (userFlights.length === 0) return "You're not tracking any flights. Use /track LY086 to start!"

	// Use the optimized function to get flight data in a single query
	const chatId = parseInt(userFlights[0].split('_')[0]) // Extract chat ID from first flight ID (this is a hack, need to pass chatId properly)
	// Actually, let's modify the function signature to accept chatId instead of userFlights array
	return 'Function needs to be called with chatId parameter for optimization'
}

// New optimized version that takes chatId directly
export async function formatTrackingListOptimized(chatId: number, env: Env, ctx: DurableObjectState): Promise<string> {
	const flights = await getUserTrackedFlightsWithData(chatId, env, ctx)

	if (flights.length === 0) return "You're not tracking any flights. Use /track LY086 to start!"

	let message = '✈️ *Your Tracked Flights:*\n\n'
	for (const flight of flights) {
		// Extract flight number from flight ID (format: "LY086_1698765432")
		const flightNum = flight.flight_number
		let formattedTime = 'TBA'
		let dayLabel = ''

		if (flight.estimated_arrival_time) {
			formattedTime = formatTimeFromTimestamp(flight.estimated_arrival_time)
			dayLabel = getDayLabelFromTimestamp(flight.estimated_arrival_time)
		}

		message += `🛩️ *${flightNum}*\n`
		message += `Status: ${flight.status || 'Unknown'}\n`
		message += `City: ${flight.city || 'Unknown'}\n`
		message += `Airline: ${flight.airline || 'Unknown'}\n`
		message += `⏱️ Arrival: ${dayLabel ? `${dayLabel}, ${formattedTime}` : formattedTime}\n\n`
	}
	return message
}

// Helper function to escape Markdown special characters
function escapeMarkdown(text: string): string {
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

export function formatFlightSuggestions(flights: D1Flight[]): { text: string; replyMarkup: any } {
	if (flights.length === 0) {
		return {
			text: 'No flights available for tracking right now (need 1+ hour until arrival).',
			replyMarkup: null,
		}
	}
	let message = '🎯 *Suggested Flights to Track:*\n\nThese flights arrive in 1+ hours:\n\n'
	flights.forEach((flight, index) => {
		let formattedTime = 'TBA'
		let dayLabel = ''

		if (flight.estimated_arrival_time) {
			formattedTime = formatTimeFromTimestamp(flight.estimated_arrival_time)
			dayLabel = getDayLabelFromTimestamp(flight.estimated_arrival_time)
		}

		message += `${index + 1}. 🛩️ *${escapeMarkdown(flight.flight_number)}*\n`
		message += `   City: ${escapeMarkdown(flight.city || 'Unknown')}\n`
		message += `   Airline: ${escapeMarkdown(flight.airline || 'Unknown')}\n`
		message += `   ⏱️ Arrival: ${dayLabel ? `${dayLabel}, ${formattedTime}` : formattedTime}\n\n`
	})
	message += `Use: \`/track ${flights.map((f) => escapeMarkdown(f.flight_number)).join(' ')}\`\n`
	message += `Or track individually: \`/track LY086\``
	return {
		text: message,
		replyMarkup: {
			inline_keyboard: [
				[
					{
						text: '✈️ Track All Suggested',
						callback_data: `track_suggested:${flights.map((f) => f.flight_number).join(',')}`,
					},
				],
			],
		},
	}
}
