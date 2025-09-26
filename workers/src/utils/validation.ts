export function isValidFlightCode(code: string): boolean {
	return /^[A-Z]{2,3}\d{1,4}$/.test(code.replace(' ', ''));
}

export async function fetchWithRetry(url: string, retries: number = 3): Promise<Response> {
	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetch(url);
			if (response.ok) return response;
		} catch (error) {
			if (i === retries - 1) throw error;
			await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
		}
	}
	throw new Error('Max retries reached');
}
