import type { Env } from '../index'

export async function addFlightTracking(userId: number, flightCode: string, env: Env) {
	const trackingKey = `tracking:${flightCode}`
	let trackingUsers = JSON.parse((await env.FLIGHT_DATA.get(trackingKey)) || '[]') as string[]
	if (!trackingUsers.includes(String(userId))) {
		trackingUsers.push(String(userId))
		await env.FLIGHT_DATA.put(trackingKey, JSON.stringify(trackingUsers), { expirationTtl: 86400 * 7 })
	}

	const userKey = `user_tracks:${userId}`
	let userFlights = JSON.parse((await env.FLIGHT_DATA.get(userKey)) || '[]') as string[]
	if (!userFlights.includes(flightCode)) {
		userFlights.push(flightCode)
		await env.FLIGHT_DATA.put(userKey, JSON.stringify(userFlights), { expirationTtl: 86400 * 7 })
	}
}

export async function getUserTrackedFlights(userId: number, env: Env): Promise<string[]> {
	const userFlights = await env.FLIGHT_DATA.get(`user_tracks:${userId}`)
	return userFlights ? JSON.parse(userFlights) : []
}

export async function removeFlightTracking(userId: number, flightCode: string, env: Env) {
	// Remove user from flight's tracking list
	const trackingKey = `tracking:${flightCode}`
	const trackingUsers = JSON.parse((await env.FLIGHT_DATA.get(trackingKey)) || '[]') as string[]
	const updatedTrackingUsers = trackingUsers.filter(id => id !== String(userId))
	
	if (updatedTrackingUsers.length > 0) {
		await env.FLIGHT_DATA.put(trackingKey, JSON.stringify(updatedTrackingUsers), { expirationTtl: 86400 * 7 })
	} else {
		await env.FLIGHT_DATA.delete(trackingKey)
	}

	// Remove flight from user's tracking list
	const userKey = `user_tracks:${userId}`
	const userFlights = JSON.parse((await env.FLIGHT_DATA.get(userKey)) || '[]') as string[]
	const updatedUserFlights = userFlights.filter(f => f !== flightCode)
	
	if (updatedUserFlights.length > 0) {
		await env.FLIGHT_DATA.put(userKey, JSON.stringify(updatedUserFlights), { expirationTtl: 86400 * 7 })
	} else {
		await env.FLIGHT_DATA.delete(userKey)
	}
}

export async function cleanupStaleTrackingData(userId: string, flightNumber: string, env: Env) {
	console.log(`Cleaning up stale tracking data: user ${userId}, flight ${flightNumber}`)
	
	// Remove user from flight's tracking list
	const trackingKey = `tracking:${flightNumber}`
	const trackingUsers = JSON.parse((await env.FLIGHT_DATA.get(trackingKey)) || '[]') as string[]
	const updatedTrackingUsers = trackingUsers.filter(id => id !== userId)
	
	if (updatedTrackingUsers.length > 0) {
		await env.FLIGHT_DATA.put(trackingKey, JSON.stringify(updatedTrackingUsers), { expirationTtl: 86400 * 7 })
	} else {
		await env.FLIGHT_DATA.delete(trackingKey)
	}
	
	console.log(`Removed user ${userId} from tracking:${flightNumber}`)
}
