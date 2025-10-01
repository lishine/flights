let cachedIsraelTime: Date | null = null

export const getCurrentIdtTime = () => {
	if (cachedIsraelTime) {
		return cachedIsraelTime
	}

	const now = new Date()
	const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
	cachedIsraelTime = israelTime

	return cachedIsraelTime
}
