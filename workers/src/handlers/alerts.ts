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
		'SELECT flight_number, telegram_id FROM subscriptions WHERE auto_cleanup_at IS NULL'
	).all<{ flight_number: string; telegram_id: string }>()

	// Build tracking map from the same data
	const trackingMap: Record<string, string[]> = {} // flight -> users

	for (const row of allSubs.results) {
		// For flight alerts
		if (!trackingMap[row.flight_number]) trackingMap[row.flight_number] = []
		trackingMap[row.flight_number].push(row.telegram_id)
	}

	// Process alerts for flights with changes
	for (const flightNumber in changesByFlight) {
		const subscribers = trackingMap[flightNumber]

		if (subscribers && subscribers.length > 0) {
			const flightChange = changesByFlight[flightNumber]
			console.log(`Flight ${flightNumber} changes detected:`)
			console.log(`Changes: ${flightChange.changes.join(', ')}`)

			// Send alerts to all subscribers
			let validAlerts = 0
			for (const telegram_id of subscribers) {
				await sendAlert(Number(telegram_id), flightChange.flight, flightChange.changes, env)
				validAlerts++
			}

			console.log(`Sent alerts to ${validAlerts} users for flight ${flightNumber}`)
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
	if (status.includes('landed') || status.includes('landing')) {
		console.log(`Flight ${flight.flight_number} is ${status}, running cleanup`)
		await cleanupStaleTrackingData(flight.flight_number, env)
	}
}
