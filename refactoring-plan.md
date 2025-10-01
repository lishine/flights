# Refactoring Plan for Flight Suggestions Enhancement

## Feedback-Based Improvements

Based on the feedback, we need to make the following improvements to our implementation:

### 1. Add Proper TypeScript Types for inlineKeyboard

**Issue**: Currently using `any[][]` type for inlineKeyboard
**Solution**: Define proper TypeScript interfaces for the inline keyboard structure

```typescript
// Add to types.ts or create a new types file for UI components
interface InlineKeyboardButton {
	text: string
	callback_data: string
}

interface InlineKeyboardRow {
	buttons: InlineKeyboardButton[]
}

interface InlineKeyboardMarkup {
	inline_keyboard: InlineKeyboardButton[][]
}

// Then use these types in formatFlightSuggestions
const inlineKeyboard: InlineKeyboardButton[][] = []
```

### 2. Reuse Existing handleTrack Function

**Issue**: Duplicating tracking logic in the callback handler
**Solution**: Modify the callback handler to use the existing handleTrack function

Current approach:

- Adding a new `track_single:` handler that duplicates tracking logic

Improved approach:

- Keep the `track_single:` callback handler
- But instead of duplicating logic, extract the flight number and call handleTrack
- This ensures consistent behavior between command and callback tracking

### 3. Move Fake Flight Data to /test Command

**Issue**: Fake data is automatically used when no real flights exist
**Solution**: Create a `/test` command that explicitly populates the flights table with fake data

Current approach:

- `getNotTrackedFlights` automatically returns fake flights when no real flights exist

Improved approach:

- Remove fake data from `getNotTrackedFlights`
- Create a new `/test` command that:
    - Clears existing fake flights from the table
    - Populates the flights table with fake flight data
    - Provides feedback to the user about the test data being added
- This gives users explicit control over when to use test data

## Implementation Details

### 1. TypeScript Types Update

```typescript
// In workers/src/types/index.ts
export interface InlineKeyboardButton {
	text: string
	callback_data: string
}

export interface InlineKeyboardMarkup {
	inline_keyboard: InlineKeyboardButton[][]
}
```

### 2. Callback Handler Refactor

```typescript
// In workers/src/handlers/commands.ts
if (data.startsWith('track_single:')) {
	const flightNumber = data.split(':')[1]
	// Reuse handleTrack function by constructing a command-like text
	await handleTrack(chatId, `/track ${flightNumber}`, env, ctx)

	await ofetch(`${getTelegramUrl(env)}/answerCallbackQuery`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Tracking flight...' }),
	})

	// Don't need to edit the message since handleTrack will send a new one
	return new Response('OK')
}
```

### 3. /test Command Implementation

```typescript
// In workers/src/handlers/commands.ts
const commands: { [key: string]: () => Promise<void> } = {
	'/track': () => handleTrack(chatId, text, env, ctx),
	'/clear_tracked': () => handleClearTracked(chatId, env, ctx),
	'/status': () => handleStatus(chatId, env, ctx),
	'/test': () => handleTestData(chatId, env, ctx), // New test command
}

// New handler function
const handleTestData = async (chatId: number, env: Env, ctx: DurableObjectState) => {
	try {
		// Clear existing fake flights
		ctx.storage.sql.exec("DELETE FROM flights WHERE flight_number LIKE 'FAKE_%'")

		// Add new fake flights
		const fakeFlights = generateFakeFlights()
		for (const flight of fakeFlights) {
			ctx.storage.sql.exec(
				`INSERT INTO flights (id, flight_number, status, sta, eta, city, airline, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				flight.id,
				flight.flight_number,
				flight.status,
				flight.sta,
				flight.eta,
				flight.city,
				flight.airline,
				flight.created_at,
				flight.updated_at
			)
		}

		await sendTelegramMessage(
			chatId,
			`✅ Added ${fakeFlights.length} test flights to the database.\n\n` +
				`Use /test-tracking to see flight suggestions with the test data.`,
			env
		)
	} catch (error) {
		console.error('Error adding test data:', error)
		await sendTelegramMessage(chatId, '❌ Failed to add test data. Please try again.', env)
	}
}
```

### 4. Simplified getNotTrackedFlights

```typescript
// In workers/src/services/flightData.ts
export const getNotTrackedFlights = (chatId: number, ctx: DurableObjectState) => {
	const result = ctx.storage.sql.exec(
		`
    SELECT f.* FROM flights f
    LEFT JOIN subscriptions s ON f.id = s.flight_id AND s.telegram_id = ? AND s.auto_cleanup_at IS NULL
    WHERE s.flight_id IS NULL
    ORDER BY f.eta ASC
    `,
		chatId
	)

	return result.toArray() as Flight[]
}
```

## Benefits of These Changes

1. **Type Safety**: Proper TypeScript types improve code quality and IDE support
2. **Code Reuse**: Eliminates duplicate tracking logic, ensuring consistent behavior
3. **Explicit Control**: Users can explicitly choose when to use test data
4. **Cleaner Separation**: Real data and test data are clearly separated
5. **Better UX**: Users understand when they're interacting with test data

## Testing Plan

1. Deploy the refactored code
2. Use `/test` to populate test flights
3. Verify flight suggestions show the test data
4. Test individual track buttons
5. Verify that without running `/test`, no fake flights appear
6. Test with real flight data when available
