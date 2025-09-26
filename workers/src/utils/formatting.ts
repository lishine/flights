import { DateTime } from 'luxon'
import { getCurrentFlightData } from '../services/flightData'
import type { Env } from '../index'
import type { Flight } from '../types'

export async function formatTrackingList(userFlights: string[], env: Env): Promise<string> {
	if (userFlights.length === 0) return "You're not tracking any flights. Use /track LY086 to start!"
	let message = '✈️ *Your Tracked Flights:*\n\n'
	for (const flightNum of userFlights) {
		const flight = await getCurrentFlightData(flightNum, env)
		const frLink = `https://www.flightradar24.com/data/flights/${flightNum.toLowerCase()}`
		let formattedTime = flight?.actualArrival || 'TBA'
		let dayLabel = ''
		if (flight?.UpdatedDateTime) {
			const match = flight.UpdatedDateTime.match(/\/Date\((\d+)\)\//)
			if (match && match[1]) {
				const localTimestamp = Number(match[1])
				const IDT_OFFSET_MS = 3 * 60 * 60 * 1000 // Fixed for IDT DST
				const utcTimestamp = localTimestamp - IDT_OFFSET_MS
				const arrivalIdt = DateTime.fromMillis(utcTimestamp).setZone('Asia/Tel_Aviv')
				const nowIdt = DateTime.now().setZone('Asia/Tel_Aviv')
				const dayDiff = Math.round(arrivalIdt.diff(nowIdt, 'days').days)
				dayLabel =
					dayDiff === 0
						? 'Today'
						: dayDiff === 1
							? 'Tomorrow'
							: arrivalIdt.toLocaleString({ weekday: 'long' })
			}
		}
		message += `🛫 *${flightNum}*\n`
		message += `📍 ${flight?.status || 'Unknown'}\n`
		message += `🕒 ${dayLabel ? `${dayLabel}, ${formattedTime}` : formattedTime}\n`
		message += `🚪 Gate ${flight?.gate || 'TBA'}\n`
		message += `📍 From ${flight?.origin || 'Unknown'}\n`
		message += `📊 [Track Live](${frLink})\n\n`
	}
	return message
}

export function formatFlightSuggestions(flights: Flight[]): { text: string; replyMarkup: any } {
	if (flights.length === 0) {
		return {
			text: 'No flights available for tracking right now (need 1+ hour until arrival).',
			replyMarkup: null,
		}
	}
	const nowIdt = DateTime.now().setZone('Asia/Tel_Aviv')
	let message = '🎯 *Suggested Flights to Track:*\n\nThese flights arrive in 1+ hours:\n\n'
	flights.forEach((flight, index) => {
		const frLink = `https://www.flightradar24.com/data/flights/${flight.flightNumber.toLowerCase()}`
		let formattedTime = flight.actualArrival || 'TBA'
		let dayLabel = ''
		if (flight.UpdatedDateTime) {
			const match = flight.UpdatedDateTime.match(/\/Date\((\d+)\)\//)
			if (match && match[1]) {
				const localTimestamp = Number(match[1])
				const IDT_OFFSET_MS = 3 * 60 * 60 * 1000 // Fixed for IDT DST
				const utcTimestamp = localTimestamp - IDT_OFFSET_MS
				const arrivalIdt = DateTime.fromMillis(utcTimestamp).setZone('Asia/Tel_Aviv')
				const dayDiff = Math.round(arrivalIdt.diff(nowIdt, 'days').days)
				dayLabel =
					dayDiff === 0
						? 'Today'
						: dayDiff === 1
							? 'Tomorrow'
							: arrivalIdt.toLocaleString({ weekday: 'long' })
			}
		}
		message += `${index + 1}. 🛫 *${flight.flightNumber}*\n`
		message += `   📍 From ${flight.origin || 'Unknown'}\n`
		message += `   🕒 ${dayLabel ? `${dayLabel}, ${formattedTime}` : formattedTime}\n`
		message += `   📊 [Track Live](${frLink})\n\n`
	})
	message += `Use: \`/track ${flights.map((f) => f.flightNumber).join(' ')}\`\n`
	message += `Or track individually: \`/track LY086\``
	return {
		text: message,
		replyMarkup: {
			inline_keyboard: [
				[
					{
						text: '✈️ Track All Suggested',
						callback_data: `track_suggested:${flights.map((f) => f.flightNumber).join(',')}`,
					},
				],
			],
		},
	}
}
