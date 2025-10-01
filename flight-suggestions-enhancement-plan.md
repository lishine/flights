# Flight Suggestions Enhancement Plan

## Objective

Enhance the flight suggestions feature by:

1. Adding individual "Track" buttons for each flight in addition to the "Track All" button
2. Adding fake flight data for testing purposes

## Changes Required

### 1. Modify `formatFlightSuggestions` function in `workers/src/utils/formatting.ts`

Current implementation:

- Shows a list of flights with details
- Has a single "Track All Suggested" button at the bottom

New implementation should:

- Keep the existing flight information display
- Add an individual "Track" button for each flight
- Keep the "Track All" button at the bottom
- Structure the inline keyboard to have:
    - Individual track buttons for each flight (one per row)
    - The "Track All" button at the bottom

### 2. Update callback handler in `workers/src/handlers/commands.ts`

Current implementation:

- Handles `track_suggested:` callback data with multiple flight numbers
- Processes all flights in the callback data

New implementation should:

- Add handling for `track_single:` callback data with a single flight number
- Reuse existing tracking logic for individual flights
- Ensure proper user feedback when tracking individual flights

### 3. Add fake flight data to `getNotTrackedFlights` function in `workers/src/services/flightData.ts`

Current implementation:

- Returns actual flights from the database that the user isn't tracking

New implementation should:

- Add a temporary function to generate fake flight data for testing
- Include flights with various airlines, cities, and arrival times
- Ensure fake flights have proper structure matching the Flight interface

## Implementation Details

### formatFlightSuggestions Function Changes

```typescript
export const formatFlightSuggestions = (flights: Flight[]) => {
	if (flights.length === 0) {
		return {
			text: 'No flights available for tracking right now (need 1+ hour until arrival).',
			replyMarkup: null,
		}
	}

	let message = '🎯 *Suggested Flights to Track:*\n\nThese flights arrive in 1+ hours:\n\n'
	const inlineKeyboard: any[][] = []

	flights.forEach((flight, index) => {
		let formattedTime = 'TBA'
		let dayLabel = ''

		if (flight.eta) {
			formattedTime = formatTimeFromTimestamp(flight.eta)
			dayLabel = getDayLabelFromTimestamp(flight.eta)
		}

		message += `${index + 1}. 🛩️ *${escapeMarkdown(flight.flight_number)}*\n`
		message += `   City: ${escapeMarkdown(flight.city || 'Unknown')}\n`
		message += `   Airline: ${escapeMarkdown(flight.airline || 'Unknown')}\n`
		message += `   ⏱️ Arrival: ${dayLabel ? `${dayLabel}, ${formattedTime}` : formattedTime}\n\n`

		// Add individual track button for each flight
		inlineKeyboard.push([
			{
				text: `✈️ Track ${flight.flight_number}`,
				callback_data: `track_single:${flight.flight_number}`,
			},
		])
	})

	message += `Use: \`/track ${flights.map((f) => escapeMarkdown(f.flight_number)).join(' ')}\`\n`
	message += `Or track individually: \`/track LY086\``

	// Add "Track All" button at the bottom
	inlineKeyboard.push([
		{
			text: '✈️ Track All Suggested',
			callback_data: `track_suggested:${flights.map((f) => f.flight_number).join(',')}`,
		},
	])

	return {
		text: message,
		replyMarkup: {
			inline_keyboard: inlineKeyboard,
		},
	}
}
```

### Callback Handler Changes in commands.ts

Add a new case in the callback query handler:

```typescript
if (data.startsWith('track_single:')) {
	const flightNumber = data.split(':')[1]
	if (isValidFlightCode(flightNumber)) {
		const flightId = getFlightIdByNumber(flightNumber, ctx)
		if (flightId) {
			addFlightTracking(chatId, flightId, env, ctx)
			results.push(`✓ Now tracking ${flightNumber}`)
		} else {
			results.push(`❌ Flight not found: ${flightNumber}`)
		}
	} else {
		results.push(`❌ Invalid flight code: ${flightNumber}`)
	}
	// Handle callback response...
}
```

### Fake Flight Data Implementation

Add a temporary function to generate fake flights:

```typescript
const generateFakeFlights = (): Flight[] => {
	const now = getCurrentIdtTime()
	const futureTime = new Date(now.getTime() + 2 * 60 * 60 * 1000) // 2 hours from now

	return [
		{
			id: 'FAKE001_' + futureTime.getTime(),
			flight_number: 'LY001',
			status: 'SCHEDULED',
			sta: futureTime.getTime(),
			eta: futureTime.getTime(),
			city: 'New York',
			airline: 'EL AL Israel Airlines',
			created_at: now.getTime(),
			updated_at: now.getTime(),
		},
		{
			id: 'FAKE002_' + futureTime.getTime(),
			flight_number: 'BA456',
			status: 'SCHEDULED',
			sta: futureTime.getTime() + 30 * 60 * 1000, // 30 minutes later
			eta: futureTime.getTime() + 30 * 60 * 1000,
			city: 'London',
			airline: 'British Airways',
			created_at: now.getTime(),
			updated_at: now.getTime(),
		},
		// Add more fake flights as needed
	]
}
```

Modify `getNotTrackedFlights` to include fake data for testing:

```typescript
export const getNotTrackedFlights = (chatId: number, ctx: DurableObjectState) => {
	// For testing, include fake flights if no real flights are available
	const realFlights = ctx.storage.sql
		.exec(
			`
    SELECT f.* FROM flights f
    LEFT JOIN subscriptions s ON f.id = s.flight_id AND s.telegram_id = ? AND s.auto_cleanup_at IS NULL
    WHERE s.flight_id IS NULL
    ORDER BY f.eta ASC
  `,
			chatId
		)
		.toArray() as Flight[]

	// If no real flights, return fake flights for testing
	if (realFlights.length === 0) {
		return generateFakeFlights()
	}

	return realFlights
}
```

## Testing Plan

1. Deploy the updated code
2. Test the flight suggestions UI with fake data
3. Verify individual track buttons work correctly
4. Verify the "Track All" button still works
5. Test with real flight data when available

## Notes

- The fake flight data should be clearly marked as test data
- Consider adding a flag to enable/disable fake data for production
- Ensure the individual track buttons provide proper feedback to users
- Test the UI with different numbers of flights to ensure proper layout
