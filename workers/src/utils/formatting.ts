import { DateTime } from 'luxon'
import { getCurrentFlightData } from '../services/flightData'
import type { Env } from '../index'
import type { D1Flight } from '../types'

export async function formatTrackingList(userFlights: string[], env: Env): Promise<string> {
	if (userFlights.length === 0) return "You're not tracking any flights. Use /track LY086 to start!"
	let message = '✈️ *Your Tracked Flights:*\n\n'
	for (const flightId of userFlights) {
		// Extract flight number from flight ID (format: "LY086_1698765432")
		const flightNum = flightId.split('_')[0]
		const flight = await getCurrentFlightData(flightNum, env)
		let formattedTime = 'TBA'
		let dayLabel = ''

		if (flight?.estimated_arrival_time) {
			const arrivalIdt = DateTime.fromMillis(flight.estimated_arrival_time).setZone('Asia/Tel_Aviv')
			const nowIdt = DateTime.now().setZone('Asia/Tel_Aviv')
			const dayDiff = Math.round(arrivalIdt.diff(nowIdt, 'days').days)

			formattedTime = arrivalIdt.toLocaleString(DateTime.TIME_24_SIMPLE)
			dayLabel =
				dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : arrivalIdt.toLocaleString({ weekday: 'long' })
		}

		message += `🛩️ *${flightNum}*\n`
		message += `Status: ${flight?.status || 'Unknown'}\n`
		message += `City: ${flight?.city || 'Unknown'}\n`
		message += `Airline: ${flight?.airline || 'Unknown'}\n`
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
	const nowIdt = DateTime.now().setZone('Asia/Tel_Aviv')
	let message = '🎯 *Suggested Flights to Track:*\n\nThese flights arrive in 1+ hours:\n\n'
	flights.forEach((flight, index) => {
		let formattedTime = 'TBA'
		let dayLabel = ''

		if (flight.estimated_arrival_time) {
			const arrivalIdt = DateTime.fromMillis(flight.estimated_arrival_time).setZone('Asia/Tel_Aviv')
			const dayDiff = Math.round(arrivalIdt.diff(nowIdt, 'days').days)

			formattedTime = arrivalIdt.toLocaleString(DateTime.TIME_24_SIMPLE)
			dayLabel =
				dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : arrivalIdt.toLocaleString({ weekday: 'long' })
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
