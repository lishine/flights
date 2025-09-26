import { sendTelegramMessage } from '../services/telegram'
import { cleanupStaleTrackingData } from '../services/tracking'
import type { Env } from '../index'
import type { Flight } from '../types'

export async function sendFlightAlerts(currentFlights: Flight[], env: Env) {
	// Get previous flights (from 2 minutes ago)
	const prevFlightsData = await env.FLIGHT_DATA.get('prev-arrivals')
	const prevFlights = prevFlightsData ? (JSON.parse(prevFlightsData) as Record<string, Flight>) : {}

	// Create current flights map
	const currentFlightsMap = currentFlights.reduce(
		(acc, f) => ({ ...acc, [f.flightNumber]: f }),
		{} as Record<string, Flight>
	)

	// Get all tracking keys to find which flights are being tracked
	const trackingKeys = await env.FLIGHT_DATA.list({ prefix: 'tracking:' })

	for (const key of trackingKeys.keys) {
		const flightNumber = key.name.replace('tracking:', '')
		const prevFlight = prevFlights[flightNumber]
		const currentFlight = currentFlightsMap[flightNumber]

		// Only process if we have both prev and current data for this tracked flight
		if (prevFlight && currentFlight) {
			const changes = detectChanges(prevFlight, currentFlight)
			if (changes.length > 0) {
				console.log(`Flight ${flightNumber} changes detected:`)
				console.log(
					`Previous: status=${prevFlight.status}, time=${prevFlight.actualArrival}, gate=${prevFlight.gate}`
				)
				console.log(
					`Current: status=${currentFlight.status}, time=${currentFlight.actualArrival}, gate=${currentFlight.gate}`
				)
				console.log(`Changes: ${changes.join(', ')}`)

				// Get users tracking this flight
				const trackingUsers = JSON.parse((await env.FLIGHT_DATA.get(key.name)) || '[]') as string[]

				// Send alerts only to users who still have this flight in their tracking list
				let validAlerts = 0
				for (const userId of trackingUsers) {
					// Verify bidirectional tracking - check user's flight list
					const userFlights = JSON.parse(
						(await env.FLIGHT_DATA.get(`user_tracks:${userId}`)) || '[]'
					) as string[]

					if (userFlights.includes(flightNumber)) {
						await sendAlert(Number(userId), currentFlight, changes, env)
						validAlerts++
					} else {
						console.log(
							`Skipping alert for user ${userId} - flight ${flightNumber} not in their tracking list`
						)
						// Clean up stale tracking data
						await cleanupStaleTrackingData(userId, flightNumber, env)
					}
				}

				console.log(`Sent alerts to ${validAlerts}/${trackingUsers.length} users for flight ${flightNumber}`)
			}
		}
	}

	// Store current flights as prev-arrivals for next cycle (24h TTL)
	await env.FLIGHT_DATA.put('prev-arrivals', JSON.stringify(currentFlightsMap), { expirationTtl: 86400 })
}

function detectChanges(prevFlight: Flight, currentFlight: Flight): string[] {
	const changes: string[] = []
	if (prevFlight.status !== currentFlight.status) {
		changes.push(`📍 Status: ${currentFlight.status}`)
	}
	if (prevFlight.actualArrival !== currentFlight.actualArrival) {
		changes.push(`🕒 Time: ${currentFlight.actualArrival} (was ${prevFlight.actualArrival})`)
	}
	if (prevFlight.gate !== currentFlight.gate && currentFlight.gate !== 'TBA') {
		changes.push(`🚪 Gate: ${currentFlight.gate}`)
	}
	return changes
}

async function sendAlert(userId: number, flight: Flight, changes: string[], env: Env) {
	const message = `🚨 *Flight Update: ${flight.flightNumber}*\n\n${changes.join('\n')}\n\n📍 From ${
		flight.origin || 'Unknown'
	}\n`
	await sendTelegramMessage(userId, message, env, false)
}
