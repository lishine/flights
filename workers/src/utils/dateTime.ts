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

export const formatTimeAgo = (timestamp: number): string => {
	if (!timestamp || timestamp === 0) {
		return '- not updated'
	}

	const now = getCurrentIdtTime().getTime()
	const diffMs = now - timestamp
	const diffMinutes = Math.floor(diffMs / 60000)

	if (diffMinutes < 1) {
		return 'just now'
	} else if (diffMinutes < 60) {
		return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`
	} else if (diffMinutes < 1440) {
		const hours = Math.floor(diffMinutes / 60)
		return `${hours} hour${hours > 1 ? 's' : ''} ago`
	} else {
		const days = Math.floor(diffMinutes / 1440)
		return `${days} day${days > 1 ? 's' : ''} ago`
	}
}

export const formatTimestampForDisplay = (timestamp: number): string => {
	if (!timestamp || timestamp === 0) {
		return '- not updated'
	}

	const date = new Date(timestamp)
	return date.toISOString().split('T')[0]
}
