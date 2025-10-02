export interface Env {
	BOT_TOKEN: string
	ADMIN_CHAT_ID: string
	FLIGHTS_DO: {
		getByName(name: string): {
			fetch(request: Request): Promise<Response>
			sayHello(): Promise<string>
		}
	}
}
