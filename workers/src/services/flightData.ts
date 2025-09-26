import { fetchVercel } from '../utils/validation'
import { DateTime } from 'luxon'
import type { Env } from '../index'
import type { Flight } from '../types'

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

// Parse UpdatedDateTime (/Date(<timestamp>)/) as IDT DateTime
function parseArrivalTime(dateTimeString: string): DateTime | null {
	const match = dateTimeString.match(/\/Date\((\d+)\)\//)
	if (!match || !match[1]) {
		console.error(`Invalid UpdatedDateTime format: ${dateTimeString}`)
		return null
	}
	const timestamp = Number(match[1])
	const idtDt = DateTime.fromMillis(timestamp).setZone('Asia/Tel_Aviv')
	if (!idtDt.isValid) {
		console.error(`Invalid timestamp ${timestamp} from ${dateTimeString}: ${idtDt.invalidReason}`)
		return null
	}
	console.log(`Parsed ${dateTimeString} -> IDT: ${idtDt.toLocaleString(DateTime.DATETIME_MED)}`)
	return idtDt
}

// Get current time in IDT
function getCurrentIdtTime(): DateTime {
	const nowIdt = DateTime.now().setZone('Asia/Tel_Aviv')
	console.log(`Current IDT time: ${nowIdt.toLocaleString(DateTime.DATETIME_MED)}`)
	return nowIdt
}

export async function getCurrentFlights(env: Env): Promise<Flight[]> {
	const cached = await env.FLIGHT_DATA.get('latest-arrivals')
	if (!cached) {
		console.error('No cached flight data available in latest-arrivals')
		throw new Error('Flight data unavailable')
	}
	const parsed = JSON.parse(cached)
	console.log('Using cached flight data')
	return parsed.data || []
}

export async function getCurrentFlightData(flightNumber: string, env: Env): Promise<Flight | undefined> {
	const flights = await getCurrentFlights(env)
	return flights.find((f) => f.flightNumber === flightNumber)
}

export async function suggestFlightsToTrack(env: Env): Promise<Flight[]> {
	const currentFlights = await getCurrentFlights(env)
	const nowIdt = getCurrentIdtTime()
	const oneHourFromNowIdt = nowIdt.plus({ hours: 1 })
	console.log(
		`Tel Aviv now: ${nowIdt.toLocaleString(DateTime.DATETIME_MED)}, ` +
			`One hour from now: ${oneHourFromNowIdt.toLocaleString(DateTime.DATETIME_MED)}`
	)

	const eligibleFlights = currentFlights.filter((flight) => {
		const arrivalIdt = parseArrivalTime(flight.UpdatedDateTime)
		if (!arrivalIdt) {
			console.log(`Skipping flight ${flight.flightNumber} due to invalid UpdatedDateTime`)
			return false
		}
		const hoursUntilArrival = arrivalIdt.diff(nowIdt, 'hours').hours
		const isFutureFlight = hoursUntilArrival >= 1
		if (isFutureFlight) {
			console.log('~~~', { arrivalIdt, nowIdt, flight })
		}
		const isSameOrFutureDay = arrivalIdt.toFormat('yyyy-MM-dd') >= nowIdt.toFormat('yyyy-MM-dd')
		console.log(
			`Flight ${flight.flightNumber}: arrival=${arrivalIdt.toLocaleString(DateTime.DATETIME_MED)}, ` +
				`hoursUntil=${hoursUntilArrival.toFixed(1)}, isFuture=${isFutureFlight}, isSameOrFutureDay=${isSameOrFutureDay}, status=${flight.status}, ` +
				`actualArrival=${flight.actualArrival}`
		)
		return isFutureFlight && isSameOrFutureDay && flight.status !== 'LANDED' && flight.status !== 'CANCELED'
	})

	return eligibleFlights
		.sort((a, b) => {
			const arrivalA = parseArrivalTime(a.UpdatedDateTime)
			const arrivalB = parseArrivalTime(b.UpdatedDateTime)
			return (arrivalA?.toMillis() ?? 0) - (arrivalB?.toMillis() ?? 0)
		})
		.slice(0, 5)
}

export async function cleanupCompletedFlights(currentFlights: Flight[], env: Env) {
	const nowIdt = getCurrentIdtTime()
	const cutoffIdt = nowIdt.minus({ hours: 2 })
	console.log(`Cleanup: cutoff=${cutoffIdt.toLocaleString(DateTime.DATETIME_MED)}`)

	for (const flight of currentFlights) {
		const arrivalIdt = parseArrivalTime(flight.UpdatedDateTime)
		if (!arrivalIdt) continue
		if (flight.status === 'LANDED' && arrivalIdt < cutoffIdt) {
			console.log(
				`Cleaning up landed flight: ${flight.flightNumber}, arrived at ${arrivalIdt.toLocaleString(DateTime.DATETIME_MED)}`
			)
			const trackingKey = `tracking:${flight.flightNumber}`
			const trackingUsers = JSON.parse((await env.FLIGHT_DATA.get(trackingKey)) || '[]') as string[]
			await env.FLIGHT_DATA.delete(trackingKey)
			for (const userId of trackingUsers) {
				const userKey = `user_tracks:${userId}`
				const userFlights = JSON.parse((await env.FLIGHT_DATA.get(userKey)) || '[]') as string[]
				const updatedFlights = userFlights.filter((f) => f !== flight.flightNumber)
				await env.FLIGHT_DATA.put(userKey, JSON.stringify(updatedFlights), { expirationTtl: 86400 * 7 })
			}
		}
	}
}

export async function fetchLatestFlights(env: Env): Promise<Flight[]> {
	const response = await fetchVercel('https://flights-taupe.vercel.app/api/tlv-arrivals')
	const rawData = (await response.json()) as { Flights: RawFlight[] }
	console.log('Raw API data sample:', JSON.stringify(rawData.Flights.slice(0, 2), null, 2))
	return rawData.Flights.map((flight) => ({
		flightNumber: flight.Flight.replace(' ', ''),
		status: flight.Status,
		scheduledArrival: flight.ScheduledTime,
		actualArrival: flight.UpdatedTime,
		gate: 'TBA',
		origin: flight.City,
		ScheduledDateTime: flight.ScheduledDateTime,
		UpdatedDateTime: flight.UpdatedDateTime,
	}))
}
