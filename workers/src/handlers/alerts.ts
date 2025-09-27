import { sendTelegramMessage } from '../services/telegram'
import { cleanupStaleTrackingData } from '../services/tracking'
import type { Env } from '../index'
import type { D1Flight } from '../types'

export async function sendFlightAlerts(
	changesByFlight: Record<string, { flight: D1Flight; changes: string[] }>,
	env: Env
) {
	// Get all subscriptions in one query
	const allSubs = await env.DB.prepare(
		'SELECT flight_id, telegram_id FROM subscriptions WHERE auto_cleanup_at IS NULL'
	).all<{ flight_id: string; telegram_id: string }>()

	// Build tracking map from the same data
	const trackingMap: Record<string, string[]> = {} // flight_id -> users

	for (const row of allSubs.results) {
		// For flight alerts
		if (!trackingMap[row.flight_id]) trackingMap[row.flight_id] = []
		trackingMap[row.flight_id].push(row.telegram_id)
	}

	// Process alerts for flights with changes
	for (const flightId in changesByFlight) {
		const flightChange = changesByFlight[flightId]
		// Find subscribers for this flight by looking up the flight_id
		const subscribers = trackingMap[flightChange.flight.id]

		if (subscribers && subscribers.length > 0) {
			console.log(`Flight ${flightChange.flight.flight_number} changes detected:`)
			console.log(`Changes: ${flightChange.changes.join(', ')}`)

			// Send alerts to all subscribers
			let validAlerts = 0
			for (const telegram_id of subscribers) {
				await sendAlert(Number(telegram_id), flightChange.flight, flightChange.changes, env)
				validAlerts++
			}

			console.log(`Sent alerts to ${validAlerts} users for flight ${flightChange.flight.flight_number}`)
		}
	}
}

async function sendAlert(userId: number, flight: D1Flight, changes: string[], env: Env) {
	const message = `🚨 *Flight Update: ${flight.flight_number}*\n\n${changes.join('\n')}\n\nCity: ${
		flight.city || 'Unknown'
	}\nAirline: ${flight.airline || 'Unknown'}`
	await sendTelegramMessage(userId, message, env, false)

	// Check if flight is landed or landing and run cleanup
	const status = flight.status?.toLowerCase() || ''
	if (status.includes('landed') || status.includes('landing') || status.includes('canceled')) {
		console.log(`Flight ${flight.flight_number} is ${status}, running cleanup`)
		await cleanupStaleTrackingData(flight.id, env)
	}
}
