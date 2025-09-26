import { fetchVercel } from '../utils/validation'
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

// Parse UpdatedDateTime (/Date(<timestamp>)/) as IDT timestamp
function parseArrivalTime(dateTimeString: string): number {
	const match = dateTimeString.match(/\/Date\((\d+)\)\//)
	if (!match || !match[1]) {
		console.error(`Invalid UpdatedDateTime format: ${dateTimeString}`)
		return 0 // Skip invalid timestamps
	}
	const timestamp = Number(match[1])
	const idtDate = new Date(timestamp)
	console.log(`Parsed ${dateTimeString} -> IDT: ${idtDate.toLocaleString('en-US', { timeZone: 'Asia/Tel_Aviv' })}`)
	return timestamp
}

// Get current UTC time
function getCurrentUtcTime(): number {
	const now = Date.now()
	console.log(`Current UTC time: ${new Date(now).toUTCString()}`)
	return now
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
	const nowUtc = getCurrentUtcTime()
	const oneHourFromNowUtc = nowUtc + 60 * 60 * 1000
	const nowIdt = new Date(nowUtc + 3 * 60 * 60 * 1000) // Convert to IDT
	console.log(
		`Tel Aviv now: ${nowIdt.toLocaleString('en-US', { timeZone: 'Asia/Tel_Aviv' })}, ` +
			`One hour from now: ${new Date(oneHourFromNowUtc + 3 * 60 * 60 * 1000).toLocaleString('en-US', { timeZone: 'Asia/Tel_Aviv' })}`
	)

	const eligibleFlights = currentFlights.filter((flight) => {
		const arrivalUtc = parseArrivalTime(flight.UpdatedDateTime)
		if (arrivalUtc === 0) {
			console.log(`Skipping flight ${flight.flightNumber} due to invalid UpdatedDateTime`)
			return false
		}
		const arrivalIdt = new Date(arrivalUtc + 3 * 60 * 60 * 1000) // Convert to IDT
		const isFutureFlight = arrivalUtc >= oneHourFromNowUtc
		const isSameOrFutureDay =
			arrivalIdt.getFullYear() === nowIdt.getFullYear() &&
			arrivalIdt.getMonth() === nowIdt.getMonth() &&
			arrivalIdt.getDate() >= nowIdt.getDate()
		console.log(
			`Flight ${flight.flightNumber}: arrival=${arrivalIdt.toLocaleString('en-US', { timeZone: 'Asia/Tel_Aviv' })}, ` +
				`isFuture=${isFutureFlight}, isSameOrFutureDay=${isSameOrFutureDay}, status=${flight.status}, ` +
				`actualArrival=${flight.actualArrival}`
		)
		return isFutureFlight && isSameOrFutureDay && flight.status !== 'LANDED' && flight.status !== 'CANCELED'
	})

	return eligibleFlights
		.sort((a, b) => {
			const timeA = parseArrivalTime(a.UpdatedDateTime)
			const timeB = parseArrivalTime(b.UpdatedDateTime)
			return timeA - timeB
		})
		.slice(0, 5)
}

export async function cleanupCompletedFlights(currentFlights: Flight[], env: Env) {
	const nowUtc = getCurrentUtcTime()
	const cutoffTimeUtc = nowUtc - 2 * 60 * 60 * 1000 // 2 hours ago
	console.log(
		`Cleanup: cutoff=${new Date(cutoffTimeUtc + 3 * 60 * 60 * 1000).toLocaleString('en-US', { timeZone: 'Asia/Tel_Aviv' })}`
	)

	for (const flight of currentFlights) {
		const arrivalUtc = parseArrivalTime(flight.UpdatedDateTime)
		if (arrivalUtc === 0) continue
		if (flight.status === 'LANDED' && arrivalUtc < cutoffTimeUtc) {
			console.log(
				`Cleaning up landed flight: ${flight.flightNumber}, arrived at ${new Date(arrivalUtc + 3 * 60 * 60 * 1000).toLocaleString('en-US', { timeZone: 'Asia/Tel_Aviv' })}`
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
