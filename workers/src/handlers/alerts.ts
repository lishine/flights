import { sendTelegramMessage } from '../services/telegram'
import type { Env } from '../env'
import type { Flight } from '../types'

export const sendFlightAlerts = async (
	changesByFlight: Record<string, { flight: Flight; changes: string[] }>,
	env: Env,
	ctx: DurableObjectState
) => {
	const subsResult = ctx.storage.sql.exec(
		'SELECT flight_id, telegram_id FROM subscriptions'
	)
	const allSubs = subsResult.toArray() as { flight_id: string; telegram_id: string }[]

	const trackingMap: Record<string, string[]> = {} // flight_id -> users

	for (const row of allSubs) {
		if (!trackingMap[row.flight_id]) trackingMap[row.flight_id] = []
		trackingMap[row.flight_id].push(row.telegram_id)
	}

	for (const flightId in changesByFlight) {
		const flightChange = changesByFlight[flightId]
		const subscribers = trackingMap[flightChange.flight.id]

		if (subscribers && subscribers.length > 0) {
			console.log(`Flight ${flightChange.flight.flight_number} changes detected:`)
			console.log(`Changes: ${flightChange.changes.join(', ')}`)

			// Send alerts to all subscribers
			for (const telegram_id of subscribers) {
				await sendAlert(Number(telegram_id), flightChange.flight, flightChange.changes, env)
			}

			console.log(`Sent alerts to ${subscribers.length} users for flight ${flightChange.flight.flight_number}`)
		}
	}
}

const sendAlert = async (userId: number, flight: Flight, changes: string[], env: Env) => {
	const message = `🚨 *Flight Update: ${flight.flight_number}*\n\n${changes.join('\n')}\n\nCity: ${
		flight.city || 'Unknown'
	}\nAirline: ${flight.airline || 'Unknown'}`
	await sendTelegramMessage(userId, message, env, false)

	// Cleanup is now handled by cron every 10 minutes
}
