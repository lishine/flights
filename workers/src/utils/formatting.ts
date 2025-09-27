import { DateTime } from 'luxon'
import { getCurrentFlightData } from '../services/flightData'
import type { Env } from '../index'
import type { D1Flight } from '../types'

export async function formatTrackingList(userFlights: string[], env: Env): Promise<string> {
	if (userFlights.length === 0) return "You're not tracking any flights. Use /track LY086 to start!"
	let message = '✈️ *Your Tracked Flights:*\n\n'
	for (const flightNum of userFlights) {
		const flight = await getCurrentFlightData(flightNum, env)
		let formattedTime = 'TBA'
		let dayLabel = ''

		if (flight?.actual_arrival_time) {
			const arrivalIdt = DateTime.fromMillis(flight.actual_arrival_time).setZone('Asia/Tel_Aviv')
			const nowIdt = DateTime.now().setZone('Asia/Tel_Aviv')
			const dayDiff = Math.round(arrivalIdt.diff(nowIdt, 'days').days)

			formattedTime = arrivalIdt.toLocaleString(DateTime.TIME_24_SIMPLE)
			dayLabel =
				dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : arrivalIdt.toLocaleString({ weekday: 'long' })
		}

		message += `🛫 *${flightNum}*\n\n`
			message += `📍 Status: ${flight?.status || 'Unknown'}\n\n`
			message += `🏙️ City: ${flight?.city || 'Unknown'}\n\n`
			message += `✈️ Airline: ${flight?.airline || 'Unknown'}\n\n`
			message += `🕒 Arrival: ${dayLabel ? `${dayLabel}, ${formattedTime}` : formattedTime}\n\n`
	}
	return message
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

		if (flight.actual_arrival_time) {
			const arrivalIdt = DateTime.fromMillis(flight.actual_arrival_time).setZone('Asia/Tel_Aviv')
			const dayDiff = Math.round(arrivalIdt.diff(nowIdt, 'days').days)

			formattedTime = arrivalIdt.toLocaleString(DateTime.TIME_24_SIMPLE)
			dayLabel =
				dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : arrivalIdt.toLocaleString({ weekday: 'long' })
		}

		message += `${index + 1}. 🛫 *${flight.flight_number}*\n\n`
			message += `   🏙️ City: ${flight.city || 'Unknown'}\n\n`
			message += `   ✈️ Airline: ${flight.airline || 'Unknown'}\n\n`
			message += `   🕒 Arrival: ${dayLabel ? `${dayLabel}, ${formattedTime}` : formattedTime}\n\n`
	})
	message += `Use: \`/track ${flights.map((f) => f.flight_number).join(' ')}\`\n`
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
