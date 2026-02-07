const express = require('express');
const cors = require('cors');
const { Anthropic } = require('@anthropic-ai/sdk');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve static files from current directory

// Initialize Anthropic (Claude)
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Initialize Telegram Bot (disabled for Railway - use webhook instead)
// const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const bot = process.env.TELEGRAM_BOT_TOKEN ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false }) : null;
const OPERATOR_CHAT_ID = process.env.OPERATOR_CHAT_ID;

// Session storage (in production, use Redis or database)
const sessions = new Map();

// System prompt for Claude
const SYSTEM_PROMPT = `You are a helpful assistant for Smart Wash, a laundromat service in Ljubljana, Slovenia.

IMPORTANT: Respond in the same language as the user. If they write in Slovenian, respond in Slovenian. If in English, respond in English.

Information about Smart Wash:
- Two locations: Pralnica TC Jarše (Beblerjev trg 2) and Pralnica Galjevica (Galjevica 6a)
- Services: Washing (10kg - 6 tokens, 18kg - 8 tokens), Drying (10 min - 1 token), Disinfection (1 cycle - 2 tokens)
- Opening hours: Mon-Sat 08:00-20:00, Sun 08:00-14:00
- Modern self-service machines with multiple washing programs (Cotton, Synthetics, Mixed, Quick wash)
- Drying programs with temperature control (Low, Medium, High)

If the user asks complex questions, needs human support, or explicitly asks to talk to an operator, respond with:
"TRIGGER_OPERATOR: [brief summary of user's request]"

Be friendly, helpful, and concise.`;

// Trigger phrases for operator handoff
const TRIGGER_PHRASES = [
    'pogovoriti s človekom',
    'govoriti z operaterjem',
    'potrebujem operaterja',
    'povezati z operaterjem',
    'živ človek',
    'talk to human',
    'speak to operator',
    'need operator',
    'human support',
    'real person'
];

// Check if message should trigger operator
function shouldTriggerOperator(message) {
    const lowerMessage = message.toLowerCase();
    return TRIGGER_PHRASES.some(phrase => lowerMessage.includes(phrase));
}

// Create or get session
function getSession(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            id: sessionId,
            messages: [],
            operatorMode: false,
            createdAt: new Date()
        });
    }
    return sessions.get(sessionId);
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;

        if (!message || !sessionId) {
            return res.status(400).json({ error: 'Message and sessionId are required' });
        }

        const session = getSession(sessionId);

        // Add user message to session
        session.messages.push({
            role: 'user',
            content: message,
            timestamp: new Date()
        });

        // Check if in operator mode
        if (session.operatorMode) {
            return res.json({
                response: 'Vaše sporočilo je bilo poslano operaterju. Kmalu boste prejeli odgovor.\nYour message has been sent to the operator. You will receive a response shortly.',
                operatorMode: true
            });
        }

        // Check if should trigger operator
        if (shouldTriggerOperator(message)) {
            session.operatorMode = true;

            // Notify operator via Telegram
            const notification = `🔔 *NOVA ZAHTEVA ZA OPERATERJA / NEW OPERATOR REQUEST*\n\n` +
                `Session ID: \`${sessionId}\`\n` +
                `💬 Uporabnik / User: ${message}\n\n` +
                `_Uporabi /reply ${sessionId} [sporočilo] za odgovor_\n` +
                `_Use /reply ${sessionId} [message] to respond_`;

            if (bot && OPERATOR_CHAT_ID) {
                try {
                    await bot.sendMessage(OPERATOR_CHAT_ID, notification, { parse_mode: 'Markdown' });
                } catch (telegramError) {
                    console.error('Telegram notification failed:', telegramError.message);
                }
            }

            return res.json({
                response: 'Povezujem vas z našim operaterjem. Počakajte trenutek...\nConnecting you with our operator. Please wait a moment...',
                operatorMode: true
            });
        }

        // Get AI response from Claude
        const response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 500,
            system: SYSTEM_PROMPT,
            messages: session.messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }))
        });

        const assistantMessage = response.content[0].text;

        // Check if Claude wants to trigger operator
        if (assistantMessage.includes('TRIGGER_OPERATOR:')) {
            session.operatorMode = true;

            const summary = assistantMessage.replace('TRIGGER_OPERATOR:', '').trim();

            // Notify operator
            const notification = `🔔 *NOVA ZAHTEVA ZA OPERATERJA / NEW OPERATOR REQUEST*\n\n` +
                `Session ID: \`${sessionId}\`\n` +
                `💬 Uporabnik / User: ${message}\n` +
                `📝 Povzetek / Summary: ${summary}\n\n` +
                `_Uporabi /reply ${sessionId} [sporočilo] za odgovor_\n` +
                `_Use /reply ${sessionId} [message] to respond_`;

            if (bot && OPERATOR_CHAT_ID) {
                try {
                    await bot.sendMessage(OPERATOR_CHAT_ID, notification, { parse_mode: 'Markdown' });
                } catch (telegramError) {
                    console.error('Telegram notification failed:', telegramError.message);
                }
            }

            return res.json({
                response: 'Povezujem vas z našim operaterjem za dodatno pomoč...\nConnecting you with our operator for additional help...',
                operatorMode: true
            });
        }

        // Add assistant response to session
        session.messages.push({
            role: 'assistant',
            content: assistantMessage,
            timestamp: new Date()
        });

        res.json({
            response: assistantMessage,
            operatorMode: false
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({
            error: 'Prišlo je do napake. Prosimo, poskusite znova.\nAn error occurred. Please try again.'
        });
    }
});

// Get new messages for session (polling endpoint)
app.get('/api/messages/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const { lastMessageTime } = req.query;

    const session = sessions.get(sessionId);
    if (!session) {
        return res.json({ messages: [] });
    }

    const lastTime = lastMessageTime ? new Date(lastMessageTime) : new Date(0);
    const newMessages = session.messages
        .filter(msg => msg.timestamp > lastTime && msg.role === 'assistant')
        .map(msg => ({
            content: msg.content,
            timestamp: msg.timestamp
        }));

    res.json({ messages: newMessages });
});

// Telegram bot commands (disabled for Railway)
if (bot) {
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId,
            `👋 *Smart Wash Operator Bot*\n\n` +
            `Vaš Chat ID: \`${chatId}\`\n` +
            `Your Chat ID: \`${chatId}\`\n\n` +
            `Kopirajte ta ID v .env datoteko kot OPERATOR_CHAT_ID\n` +
            `Copy this ID to .env file as OPERATOR_CHAT_ID\n\n` +
            `*Ukazi / Commands:*\n` +
            `/sessions - Prikaži aktivne seje / Show active sessions\n` +
            `/reply [sessionId] [sporočilo] - Odgovori uporabniku / Reply to user`,
            { parse_mode: 'Markdown' }
        );
    });

    bot.onText(/\/sessions/, (msg) => {
        const chatId = msg.chat.id;

        if (chatId.toString() !== OPERATOR_CHAT_ID) {
            return bot.sendMessage(chatId, '⛔ Nimate dostopa / Access denied');
        }

        const activeSessions = Array.from(sessions.entries())
            .filter(([_, session]) => session.operatorMode)
            .map(([id, session]) => {
                const lastMessage = session.messages[session.messages.length - 1];
                return `• \`${id}\` - ${lastMessage?.content.substring(0, 50)}...`;
            });

        if (activeSessions.length === 0) {
            bot.sendMessage(chatId, '📭 Ni aktivnih sej / No active sessions');
        } else {
            bot.sendMessage(chatId,
                `*Aktivne seje / Active sessions:*\n\n${activeSessions.join('\n')}`,
                { parse_mode: 'Markdown' }
            );
        }
    });

    bot.onText(/\/reply ([a-f0-9\-]+) (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;

        if (chatId.toString() !== OPERATOR_CHAT_ID) {
            return bot.sendMessage(chatId, '⛔ Nimate dostopa / Access denied');
        }

        const sessionId = match[1];
        const message = match[2];

        const session = sessions.get(sessionId);
        if (!session) {
            return bot.sendMessage(chatId, `❌ Seja ${sessionId} ne obstaja / Session not found`);
        }

        // Add operator message to session
        session.messages.push({
            role: 'assistant',
            content: message,
            timestamp: new Date(),
            fromOperator: true
        });

        bot.sendMessage(chatId, `✅ Sporočilo poslano / Message sent to session ${sessionId}`);
    });
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', sessions: sessions.size });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Telegram bot: ${bot ? 'webhook mode' : 'disabled'}`);
    console.log(`💬 Chat API ready`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});
