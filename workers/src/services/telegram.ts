import type { Env } from '../env'
import { $fetch } from 'ofetch'
import { getTelegramUrl } from '../utils/constants'

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
		})) as { ok: boolean; description?: string }

		if (!result.ok) {
			console.error('Telegram API returned error:', result)
			throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`)
		}
	} catch (error) {
		console.error('Failed to send Telegram message:', error)
		// Don't throw the error - let other commands continue to work
		// This prevents the entire command handler from failing
	}
}
