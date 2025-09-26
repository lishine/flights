export interface Flight {
	flightNumber: string
	status: string
	scheduledArrival: string
	actualArrival: string
	origin: string
	ScheduledDateTime: string
	UpdatedDateTime: string
	updatedDate: string
	updatedTime: string
}

export interface D1Flight {
	id: string
	flight_number: string
	status: string
	scheduled_departure_time: number | null
	actual_departure_time: number | null
	scheduled_arrival_time: number | null
	actual_arrival_time: number | null
	city: string | null
	airline: string | null
	created_at: number
	updated_at: number
}
