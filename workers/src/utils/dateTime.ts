// Cache for current Israel time (per request)
let cachedIsraelTime: Date | null = null

// Get current time in Israel timezone (handles DST automatically)
export const getCurrentIdtTime = () => {
	// Return cached time if available (same request)
	if (cachedIsraelTime) {
		return cachedIsraelTime
	}

	// Use native JavaScript to get current time in Israel timezone (handles DST automatically)
	const now = new Date()
	const israelTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}))
	cachedIsraelTime = israelTime

	return cachedIsraelTime
}