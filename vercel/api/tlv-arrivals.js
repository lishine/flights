import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

// Cache browser instance globally (Vercel keeps functions warm)
let cachedBrowser = null

// Parse RawFlight's /Date(<timestamp>)/ string to Unix timestamp in milliseconds
function parseTimestamp(dateTimeString) {
	const match = dateTimeString.match(/\/Date\((\d+)\)\//)
	if (!match || !match[1]) {
		console.error(`Invalid timestamp format: ${dateTimeString}`)
		return null
	}
	return parseInt(match[1])
}

// Get current time in Israel timezone (handles DST automatically)
function getCurrentIdtTime() {
	// Create a date object for Israel timezone
	const now = new Date()
	const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
	return israelTime
}

async function getBrowser() {
	if (cachedBrowser && cachedBrowser.connected) {
		console.log('Reusing cached browser')
		return cachedBrowser
	}

	console.log('Creating new browser instance')
	const isLocal = !process.env.AWS_REGION && !process.env.VERCEL

	const executablePath = isLocal
		? process.platform === 'darwin'
			? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
			: process.platform === 'linux'
				? '/usr/bin/google-chrome'
				: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
		: await chromium.executablePath()

	// Aggressive performance optimizations
	const args = isLocal
		? [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-gpu',
				'--no-first-run',
				'--no-zygote',
				'--disable-extensions',
				'--disable-default-apps',
				'--disable-background-timer-throttling',
				'--disable-backgrounding-occluded-windows',
				'--disable-renderer-backgrounding',
			]
		: [
				...chromium.args,
				'--disable-web-security',
				'--disable-features=VizDisplayCompositor',
				'--disable-background-timer-throttling',
				'--disable-backgrounding-occluded-windows',
				'--disable-renderer-backgrounding',
				'--disable-ipc-flooding-protection',
				'--disable-hang-monitor',
				'--disable-prompt-on-repost',
				'--disable-sync',
				'--disable-translate',
				'--disable-plugins',
				'--disable-images', // Skip loading images for speed
				'--disable-javascript-harmony-shipping',
				'--disable-component-extensions-with-background-pages',
			]

	cachedBrowser = await puppeteer.launch({
		args,
		executablePath,
		headless: true,
		defaultViewport: {
			width: 1280,
			height: 720,
		},
		timeout: 10000, // Reduced timeout for launch
		pipe: true, // Use pipe instead of websocket for better performance
	})

	return cachedBrowser
}

export default async function handler(req, res) {
	let page = null

	try {
		console.log('Starting flight data fetch...')

		const browser = await getBrowser()
		page = await browser.newPage()

		// Aggressive page optimizations
		await page.setRequestInterception(true)

		// Block unnecessary resources to speed up loading
		page.on('request', (req) => {
			const resourceType = req.resourceType()
			const url = req.url()

			// Block images, fonts, stylesheets, and other non-essential resources
			if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
				req.abort()
				return
			}

			// Block analytics and tracking scripts
			if (
				url.includes('google-analytics') ||
				url.includes('googletagmanager') ||
				url.includes('facebook.net') ||
				url.includes('doubleclick') ||
				url.includes('analytics')
			) {
				req.abort()
				return
			}

			req.continue()
		})

		// Set minimal user agent
		await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')

		// Disable JavaScript except for essential functionality
		await page.evaluateOnNewDocument(() => {
			// Disable console logs
			console.log = console.warn = console.error = () => {}

			// Disable animations
			const style = document.createElement('style')
			style.textContent = `
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          animation-delay: -0.01ms !important;
          transition-duration: 0.01ms !important;
          transition-delay: -0.01ms !important;
        }
      `
			document.head?.appendChild(style)
		})

		let flightData = null
		let responseReceived = false

		// Set up response listener with timeout race
		const responsePromise = new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (!responseReceived) {
					console.log('Response timeout after 15 seconds')
					resolve(null)
				}
			}, 15000) // 15 second timeout for response

			page.on('response', async (response) => {
				try {
					const url = response.url()

					if (url.includes('FlightBoardSurface/Search')) {
						console.log(`Found target response`)
						clearTimeout(timeout)
						responseReceived = true

						const contentType = response.headers()['content-type'] || ''
						if (contentType.includes('application/json')) {
							flightData = await response.json()
							resolve(flightData)
						} else {
							resolve(null)
						}
					}
				} catch (e) {
					console.error('Response processing error:', e)
				}
			})
		})

		console.log(`Navigating to page...`)

		// Navigate with minimal wait
		await page.goto('https://www.iaa.gov.il/en/airports/ben-gurion/flight-board/?flightType=arrivals', {
			waitUntil: 'domcontentloaded', // Fastest option
			timeout: 8000, // Quick timeout
		})

		console.log(`Page loaded, waiting for API response...`)

		// Wait for the API response
		await responsePromise

		if (!flightData) {
			console.log(`No data received`)
			return res.status(500).json({
				error: 'Did not capture FlightBoardSurface/Search response',
			})
		}

		console.log(`Success!`)

		// Transform flight data to parse timestamps and return simplified format
		const nowIdt = getCurrentIdtTime()

		// Calculate time window: 1 hour before now to 12 hours after now
		const oneHourAgo = new Date(nowIdt.getTime() - 60 * 60 * 1000)
		const twelveHoursFromNow = new Date(nowIdt.getTime() + 12 * 60 * 60 * 1000)

		const transformedFlights =
			flightData.Flights?.map((flight) => {
				const scheduledArrival = parseTimestamp(flight.ScheduledDateTime)
				const estimatedArrival = parseTimestamp(flight.UpdatedDateTime)

				return {
					fln: flight.Flight.replace(' ', ''),
					status: flight.Status,
					sta: scheduledArrival,
					eta: estimatedArrival,
					city: flight.City,
					airline: flight.Airline,
				}
			})
			.filter((flight) => {
				// Filter to flights within time window: 1hr before now to 12hr after now
				if (!flight.sta) return false

				const scheduledTime = new Date(flight.sta)
				return scheduledTime >= oneHourAgo && scheduledTime <= twelveHoursFromNow
			}) || []

		res.status(200).json({
			Flights: transformedFlights,
		})
	} catch (err) {
		console.error(`Error:`, err)
		res.status(500).json({
			error: err.message,
		})
	} finally {
		// Close page but keep browser alive for next request
		if (page && !page.isClosed()) {
			try {
				await page.close()
			} catch (e) {
				console.error('Error closing page:', e)
			}
		}
	}
}

// Cleanup on process exit
process.on('exit', async () => {
	if (cachedBrowser) {
		await cachedBrowser.close()
	}
})
