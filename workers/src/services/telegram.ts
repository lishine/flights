import { Bot } from 'grammy'
import { getCurrentIdtTimeNoCache } from '../utils/dateTime'

// Create a shared bot instance for sending messages
let botInstance: Bot | null = null

export const getBotInstance = (token: string) => {
	if (!botInstance) {
		botInstance = new Bot(token)
	}
	return botInstance
}

export const sendTelegramMessage = async (
	chatId: number,
	text: string,
	env: Env,
	disableNotification: boolean = false,
	replyMarkup?: any
) => {
	try {
		const bot = getBotInstance(env.BOT_TOKEN)

		console.log(`Sending Telegram message to ${chatId}, length: ${text.length}`)

		await bot.api.sendMessage(chatId, text, {
			parse_mode: 'Markdown',
			disable_notification: disableNotification,
			reply_markup: replyMarkup,
		})
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
				timestamp: getCurrentIdtTimeNoCache().toISOString(),
			}

			console.error('Failed to send Telegram message:', errorDetails)
		} else {
			console.error('Failed to send Telegram message (non-Error object):', {
				error,
				chatId,
				textLength: text.length,
				timestamp: getCurrentIdtTimeNoCache().toISOString(),
			})
		}
	}
}

export const sendAdmin = async (
	message: string,
	env: Env,
	ctx: { props: { debug: boolean } },
	type: 'debug' | 'deploy' | 'log' = 'debug'
) => {
	if (type === 'deploy') {
		await sendTelegramMessage(parseInt(env.ADMIN_CHAT_ID), message, env, false)
		return
	}

	if (type === 'debug' && !ctx.props.debug) {
		return
	}

	await sendTelegramMessage(parseInt(env.ADMIN_CHAT_ID), message, env, false)
}
