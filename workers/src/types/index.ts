export interface D1Flight {
	id: string
	flight_number: string
	status: string
	scheduled_arrival_time: number | null
	estimated_arrival_time: number | null
	city: string | null
	airline: string | null
	created_at: number
	updated_at: number
}

export interface RawFlight {
	Airline: string
	Flight: string
	Terminal: string
	Status: string
	City: string
	Country: string | null
	StatusColor: string
	ScheduledDateTime: string
	ScheduledDate: string
	ScheduledTime: string
	UpdatedDateTime: string
	UpdatedDate: string
	UpdatedTime: string
	CurrentCultureName: string
}
