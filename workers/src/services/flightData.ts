import { fetchVercel } from '../utils/validation'
import { DateTime } from 'luxon'
import type { Env } from '../index'
import type { D1Flight, Flight } from '../types'

interface RawFlight {
	Airline: string
	Flight: string
	Terminal: string
	Status: string
	City: string
	Country: string | null
	StatusColor: string
	ScheduledDateTime: string
	ScheduledDate: string
	ScheduledTime: string
	UpdatedDateTime: string
	UpdatedDate: string
	UpdatedTime: string
	CurrentCultureName: string
}

// Convert a timestamp (number) to an IDT DateTime object
function timestampToIdtDateTime(timestamp: number | null): DateTime | null {
	if (timestamp === null) {
		return null
	}
	const idtDt = DateTime.fromMillis(timestamp).setZone('Asia/Tel_Aviv')
	if (!idtDt.isValid) {
		console.error(`Invalid timestamp ${timestamp}: ${idtDt.invalidReason}`)
		return null
	}
	return idtDt
}

// Get current time in IDT
function getCurrentIdtTime(): DateTime {
	const nowIdt = DateTime.now().setZone('Asia/Tel_Aviv')
	console.log(`Current IDT time: ${nowIdt.toLocaleString(DateTime.DATETIME_MED)}`)
	return nowIdt
}

// Parse RawFlight's /Date(<timestamp>)/ string to a number timestamp (epoch milliseconds)
function parseRawFlightDateTime(dateTimeString: string): number | null {
	const match = dateTimeString.match(/\/Date\((\d+)\)\//)
	if (!match || !match[1]) {
		console.error(`Invalid RawFlight DateTime format: ${dateTimeString}`)
		return null
	}
	return Number(match[1])
}

export async function getCurrentFlights(env: Env): Promise<D1Flight[]> {
	const { results } = await env.DB.prepare('SELECT * FROM flights ORDER BY actual_arrival_time DESC').all<D1Flight>()
	if (!results || results.length === 0) {
		console.error('No flight data available in D1')
		throw new Error('Flight data unavailable')
	}
	console.log('Using D1 flight data')
	return results
}

export async function getCurrentFlightData(flightNumber: string, env: Env): Promise<D1Flight | undefined> {
	const { results } = await env.DB.prepare('SELECT * FROM flights WHERE flight_number = ?')
		.bind(flightNumber)
		.all<D1Flight>()
	return results?.[0]
}

export async function suggestFlightsToTrack(env: Env): Promise<D1Flight[]> {
	const currentFlights = await getCurrentFlights(env)
	const nowIdt = getCurrentIdtTime()

	const eligibleFlights = currentFlights.filter((flight) => {
		const arrivalIdt = timestampToIdtDateTime(flight.actual_arrival_time)
		if (!arrivalIdt) {
			console.log(`Skipping flight ${flight.flight_number} due to invalid actual_arrival_time`)
			return false
		}
		const hoursUntilArrival = arrivalIdt.diff(nowIdt, 'hours').hours
		const isFutureFlight = hoursUntilArrival >= 1
		const isSameOrFutureDay = arrivalIdt.toFormat('yyyy-MM-dd') >= nowIdt.toFormat('yyyy-MM-dd')
		return isFutureFlight && isSameOrFutureDay && flight.status !== 'LANDED' && flight.status !== 'CANCELED'
	})

	return eligibleFlights
		.sort((a, b) => {
			const arrivalA = timestampToIdtDateTime(a.actual_arrival_time)
			const arrivalB = timestampToIdtDateTime(b.actual_arrival_time)
			return (arrivalA?.toMillis() ?? 0) - (arrivalB?.toMillis() ?? 0)
		})
		.slice(0, 5)
}

export async function cleanupCompletedFlights(currentFlights: D1Flight[], env: Env) {
	const nowIdt = getCurrentIdtTime()
	const cutoffIdt = nowIdt.minus({ hours: 2 })
	console.log(`Cleanup: cutoff=${cutoffIdt.toLocaleString(DateTime.DATETIME_MED)}`)

	for (const flight of currentFlights) {
		const arrivalIdt = timestampToIdtDateTime(flight.actual_arrival_time)
		if (!arrivalIdt) continue
		if (flight.status === 'LANDED' && arrivalIdt < cutoffIdt) {
			console.log(
				`Cleaning up landed flight: ${flight.flight_number}, arrived at ${arrivalIdt.toLocaleString(DateTime.DATETIME_MED)}`
			)
			// Delete from D1
			await env.DB.prepare('DELETE FROM flights WHERE flight_number = ?').bind(flight.flight_number).run()
			// Also clean up tracking data (assuming tracking data is still in KV for now, or will be migrated later)
			// Clean up completed flights from subscriptions table
			await env.DB.prepare(
				"UPDATE subscriptions SET auto_cleanup_at = DATETIME(CURRENT_TIMESTAMP, '+2 hours') WHERE flight_number = ? AND auto_cleanup_at IS NULL"
			)
				.bind(flight.flight_number)
				.run()
		}
	}
}

// Export detectChanges function for use in cron.ts
export function detectChanges(prevFlight: D1Flight, currentFlight: D1Flight): string[] {
	const changes: string[] = []
	if (prevFlight.status !== currentFlight.status) {
		changes.push(`📍 Status: ${currentFlight.status}`)
	}
	if (prevFlight.actual_arrival_time !== currentFlight.actual_arrival_time) {
		const prevTime = prevFlight.actual_arrival_time
			? new Date(prevFlight.actual_arrival_time).toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
				})
			: 'TBA'
		const currentTime = currentFlight.actual_arrival_time
			? new Date(currentFlight.actual_arrival_time).toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
				})
			: 'TBA'
		changes.push(`🕒 Arrival Time: ${currentTime} (was ${prevTime})`)
	}
	if (prevFlight.city !== currentFlight.city) {
		changes.push(`🏙️ City: ${currentFlight.city || 'Unknown'}`)
	}
	if (prevFlight.airline !== currentFlight.airline) {
		changes.push(`✈️ Airline: ${currentFlight.airline || 'Unknown'}`)
	}
	return changes
}

export async function fetchLatestFlights(env: Env): Promise<D1Flight[]> {
	const response = await fetchVercel('https://flights-taupe.vercel.app/api/tlv-arrivals')
	console.log('01')
	const rawData = (await response.json()) as { Flights: RawFlight[] }
	console.log('Raw API data sample:', JSON.stringify(rawData.Flights.slice(0, 2), null, 2))

	// Initialize or update status table with metadata
	await env.DB.prepare(
		`
		INSERT INTO status (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
	`
	)
		.bind('lastUpdated', Date.now().toString())
		.run()

	await env.DB.prepare(
		`
		INSERT INTO status (key, value)
		VALUES (?, '1')
		ON CONFLICT(key) DO UPDATE SET value = CAST((CAST(value AS INTEGER) + 1) AS TEXT)
	`
	)
		.bind('updateCount')
		.run()

	await env.DB.prepare(
		`
		INSERT INTO status (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
	`
	)
		.bind('dataLength', rawData.Flights.length.toString())
		.run()

	const newFlights: D1Flight[] = rawData.Flights.map((flight) => {
		const scheduledArrivalTime = parseRawFlightDateTime(flight.ScheduledDateTime)
		const actualArrivalTime = parseRawFlightDateTime(flight.UpdatedDateTime)

		return {
			id: crypto.randomUUID(),
			flight_number: flight.Flight.replace(' ', ''),
			status: flight.Status,
			scheduled_departure_time: null, // RawFlight does not provide this
			actual_departure_time: null, // RawFlight does not provide this
			scheduled_arrival_time: scheduledArrivalTime,
			actual_arrival_time: actualArrivalTime,
			city: flight.City,
			airline: flight.Airline,
			created_at: Date.now(),
			updated_at: Date.now(),
		}
	})
	console.log('02')

	const statements = newFlights.map((flight) =>
		env.DB.prepare(
			`INSERT INTO flights (id, flight_number, status, scheduled_departure_time, actual_departure_time, scheduled_arrival_time, actual_arrival_time, city, airline, created_at, updated_at)
			          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			          ON CONFLICT(flight_number) DO UPDATE SET
			          status = EXCLUDED.status,
			          scheduled_departure_time = EXCLUDED.scheduled_departure_time,
			          actual_departure_time = EXCLUDED.actual_departure_time,
			          scheduled_arrival_time = EXCLUDED.scheduled_arrival_time,
			          actual_arrival_time = EXCLUDED.actual_arrival_time,
			          city = EXCLUDED.city,
			          airline = EXCLUDED.airline,
			          updated_at = EXCLUDED.updated_at;`
		).bind(
			flight.id,
			flight.flight_number,
			flight.status,
			flight.scheduled_departure_time,
			flight.actual_departure_time,
			flight.scheduled_arrival_time,
			flight.actual_arrival_time,
			flight.city,
			flight.airline,
			flight.created_at,
			flight.updated_at
		)
	)
	await env.DB.batch(statements)

	return newFlights
}
