export const isValidFlightCode = (code: string) => {
	// return /^[A-Z0-9]{2,3}\d{1,4}$/.test(code.replace(' ', ''))
	return true
}

export async function fetchVercel(url: string): Promise<Response> {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`HTTP error: ${response.status}`)
	return response
}
