export interface Env {
	BOT_TOKEN: string
	DB: D1Database
	FLIGHTS_DO: {
		getByName(name: string): {
			fetch(request: Request): Promise<Response>
			sayHello(): Promise<string>
		}
	}
}
