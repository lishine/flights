import type { Env } from '../index';

export async function sendTelegramMessage(chatId: number, text: string, env: Env, disableNotification: boolean = false, replyMarkup?: any) {
	const payload: any = {
		chat_id: chatId,
		text,
		parse_mode: 'Markdown',
		disable_notification: disableNotification,
		disable_web_page_preview: false,
	};
	if (replyMarkup) payload.reply_markup = replyMarkup;
	await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});
}
