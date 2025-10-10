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
import type { Flight, DOProps, BotContext } from '../types'
import { getCurrentIdtTime } from '../utils/dateTime'

export const runScheduledJob = async (ctx: BotContext) => {
	const jobId = Math.random().toString(36).substring(7)

	try {
		initializeSchema(ctx.DOStore)

		const currentFlights = await fetchLatestFlights(ctx.env, ctx.DOStore)
		writeStatusData(ctx.DOStore, currentFlights.length)

		const previousFlights = getCurrentFlights(ctx.DOStore)
		storeFlights(currentFlights, ctx.DOStore)

		const subscribedResult = ctx.DOStore.storage.sql.exec('SELECT DISTINCT flight_id FROM subscriptions')
		const subscribedFlightIds = new Set(
			subscribedResult.toArray().map((row) => (row as { flight_id: string }).flight_id)
		)

		const previousFlightsMap = Object.fromEntries(
			previousFlights.filter((f) => subscribedFlightIds.has(f.id)).map((f) => [f.id, f])
		) as Record<string, Flight>

		const currentFlightsMap = Object.fromEntries(
			currentFlights.filter((f) => subscribedFlightIds.has(f.id)).map((f) => [f.id, f])
		) as Record<string, Flight>

		const changesByFlight: Record<string, { flight: Flight; changes: string[] }> = {}

		for (const flightId in previousFlightsMap) {
			const prevFlight = previousFlightsMap[flightId]
			const currentFlight = currentFlightsMap[flightId]

			if (currentFlight) {
				const changes = detectChanges(prevFlight, currentFlight, ctx.env, ctx.DOStore)
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
			await sendFlightAlerts(changesByFlight, ctx)
		}

		const lastCleanupResult = ctx.DOStore.storage.sql.exec(
			"SELECT value FROM status WHERE key = 'last_cleanup_time'"
		)
		const lastCleanupRow = lastCleanupResult.toArray()[0] as { value: string } | undefined
		const lastCleanupTime = lastCleanupRow ? parseInt(lastCleanupRow.value) : 0
		const now = getCurrentIdtTime(ctx.DOStore).getTime()
		const tenMinutes = 3 * 60 * 1000

		if (now - lastCleanupTime >= tenMinutes) {
			console.log('Running cleanup (10 minute interval)')
			cleanupCompletedFlights(ctx.env, ctx.DOStore)

			ctx.DOStore.storage.sql.exec(
				"INSERT INTO status (key, value) VALUES ('last_cleanup_time', ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
				now.toString()
			)
		}

		return new Response('Cron job completed')
	} catch (error) {
		writeErrorStatus(ctx.DOStore, error instanceof Error ? error : 'Unknown error')
		return new Response('Cron job failed', { status: 500 })
	}
}
