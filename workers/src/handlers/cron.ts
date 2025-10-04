import {
	fetchLatestFlights,
	cleanupCompletedFlights,
	getCurrentFlights,
	storeFlights,
	detectChanges,
	writeStatusData,
	writeErrorStatus,
} from '../services/flightData'
import { initializeSchema } from '../schema'
import { sendFlightAlerts } from './alerts'
import { sendTelegramMessage, sendAdmin } from '../services/telegram'
import type { Env } from '../env'
import type { Flight, DOProps } from '../types'
import { getCurrentIdtTime } from '../utils/dateTime'

export const runScheduledJob = async (env: Env, ctx: DurableObjectState<DOProps>) => {
	const jobId = Math.random().toString(36).substring(7)

	try {
		initializeSchema(ctx)

		const currentFlights = await fetchLatestFlights(env, ctx)
		writeStatusData(ctx, currentFlights.length)

		const previousFlights = getCurrentFlights(ctx)
		storeFlights(currentFlights, ctx)

		const subscribedResult = ctx.storage.sql.exec('SELECT DISTINCT flight_id FROM subscriptions')
		const subscribedFlightIds = new Set(
			subscribedResult.toArray().map((row) => (row as { flight_id: string }).flight_id)
		)

		const previousFlightsMap = Object.fromEntries(
			previousFlights.filter((f) => subscribedFlightIds.has(f.id)).map((f) => [f.id, f])
		) as Record<string, Flight>

		const currentFlightsMap = Object.fromEntries(
			currentFlights.filter((f) => subscribedFlightIds.has(f.id)).map((f) => [f.id, f])
		) as Record<string, Flight>

		// 5. Detect changes (same logic as before)
		const changesByFlight: Record<string, { flight: Flight; changes: string[] }> = {}

		for (const flightId in previousFlightsMap) {
			const prevFlight = previousFlightsMap[flightId]
			const currentFlight = currentFlightsMap[flightId]

			if (currentFlight) {
				const changes = detectChanges(prevFlight, currentFlight, env, ctx)
				if (changes.length > 0) {
					changesByFlight[flightId] = { flight: currentFlight, changes }
				}
			}
		}

		if (Object.keys(changesByFlight).length > 0) {
			let changeMessage = `🔍 [JOB-${jobId}] Changes detected for ${Object.keys(changesByFlight).length} flights:\n`
			for (const [flightId, change] of Object.entries(changesByFlight)) {
				changeMessage += `• Flight ${flightId}: ${change.changes.join(', ')}\n`
			}
			await sendFlightAlerts(changesByFlight, env, ctx)
		}

		const lastCleanupResult = ctx.storage.sql.exec("SELECT value FROM status WHERE key = 'last_cleanup_time'")
		const lastCleanupRow = lastCleanupResult.toArray()[0] as { value: string } | undefined
		const lastCleanupTime = lastCleanupRow ? parseInt(lastCleanupRow.value) : 0
		const now = getCurrentIdtTime(ctx).getTime()
		const tenMinutes = 10 * 60 * 1000

		if (now - lastCleanupTime >= tenMinutes) {
			console.log('Running cleanup (10 minute interval)')
			cleanupCompletedFlights(env, ctx)

			ctx.storage.sql.exec(
				"INSERT INTO status (key, value) VALUES ('last_cleanup_time', ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
				now.toString()
			)
		}

		return new Response('Cron job completed')
	} catch (error) {
		writeErrorStatus(ctx, error instanceof Error ? error : 'Unknown error')
		return new Response('Cron job failed', { status: 500 })
	}
}
