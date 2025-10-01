export type Flight = {
	id: string
	flight_number: string
	status: string
	sta: number
	eta: number
	city: string
	airline: string
	created_at: number
	updated_at: number
}

export type VercelFlightResponse = {
	fln: string
	status: string
	sta: number
	eta: number
	city: string
	airline: string
}

export type VercelApiResponse = {
	Flights: VercelFlightResponse[]
}
