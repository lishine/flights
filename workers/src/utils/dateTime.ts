import { DOProps } from '../types'

export const getCurrentIdtTime = (ctx: DurableObjectState<DOProps>) => {
	const cache = ctx.props.cache

	if (cache.idt) {
		return cache.idt
	}

	const now = new Date()
	const idt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
	cache.idt = idt

	return idt
}

export const getCurrentIdtDateString = (ctx: DurableObjectState<DOProps>) => {
	const cache = ctx.props.cache

	if (cache.idtDateString) {
		return cache.idtDateString
	}

	const now = new Date()
	cache.idtDateString = now.toLocaleString('en-US', {
		timeZone: 'Asia/Jerusalem',
		hour12: false,
	})

	return cache.idtDateString
}

export const getCurrentIdtTimeString = (ctx: DurableObjectState<DOProps>) => {
	const cache = ctx.props.cache

	if (cache.idtTimeString) {
		return cache.idtTimeString
	}

	const now = new Date()
	cache.idtTimeString = now.toLocaleTimeString('en-US', {
		timeZone: 'Asia/Jerusalem',
		hour12: false,
		hour: '2-digit',
		minute: '2-digit',
	})

	return cache.idtTimeString
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
