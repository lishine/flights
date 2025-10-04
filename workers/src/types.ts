type Status = 'LANDED' | 'CANCELED' | 'NOT FINAL' | 'FINAL' | 'DELAYED' | (string & {})

export type Flight = {
	id: string
	flight_number: string
	status: Status
	sta: number
	eta: number
	city: string
	airline: string
	created_at: number
	updated_at: number
}

export type VercelFlightResponse = {
	fln: string
	status: Status
	sta: number
	eta: number
	city: string
	airline: string
}

export type VercelApiResponse = {
	Flights: VercelFlightResponse[]
	updated:number
}

export interface InlineKeyboardButton {
	text: string
	callback_data: string
}

export interface InlineKeyboardMarkup {
	inline_keyboard: InlineKeyboardButton[][]
}

export interface DOProps {
	cache: {
		idt?: Date
		idtDateString?: string
		idtTimeString?: string
		flights?: Flight[]
	}
	debug: boolean
}
