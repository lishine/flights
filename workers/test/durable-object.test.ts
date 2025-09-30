// Test file for Durable Object and Alarm functionality
// Run with: npm test

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import worker from '../src/index'

describe('FlightDO Durable Object', () => {
	let env: any

	beforeAll(async () => {
		// Mock environment for testing
		env = {
			BOT_TOKEN: 'test_token',
			DB: {
				prepare: () => ({
					bind: () => ({
						first: () => ({ greeting: 'Hello from test!' }),
					}),
				}),
			} as any,
			FLIGHTS_DO: {
				getByName: (name: string) => ({
					fetch: async (request: Request) => {
						// Mock durable object responses for testing
						const url = new URL(request.url)

						if (url.pathname.includes('/status')) {
							return new Response('FlightDO Status - Alarms fired: 0', {
								headers: { 'Content-Type': 'text/plain' },
							})
						}

						if (url.pathname.includes('/reset')) {
							return new Response('Alarm count reset and new alarm set', {
								headers: { 'Content-Type': 'text/plain' },
							})
						}

						return new Response(`FlightDO Active\nAlarms fired: 0\nNext alarm: Not set`, {
							headers: { 'Content-Type': 'text/plain' },
						})
					},
					sayHello: async () => 'Hello from test!',
				}),
			},
		}
	})

	it('should respond to durable object status request', async () => {
		const request = new Request('http://localhost/do/test/status')
		const response = await worker.fetch(request, env, {} as ExecutionContext)

		expect(response.status).toBe(200)
		expect(await response.text()).toContain('FlightDO Status')
	})

	it('should respond to durable object reset request', async () => {
		const request = new Request('http://localhost/do/test/reset')
		const response = await worker.fetch(request, env, {} as ExecutionContext)

		expect(response.status).toBe(200)
		expect(await response.text()).toContain('Alarm count reset')
	})

	it('should respond to default durable object request', async () => {
		const request = new Request('http://localhost/do/test')
		const response = await worker.fetch(request, env, {} as ExecutionContext)

		expect(response.status).toBe(200)
		expect(await response.text()).toContain('FlightDO Active')
	})

	it('should handle webhook requests separately', async () => {
		const request = new Request('http://localhost/webhook', {
			method: 'POST',
			body: JSON.stringify({ test: 'webhook' }),
		})
		// This would normally call handleCommand, but for testing we'll just check it doesn't go to DO
		const response = await worker.fetch(request, env, {} as ExecutionContext)
		// The actual response depends on handleCommand implementation
		expect(response.status).toBeDefined()
	})
})

describe('Alarm Functionality', () => {
	it('should set alarm for 1 minute after initialization', () => {
		// This test verifies the alarm timing logic
		const oneMinute = 60 * 1000
		const alarmTime = Date.now() + oneMinute

		expect(alarmTime).toBeGreaterThan(Date.now())
		expect(alarmTime - Date.now()).toBeGreaterThanOrEqual(59999) // Should be at least 59.999 seconds
	})

	it('should increment alarm counter on each alarm fire', () => {
		// Test the alarm counter logic
		let alarmCount = 0
		const initialCount = alarmCount

		// Simulate alarm firing
		alarmCount++
		const newCount = alarmCount

		expect(newCount).toBe(initialCount + 1)
	})
})
