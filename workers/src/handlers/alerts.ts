import { sendTelegramMessage } from '../services/telegram'
import type { Env } from '../index'
import type { Flight } from '../types'

export async function sendFlightAlerts(currentFlights: Flight[], env: Env) {
	const prevFlights = JSON.parse((await env.FLIGHT_DATA.get('prev-arrivals')) || '{}') as Record<string, Flight>
	for (const flight of currentFlights) {
		const prevFlight = prevFlights[flight.flightNumber]
		if (prevFlight) {
			const changes = detectChanges(prevFlight, flight)
			if (changes.length > 0) {
				const trackingUsers = JSON.parse(
					(await env.FLIGHT_DATA.get(`tracking:${flight.flightNumber}`)) || '[]'
				) as string[]
				for (const userId of trackingUsers) {
					await sendAlert(Number(userId), flight, changes, env)
				}
			}
		}
	}
	await env.FLIGHT_DATA.put(
		'prev-arrivals',
		JSON.stringify(currentFlights.reduce((acc, f) => ({ ...acc, [f.flightNumber]: f }), {})),
		{
			expirationTtl: 86400,
		}
	)
}

function detectChanges(prevFlight: Flight, currentFlight: Flight): string[] {
	const changes: string[] = []
	if (prevFlight.status !== currentFlight.status) changes.push(`📍 Status: ${currentFlight.status}`)
	if (prevFlight.actualArrival !== currentFlight.actualArrival)
		changes.push(`🕒 Time: ${currentFlight.actualArrival} (was ${prevFlight.actualArrival})`)
	if (prevFlight.gate !== currentFlight.gate && currentFlight.gate !== 'TBA')
		changes.push(`🚪 Gate: ${currentFlight.gate}`)
	return changes
}

async function sendAlert(userId: number, flight: Flight, changes: string[], env: Env) {
	const message = `🚨 *Flight Update: ${flight.flightNumber}*\n\n${changes.join('\n')}\n\n📍 From ${
		flight.origin || 'Unknown'
	}\n📊 [Track Live](https://www.flightradar24.com/data/flights/${flight.flightNumber.toLowerCase()})`
	await sendTelegramMessage(userId, message, env, false)
}
