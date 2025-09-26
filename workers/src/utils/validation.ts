export function isValidFlightCode(code: string): boolean {
	return /^[A-Z]{2,3}\d{1,4}$/.test(code.replace(' ', ''))
}

export async function fetchVercel(url: string): Promise<Response> {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`HTTP error: ${response.status}`)
	return response
}
