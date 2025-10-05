declare global {
	interface Env {
		BOT_TOKEN: string
		ADMIN_CHAT_ID: string
		METADATA: KVNamespace
		DB: D1Database
		FLIGHTS_DO: {
			getByName(name: string): {
				fetch(request: Request): Promise<Response>
				sayHello(): Promise<string>
			}
		}
	}
}

export {}
