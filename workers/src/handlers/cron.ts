import { fetchLatestFlights, cleanupCompletedFlights, getCurrentFlights, detectChanges } from '../services/flightData'
import { sendFlightAlerts } from './alerts'
import type { Env } from '../index'
import type { D1Flight } from '../types'

export async function runScheduledJob(env: Env, ctx: ExecutionContext): Promise<Response> {
	try {
		// Get update counter from status table
		console.log('1')
		const counterResult = await env.DB.prepare('SELECT value FROM status WHERE key = ?')
			.bind('update-counter')
			.first<{ value: string }>()
		const currentCount = Number(counterResult?.value || '0') + 1
		console.log('2')
		// Read previous flights from D1 flights table (current state before update)
		const { results: previousFlights } = await env.DB.prepare(
			'SELECT * FROM flights ORDER BY updated_at DESC'
		).all<D1Flight>()
		const previousFlightsMap = previousFlights.reduce(
			(acc, f) => ({ ...acc, [f.flight_number]: f }),
			{} as Record<string, D1Flight>
		)
		console.log('3')

		// Fetch new flights from API and update D1 flights table
		const currentFlights = await fetchLatestFlights(env)
		const currentFlightsMap = currentFlights.reduce(
			(acc, f) => ({ ...acc, [f.flight_number]: f }),
			{} as Record<string, D1Flight>
		)

		// Detect changes and prepare alerts
		const changesByFlight: Record<string, { flight: D1Flight; changes: string[] }> = {}

		// Check for changes in existing flights
		for (const flightNumber in previousFlightsMap) {
			const prevFlight = previousFlightsMap[flightNumber]
			const currentFlight = currentFlightsMap[flightNumber]

			if (currentFlight) {
				const changes = detectChanges(prevFlight, currentFlight)
				if (changes.length > 0) {
					changesByFlight[flightNumber] = { flight: currentFlight, changes }
				}
			}
		}

		// Check for new flights (not in previous but in current)
		for (const flightNumber in currentFlightsMap) {
			if (!previousFlightsMap[flightNumber]) {
				// New flight - consider all fields as changes
				const newFlight = currentFlightsMap[flightNumber]
				const changes = [
					`📍 Status: ${newFlight.status}`,
					newFlight.actual_arrival_time
						? `🕒 Arrival Time: ${new Date(newFlight.actual_arrival_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
						: '🕒 Arrival Time: TBA',
					`🏙️ City: ${newFlight.city || 'Unknown'}`,
					`✈️ Airline: ${newFlight.airline || 'Unknown'}`,
				]
				changesByFlight[flightNumber] = { flight: newFlight, changes }
			}
		}

		// Send alerts for changes
		if (Object.keys(changesByFlight).length > 0) {
			await sendFlightAlerts(changesByFlight, env)
		}

		// Update status table with counters/timestamps
		const timestamp = new Date().toISOString()
		await env.DB.prepare('INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)')
			.bind('update-counter', currentCount.toString())
			.run()
		await env.DB.prepare('INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)')
			.bind('last-write-timestamp', timestamp)
			.run()

		// Cleanup completed flights
		await cleanupCompletedFlights(currentFlights, env)

		return new Response('Cron job completed')
	} catch (error) {
		console.error('Cron job failed:', error)
		const errorTimestamp = new Date().toISOString()
		await env.DB.prepare('INSERT OR REPLACE INTO status (key, value) VALUES (?, ?)')
			.bind(
				'last-error',
				JSON.stringify({
					error: error instanceof Error ? error.message : 'Unknown error',
					timestamp: errorTimestamp,
				})
			)
			.run()
		return new Response('Cron job failed', { status: 500 })
	}
}
