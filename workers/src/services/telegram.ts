import type { Env } from '../env'
import { $fetch } from 'ofetch'
import { getTelegramUrl } from '../utils/constants'
import { getCurrentIdtTime } from '../utils/dateTime'

export const sendTelegramMessage = async (
	chatId: number,
	text: string,
	env: Env,
	disableNotification: boolean = false,
	replyMarkup?: any
) => {
	try {
		const payload: any = {
			chat_id: chatId,
			text,
			parse_mode: 'Markdown',
			disable_notification: disableNotification,
			disable_web_page_preview: false,
		}
		if (replyMarkup) payload.reply_markup = replyMarkup

		console.log(`Sending Telegram message to ${chatId}, length: ${text.length}`)

		const result = (await $fetch(`${getTelegramUrl(env)}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: payload,
		})) as { ok: boolean; description?: string; error_code?: number }

		if (!result.ok) {
			console.error('Telegram API returned error:', {
				ok: result.ok,
				error_code: result.error_code,
				description: result.description,
				chatId,
				textLength: text.length,
				hasReplyMarkup: !!replyMarkup,
				textPreview: text.length > 100 ? text.substring(0, 100) + '...' : text,
			})
			throw new Error(
				`Telegram API error: ${result.description || 'Unknown error'} (code: ${result.error_code || 'N/A'})`
			)
		}
	} catch (error) {
		// Enhanced error logging with more details
		if (error instanceof Error) {
			const errorDetails: any = {
				message: error.message,
				name: error.name,
				chatId,
				textLength: text.length,
				hasReplyMarkup: !!replyMarkup,
				textPreview: text.length > 100 ? text.substring(0, 100) + '...' : text,
				timestamp: getCurrentIdtTime().toISOString(),
			}

			// Try to extract status code from fetch errors
			if ('status' in error) {
				errorDetails.status = (error as any).status
			}

			// Try to extract response text if available
			if ('data' in error) {
				errorDetails.responseData = (error as any).data
			}

			console.error('Failed to send Telegram message:', errorDetails)
		} else {
			console.error('Failed to send Telegram message (non-Error object):', {
				error,
				chatId,
				textLength: text.length,
				timestamp: getCurrentIdtTime().toISOString(),
			})
		}

		// Don't throw the error - let other commands continue to work
		// This prevents the entire command handler from failing
	}
}
