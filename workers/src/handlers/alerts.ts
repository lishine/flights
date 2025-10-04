import { sendTelegramMessage } from '../services/telegram'
import type { Env } from '../env'
import type { Flight, DOProps } from '../types'

export const sendFlightAlerts = async (
	changesByFlight: Record<string, { flight: Flight; changes: string[] }>,
	env: Env,
	ctx: DurableObjectState<DOProps>
) => {
	const alertId = Math.random().toString(36).substring(7)
	
	const subsResult = ctx.storage.sql.exec(
		'SELECT flight_id, telegram_id FROM subscriptions'
	)
	const allSubs = subsResult.toArray() as { flight_id: string; telegram_id: string }[]
	
	// Check for duplicate subscriptions
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
		const subs = allSubs.filter(s => s.flight_id === flightId)
		if (subs.length !== subscribers.size) {
			duplicateCount += subs.length - subscribers.size
			duplicates.push(flightId)
		}
	}
	
	await sendTelegramMessage(
		parseInt(env.ADMIN_CHAT_ID),
		`🚨 [ALERT-${alertId}] Starting to send flight alerts for ${Object.keys(changesByFlight).length} flights\nFound ${allSubs.length} total subscriptions${duplicateCount > 0 ? ` (${duplicateCount} duplicates for flights: ${duplicates.join(', ')})` : ''}`,
		env,
		false
	)

	const trackingMap: Record<string, string[]> = {} // flight_id -> users

	for (const row of allSubs) {
		if (!trackingMap[row.flight_id]) trackingMap[row.flight_id] = []
		trackingMap[row.flight_id].push(row.telegram_id)
	}

	for (const flightId in changesByFlight) {
		const flightChange = changesByFlight[flightId]
		const subscribers = trackingMap[flightChange.flight.id]

		if (subscribers && subscribers.length > 0) {
			await sendTelegramMessage(
				parseInt(env.ADMIN_CHAT_ID),
				`🚨 [ALERT-${alertId}] Flight ${flightChange.flight.flight_number} (${flightId}) changes:\n${flightChange.changes.join(', ')}\nSubscribers: ${subscribers.join(', ')}`,
				env,
				false
			)

			// Send alerts to all subscribers
			for (const telegram_id of subscribers) {
				await sendAlert(Number(telegram_id), flightChange.flight, flightChange.changes, env)
				await sendTelegramMessage(
					parseInt(env.ADMIN_CHAT_ID),
					`📤 [ALERT-${alertId}] Sent alert to user ${telegram_id} for flight ${flightChange.flight.flight_number}`,
					env,
					false
				)
			}
		} else {
			await sendTelegramMessage(
				parseInt(env.ADMIN_CHAT_ID),
				`⚠️ [ALERT-${alertId}] No subscribers found for flight ${flightChange.flight.flight_number} (${flightId})`,
				env,
				false
			)
		}
	}
	
	await sendTelegramMessage(parseInt(env.ADMIN_CHAT_ID), `✅ [ALERT-${alertId}] Alert sending completed`, env, false)
}

const sendAlert = async (userId: number, flight: Flight, changes: string[], env: Env) => {
	const message = `🚨 *Flight Update: ${flight.flight_number}*\n\n${changes.join('\n')}\n\nCity: ${
		flight.city || 'Unknown'
	}\nAirline: ${flight.airline || 'Unknown'}`
	await sendTelegramMessage(userId, message, env, false)

	// Cleanup is now handled by cron every 10 minutes
}
