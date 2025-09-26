import type { Env } from '../index';

export async function addFlightTracking(userId: number, flightCode: string, env: Env) {
	const trackingKey = `tracking:${flightCode}`;
	let trackingUsers = JSON.parse((await env.FLIGHT_DATA.get(trackingKey)) || '[]') as string[];
	if (!trackingUsers.includes(String(userId))) {
		trackingUsers.push(String(userId));
		await env.FLIGHT_DATA.put(trackingKey, JSON.stringify(trackingUsers), { expirationTtl: 86400 * 7 });
	}

	const userKey = `user_tracks:${userId}`;
	let userFlights = JSON.parse((await env.FLIGHT_DATA.get(userKey)) || '[]') as string[];
	if (!userFlights.includes(flightCode)) {
		userFlights.push(flightCode);
		await env.FLIGHT_DATA.put(userKey, JSON.stringify(userFlights), { expirationTtl: 86400 * 7 });
	}
}

export async function getUserTrackedFlights(userId: number, env: Env): Promise<string[]> {
	const userFlights = await env.FLIGHT_DATA.get(`user_tracks:${userId}`);
	return userFlights ? JSON.parse(userFlights) : [];
}
