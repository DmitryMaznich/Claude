/**
 * Notification utilities (Telegram)
 */
class NotificationService {
    constructor(bot, operatorChatId) {
        this.bot = bot;
        this.operatorChatId = operatorChatId;
        this.telegramMessageToSession = new Map(); // messageId -> sessionId
    }

    setSessionMap(map) {
        this.telegramMessageToSession = map;
    }

    isConfigured() {
        return this.bot && this.operatorChatId;
    }

    async notifyOperatorRequest(session, translatedMessage, historyMessages = null) {
        if (!this.isConfigured()) return;

        const clientInfo = session.userName || `Customer${session.customerNumber}`;
        const historyPart = historyMessages ? `📝 История разговора:\n${historyMessages}\n\n` : '';

        const notification = `🔔 *ЗАПРОС ОПЕРАТОРА*\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `👤 ${clientInfo} (${session.language || 'Slovenian'}):\n\n` +
            `"${translatedMessage}"\n\n` +
            historyPart +
            `━━━━━━━━━━━━━━━━━\n` +
            `Session: \`${session.id}\``;

        try {
            const messageOptions = {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔄 В AI / To AI', callback_data: `close_${session.id}` },
                        { text: '🗑️ Удалить / Delete', callback_data: `delete_${session.id}` }
                    ]]
                }
            };

            // If this session already has a thread, reply to it
            if (session.telegramThreadId) {
                messageOptions.reply_to_message_id = session.telegramThreadId;
            }

            const sentMessage = await this.bot.sendMessage(this.operatorChatId, notification, messageOptions);

            // Store message ID for thread tracking (use first message as thread root)
            if (!session.telegramThreadId) {
                session.telegramThreadId = sentMessage.message_id;
            }
            this.telegramMessageToSession.set(sentMessage.message_id, session.id);
            return sentMessage;
        } catch (error) {
            console.error('Telegram notification failed:', error.message);
        }
    }

    async notifyNewMessage(session, displayMessage) {
        if (!this.isConfigured()) return;

        const clientInfo = session.userName || `Customer${session.customerNumber}`;
        const notification = `💬 *NOVO SPOROČILO*\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `👤 ${clientInfo} (${session.language || 'Slovenian'}):\n\n` +
            `"${displayMessage}"\n\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `Session: \`${session.id}\``;

        try {
            const messageOptions = {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔄 V AI / To AI', callback_data: `close_${session.id}` },
                        { text: '🗑️ Izbriši / Delete', callback_data: `delete_${session.id}` }
                    ]]
                }
            };

            if (session.telegramThreadId) {
                messageOptions.reply_to_message_id = session.telegramThreadId;
            }

            const sentMessage = await this.bot.sendMessage(this.operatorChatId, notification, messageOptions);

            if (!session.telegramThreadId) {
                session.telegramThreadId = sentMessage.message_id;
            }
            this.telegramMessageToSession.set(sentMessage.message_id, session.id);
            return sentMessage;
        } catch (error) {
            console.error('Telegram notification failed:', error.message);
        }
    }

    async notifyPhoto(session, photoPath) {
        if (!this.isConfigured()) return;

        const clientInfo = session.userName || `Customer${session.customerNumber}`;
        const notification = `📸 *ФОТО ОТ КЛИЕНТА*\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `👤 ${clientInfo} (${session.language || 'Slovenian'})\n` +
            `Session: \`${session.id}\``;

        try {
            const photoOptions = {
                caption: notification,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔄 V AI / To AI', callback_data: `close_${session.id}` },
                        { text: '🗑️ Izbriši / Delete', callback_data: `delete_${session.id}` }
                    ]]
                }
            };

            if (session.telegramThreadId) {
                photoOptions.reply_to_message_id = session.telegramThreadId;
            }

            // Note: photoPath should be absolute or valid for sendPhoto
            const sentMessage = await this.bot.sendPhoto(this.operatorChatId, photoPath, photoOptions);

            if (!session.telegramThreadId) {
                session.telegramThreadId = sentMessage.message_id;
            }
            this.telegramMessageToSession.set(sentMessage.message_id, session.id);
            return sentMessage;
        } catch (error) {
            console.error('Telegram photo send failed:', error.message);
        }
    }

    async notifyTimeout(sessionId, inactiveTimeMs) {
        if (!this.isConfigured()) return;

        try {
            await this.bot.sendMessage(this.operatorChatId,
                `⏰ *СЕССИЯ ЗАКРЫТА - НЕАКТИВНОСТЬ*\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `📝 Session ID: \`${sessionId}\`\n` +
                `⏱️ Неактивность: ${Math.floor(inactiveTimeMs / 1000 / 60)} минут\n\n` +
                `Сессия автоматически закрыта из-за отсутствия сообщений от пользователя.\n` +
                `Session automatically closed - no messages from user.`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Error notifying operator about timeout:', error.message);
        }
    }
}

module.exports = NotificationService;
