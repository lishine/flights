import { fetchWithRetry } from '../utils/validation';
import type { Env } from '../index';
import type { Flight } from '../types';

interface RawFlight {
	Airline: string;
	Flight: string;
	Terminal: string;
	Status: string;
	City: string;
	Country: string | null;
	StatusColor: string;
	ScheduledDateTime: string;
	ScheduledDate: string;
	ScheduledTime: string;
	UpdatedDateTime: string;
	UpdatedDate: string;
	UpdatedTime: string;
	CurrentCultureName: string;
}

// Parses /Date(<timestamp>)/ format from Vercel API, assuming Israel time
function parseArrivalTime(dateTimeString: string): number {
	const match = dateTimeString.match(/\/Date\((\d+)\)\//);
	if (!match || !match[1]) {
		console.error(`Invalid dateTimeString format: ${dateTimeString}`);
		return 0; // Fallback to epoch to avoid crashes; flights will be filtered out
	}
	return Number(match[1]);
}

// Get current time in Tel Aviv (IDT/IST)
function getTelAvivNow(): Date {
	return new Date(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tel_Aviv' }).format());
}

export async function getCurrentFlights(env: Env): Promise<Flight[]> {
	const response = await fetchWithRetry('https://flights-taupe.vercel.app/api/tlv-arrivals', 3);
	const rawData = (await response.json()) as { Flights: RawFlight[] };
	return rawData.Flights.map((flight) => ({
		flightNumber: flight.Flight.replace(' ', ''),
		status: flight.Status,
		scheduledArrival: flight.ScheduledTime,
		actualArrival: flight.UpdatedTime || flight.ScheduledTime,
		gate: 'TBA',
		origin: flight.City,
		ScheduledDateTime: flight.ScheduledDateTime,
		UpdatedDateTime: flight.UpdatedDateTime,
	}));
}

export async function getCurrentFlightData(flightNumber: string, env: Env): Promise<Flight | undefined> {
	const flights = await getCurrentFlights(env);
	return flights.find((f) => f.flightNumber === flightNumber);
}

export async function suggestFlightsToTrack(env: Env): Promise<Flight[]> {
	const currentFlights = await getCurrentFlights(env);
	const now = getTelAvivNow();
	const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

	const eligibleFlights = currentFlights.filter((flight) => {
		const arrivalTime = parseArrivalTime(flight.UpdatedDateTime || flight.ScheduledDateTime);
		if (arrivalTime === 0) return false; // Skip invalid timestamps
		return arrivalTime >= oneHourFromNow.getTime() && flight.status !== 'LANDED' && flight.status !== 'CANCELED';
	});

	return eligibleFlights
		.sort((a, b) => {
			const timeA = parseArrivalTime(a.UpdatedDateTime || a.ScheduledDateTime);
			const timeB = parseArrivalTime(b.UpdatedDateTime || b.ScheduledDateTime);
			return timeA - timeB;
		})
		.slice(0, 5);
}

export async function cleanupCompletedFlights(currentFlights: Flight[], env: Env) {
	const now = getTelAvivNow();
	const cutoffTime = now.getTime() - 2 * 60 * 60 * 1000; // 2 hours ago
	for (const flight of currentFlights) {
		const arrivalTime = parseArrivalTime(flight.UpdatedDateTime || flight.ScheduledDateTime);
		if (flight.status === 'LANDED' && arrivalTime < cutoffTime && arrivalTime !== 0) {
			const trackingKey = `tracking:${flight.flightNumber}`;
			const trackingUsers = JSON.parse((await env.FLIGHT_DATA.get(trackingKey)) || '[]') as string[];
			await env.FLIGHT_DATA.delete(trackingKey);
			for (const userId of trackingUsers) {
				const userKey = `user_tracks:${userId}`;
				const userFlights = JSON.parse((await env.FLIGHT_DATA.get(userKey)) || '[]') as string[];
				const updatedFlights = userFlights.filter((f) => f !== flight.flightNumber);
				await env.FLIGHT_DATA.put(userKey, JSON.stringify(updatedFlights), { expirationTtl: 86400 * 7 });
			}
		}
	}
}

export async function fetchLatestFlights(env: Env): Promise<Flight[]> {
	const response = await fetchWithRetry('https://flights-taupe.vercel.app/api/tlv-arrivals', 3);
	const rawData = (await response.json()) as { Flights: RawFlight[] };
	return rawData.Flights.map((flight) => ({
		flightNumber: flight.Flight.replace(' ', ''),
		status: flight.Status,
		scheduledArrival: flight.ScheduledTime,
		actualArrival: flight.UpdatedTime || flight.ScheduledTime,
		gate: 'TBA',
		origin: flight.City,
		ScheduledDateTime: flight.ScheduledDateTime,
		UpdatedDateTime: flight.UpdatedDateTime,
	}));
}
