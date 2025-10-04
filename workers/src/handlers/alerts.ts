import { sendTelegramMessage, sendAdmin } from '../services/telegram'
import type { Env } from '../env'
import type { Flight, DOProps } from '../types'

export const sendFlightAlerts = async (
	changesByFlight: Record<string, { flight: Flight; changes: string[] }>,
	env: Env,
	ctx: DurableObjectState<DOProps>
) => {
	const subsResult = ctx.storage.sql.exec('SELECT flight_id, telegram_id FROM subscriptions')
	const allSubs = subsResult.toArray() as { flight_id: string; telegram_id: string }[]

	const subscriptionMap = new Map<string, Set<string>>()
	for (const sub of allSubs) {
		if (!subscriptionMap.has(sub.flight_id)) {
			subscriptionMap.set(sub.flight_id, new Set())
		}
		subscriptionMap.get(sub.flight_id)!.add(sub.telegram_id)
	}

	let duplicateCount = 0
	const duplicates: string[] = []
	for (const [flightId, subscribers] of subscriptionMap) {
		const subs = allSubs.filter((s) => s.flight_id === flightId)
		if (subs.length !== subscribers.size) {
			duplicateCount += subs.length - subscribers.size
			duplicates.push(flightId)
		}
	}

	const trackingMap: Record<string, string[]> = {} // flight_id -> users

	for (const row of allSubs) {
		if (!trackingMap[row.flight_id]) trackingMap[row.flight_id] = []
		trackingMap[row.flight_id].push(row.telegram_id)
	}

	for (const flightId in changesByFlight) {
		const flightChange = changesByFlight[flightId]
		const subscribers = trackingMap[flightChange.flight.id]

		if (subscribers && subscribers.length > 0) {
			for (const telegram_id of subscribers) {
				await sendAlert(Number(telegram_id), flightChange.flight, flightChange.changes, env)
			}
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
