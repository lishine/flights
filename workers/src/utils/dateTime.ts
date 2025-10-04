import { DOProps } from '../types'

export const getCurrentIdtTime = (ctx: DurableObjectState<DOProps>) => {
	const cache = ctx.props.cache

	// if (cache.idt) {
	// 	return cache.idt
	// }

	const now = new Date()
	const idt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
	cache.idt = idt

	return idt
}

export const getCurrentIdtDateString = (ctx: DurableObjectState<DOProps>) => {
	const cache = ctx.props.cache

	// if (cache.idtDateString) {
	// 	return cache.idtDateString
	// }

	const now = new Date()
	cache.idtDateString = now.toLocaleString('en-US', {
		timeZone: 'Asia/Jerusalem',
		hour12: false,
	})

	return cache.idtDateString
}

export const getCurrentIdtTimeString = (ctx: DurableObjectState<DOProps>) => {
	const cache = ctx.props.cache

	// if (cache.idtTimeString) {
	// 	return cache.idtTimeString
	// }

	const now = new Date()
	cache.idtTimeString = now.toLocaleTimeString('en-US', {
		timeZone: 'Asia/Jerusalem',
		hour12: false,
		hour: '2-digit',
		minute: '2-digit',
	})

	return cache.idtTimeString
}

export const getIdtDateString = (n: number) => {
	return new Date(n).toLocaleString('en-US', {
		timeZone: 'Asia/Jerusalem',
		hour12: false,
	})
}

export const getIdtTimeString = (n: number) => {
	return new Date(n).toLocaleTimeString('en-US', {
		timeZone: 'Asia/Jerusalem',
		hour12: false,
		hour: '2-digit',
		minute: '2-digit',
	})
}

// Non-cached versions for use outside Durable Object context
export const getCurrentIdtTimeNoCache = () => {
	const now = new Date()
	return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
}

export const getCurrentIdtDateStringNoCache = () => {
	const now = new Date()
	return now.toLocaleString('en-US', {
		timeZone: 'Asia/Jerusalem',
		hour12: false,
	})
}

export const formatTimeAgo = (timestamp: number, ctx: DurableObjectState<DOProps>): string => {
	if (!timestamp || timestamp === 0) {
		return '- not updated'
	}

	const now = getCurrentIdtTime(ctx).getTime()
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
