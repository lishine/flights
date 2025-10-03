import {
	fetchLatestFlights,
	cleanupCompletedFlights,
	getSubscribedFlights,
	detectChanges,
	writeStatusData,
	writeErrorStatus,
	writeFlightsData,
} from '../services/flightData'
import { initializeSchema } from '../schema'
import { sendFlightAlerts } from './alerts'
import { sendTelegramMessage } from '../services/telegram'
import type { Env } from '../env'
import type { Flight } from '../types'
import { getCurrentIdtTime } from '../utils/dateTime'

export const runScheduledJob = async (env: Env, ctx: DurableObjectState) => {
	try {
		initializeSchema(ctx)

		// Fetch new data from API
		const currentFlights = await fetchLatestFlights(env, ctx)

		// JSON performance testing - 10000 iterations for measurable results
		const iterations = 10000
		let totalStringifyTime = 0
		let totalParseTime = 0
		let jsonStringified = ''

		// Test performance.now() precision
		const precisionTest1 = performance.now()
		const precisionTest2 = performance.now()
		const precisionDiff = precisionTest2 - precisionTest1

		// Run 10000 iterations of stringify
		const stringifyStart = performance.now()
		for (let i = 0; i < iterations; i++) {
			jsonStringified = JSON.stringify(currentFlights)
		}
		const stringifyEnd = performance.now()
		totalStringifyTime = stringifyEnd - stringifyStart

		// Run 10000 iterations of parse
		const parseStart = performance.now()
		for (let i = 0; i < iterations; i++) {
			JSON.parse(jsonStringified)
		}
		const parseEnd = performance.now()
		totalParseTime = parseEnd - parseStart

		const avgStringifyTime = totalStringifyTime / iterations
		const avgParseTime = totalParseTime / iterations
		const avgTotalTime = avgStringifyTime + avgParseTime

		// Send performance results to Telegram
		const performanceMessage = `🔧 *JSON Performance Test* (10k avg)

Flights count: ${currentFlights.length}
JSON size: ${Math.round(jsonStringified.length / 1024)}KB

⚡ Stringify: ${avgStringifyTime.toFixed(4)}ms avg
⚡ Parse: ${avgParseTime.toFixed(4)}ms avg
⚡ Total: ${avgTotalTime.toFixed(4)}ms avg

📊 10k totals: ${totalStringifyTime.toFixed(2)}ms + ${totalParseTime.toFixed(2)}ms
🔍 Timer precision: ${precisionDiff.toFixed(6)}ms
Time: ${new Date().toLocaleTimeString()}`

		await sendTelegramMessage(parseInt(env.ADMIN_CHAT_ID), performanceMessage, env, false)

		writeStatusData(ctx, currentFlights.length)
		// TEMPORARILY DISABLED: Stop saving currentflights to SQLite
		// writeFlightsData(currentFlights, ctx)

		// Single query to get subscribed flights with their previous state
		const result = ctx.storage.sql.exec(`
			SELECT f.* FROM flights f
			INNER JOIN subscriptions s ON f.id = s.flight_id
			ORDER BY f.eta DESC
		`)
		const previousFlights = result.toArray() as Flight[]

		console.log(`Found ${previousFlights.length} subscribed flights`)

		// Build maps for change detection
		const previousFlightsMap = Object.fromEntries(previousFlights.map((f) => [f.id, f])) as Record<string, Flight>
		const currentFlightsMap = Object.fromEntries(currentFlights.map((f) => [f.id, f])) as Record<string, Flight>

		const changesByFlight: Record<string, { flight: Flight; changes: string[] }> = {}

		for (const flightId in previousFlightsMap) {
			const prevFlight = previousFlightsMap[flightId]
			const currentFlight = currentFlightsMap[flightId]

			if (currentFlight) {
				const changes = detectChanges(prevFlight, currentFlight)
				if (changes.length > 0) {
					changesByFlight[flightId] = { flight: currentFlight, changes }
				}
			}
		}

		// Send alerts if there are changes
		if (Object.keys(changesByFlight).length > 0) {
			await sendFlightAlerts(changesByFlight, env, ctx)
		}

		// Clean up completed flights every 10 minutes
		const lastCleanupResult = ctx.storage.sql.exec("SELECT value FROM status WHERE key = 'last_cleanup_time'")
		const lastCleanupRow = lastCleanupResult.toArray()[0] as { value: string } | undefined
		const lastCleanupTime = lastCleanupRow ? parseInt(lastCleanupRow.value) : 0
		const now = getCurrentIdtTime().getTime()
		const tenMinutes = 10 * 60 * 1000

		if (now - lastCleanupTime >= tenMinutes) {
			console.log('Running cleanup (10 minute interval)')
			cleanupCompletedFlights(env, ctx)

			// Update last cleanup time
			ctx.storage.sql.exec(
				"INSERT INTO status (key, value) VALUES ('last_cleanup_time', ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
				now.toString()
			)
		}

		return new Response('Cron job completed')
	} catch (error) {
		console.error('Cron job failed:', error)
		writeErrorStatus(ctx, error instanceof Error ? error : 'Unknown error')
		return new Response('Cron job failed', { status: 500 })
	}
}
