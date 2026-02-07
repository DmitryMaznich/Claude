const express = require('express');
const cors = require('cors');
const { Anthropic } = require('@anthropic-ai/sdk');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve static files from current directory

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'photo-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        console.log('File upload attempt:', {
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size
        });

        // Check file extension
        const allowedExtensions = /\.(jpg|jpeg|png|webp|gif)$/i;
        const hasValidExtension = allowedExtensions.test(file.originalname);

        // Check MIME type
        const allowedMimetypes = /^image\/(jpeg|png|webp|gif)/;
        const hasValidMimetype = allowedMimetypes.test(file.mimetype);

        if (hasValidExtension || hasValidMimetype) {
            console.log('File accepted');
            return cb(null, true);
        }

        console.log('File rejected');
        cb(new Error('Only image files (JPEG, PNG, WEBP, GIF) are allowed!'));
    }
});

// Initialize Anthropic (Claude)
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Initialize Telegram Bot with webhook
const bot = process.env.TELEGRAM_BOT_TOKEN ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false }) : null;
const OPERATOR_CHAT_ID = process.env.OPERATOR_CHAT_ID;

// Session storage (in production, use Redis or database)
const sessions = new Map();

// System prompt for Claude (dynamic based on user language)
function getSystemPrompt(userLanguage) {
    if (!userLanguage) {
        return `You are a helpful assistant for Smart Wash.

IMPORTANT: The user's first message will be their preferred language (e.g., "slovenščina", "english", "русский", "hrvatski", etc.).

Your response should:
1. Detect and save their language
2. Confirm in their language: "✓ Language set: [language]"
3. Ask how you can help them in their chosen language

Be brief and friendly.`;
    }

    return `You are a helpful assistant for Smart Wash, a laundromat service in Ljubljana, Slovenia.

CRITICAL: You MUST respond ONLY in ${userLanguage}. Do not mix languages.

Information about Smart Wash:
- Two locations: Pralnica TC Jarše (Beblerjev trg 2) and Pralnica Galjevica (Galjevica 6a)
- Services: Washing (10kg - 6 tokens, 18kg - 8 tokens), Drying (10 min - 1 token), Disinfection (1 cycle - 2 tokens)
- Opening hours: Mon-Sat 08:00-20:00, Sun 08:00-14:00
- Modern self-service machines with multiple washing programs (Cotton, Synthetics, Mixed, Quick wash)
- Drying programs with temperature control (Low, Medium, High)

If the user asks complex questions, needs human support, or explicitly asks to talk to an operator, respond with:
"TRIGGER_OPERATOR: [brief summary of user's request in ${userLanguage}]"

Be friendly, helpful, and concise. Remember: ONLY respond in ${userLanguage}.`;
}

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
        console.log(`Creating new session: ${sessionId}`);
        sessions.set(sessionId, {
            id: sessionId,
            messages: [],
            operatorMode: false,
            language: null,
            createdAt: new Date()
        });
    }
    return sessions.get(sessionId);
}

// Translate text to Russian if needed
async function translateToRussian(text, sourceLanguage) {
    // Don't translate if already in Russian, Slovenian, or English
    const noTranslateLanguages = ['Russian', 'Slovenian', 'English'];
    if (noTranslateLanguages.includes(sourceLanguage)) {
        return text;
    }

    try {
        const response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 500,
            system: `You are a translator. Translate the following text to Russian. Only output the translation, nothing else.`,
            messages: [{
                role: 'user',
                content: `Translate to Russian:\n\n${text}`
            }]
        });

        return response.content[0].text.trim();
    } catch (error) {
        console.error('Translation error:', error);
        return text; // Return original if translation fails
    }
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
            // Send user's message to operator via Telegram
            const notification = `💬 *NOVO SPOROČILO*\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `👤 Uporabnik:\n\n` +
                `"${message}"\n\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `Session: \`${sessionId}\``;

            if (bot && OPERATOR_CHAT_ID) {
                try {
                    await bot.sendMessage(OPERATOR_CHAT_ID, notification, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '❌ Zapri sejo / Close', callback_data: `close_${sessionId}` }
                            ]]
                        }
                    });
                } catch (telegramError) {
                    console.error('Telegram notification failed:', telegramError.message);
                }
            }

            return res.json({
                response: '✓✓',
                operatorMode: true
            });
        }

        // Check if should trigger operator
        if (shouldTriggerOperator(message)) {
            session.operatorMode = true;

            // Translate message if needed
            const translatedMessage = await translateToRussian(message, session.language);
            const showOriginal = ['Russian', 'Slovenian', 'English'].includes(session.language);

            // Notify operator via Telegram
            let notification = `🔔 *ЗАПРОС ОПЕРАТОРА*\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `👤 Клиент (${session.language || 'Unknown'}):\n\n`;

            if (showOriginal) {
                notification += `"${message}"\n\n`;
            } else {
                notification += `"${translatedMessage}"\n\n`;
            }

            notification += `━━━━━━━━━━━━━━━━━\n` +
                `Session: \`${sessionId}\``;

            if (bot && OPERATOR_CHAT_ID) {
                try {
                    await bot.sendMessage(OPERATOR_CHAT_ID, notification, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '❌ Закрыть / Close', callback_data: `close_${sessionId}` }
                            ]]
                        }
                    });
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
            system: getSystemPrompt(session.language),
            messages: session.messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }))
        });

        const assistantMessage = response.content[0].text;

        // If this is the first message, detect and save language
        if (!session.language && session.messages.length === 1) {
            // Extract language from user's first message
            const userLanguage = message.toLowerCase().trim();

            // Map common language names
            const languageMap = {
                'slovenščina': 'Slovenian',
                'slovene': 'Slovenian',
                'slovenian': 'Slovenian',
                'english': 'English',
                'англи': 'English',
                'русский': 'Russian',
                'russian': 'Russian',
                'ruski': 'Russian',
                'hrvatski': 'Croatian',
                'croatian': 'Croatian',
                'hrvatska': 'Croatian',
                'italiano': 'Italian',
                'italian': 'Italian',
                'deutsch': 'German',
                'german': 'German',
                'nemščina': 'German',
                'español': 'Spanish',
                'spanish': 'Spanish',
                'français': 'French',
                'french': 'French'
            };

            // Find matching language
            for (const [key, value] of Object.entries(languageMap)) {
                if (userLanguage.includes(key)) {
                    session.language = value;
                    console.log(`Language set to: ${value}`);
                    break;
                }
            }

            // If no match, try to detect from the message itself
            if (!session.language) {
                session.language = 'English'; // Default fallback
                console.log('Language not detected, defaulting to English');
            }
        }

        // Check if Claude wants to trigger operator
        if (assistantMessage.includes('TRIGGER_OPERATOR:')) {
            session.operatorMode = true;

            // Translate message and history if needed
            const showOriginal = ['Russian', 'Slovenian', 'English'].includes(session.language);
            const translatedMessage = showOriginal ? message : await translateToRussian(message, session.language);

            // Build conversation history (last 5 messages) - translate if needed
            const historyPromises = session.messages.slice(-5).map(async msg => {
                const icon = msg.role === 'user' ? '👤' : '🤖';
                let text = msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content;

                // Translate history if not in original languages
                if (!showOriginal) {
                    text = await translateToRussian(text, session.language);
                }

                return `${icon}: ${text}`;
            });
            const historyMessages = (await Promise.all(historyPromises)).join('\n');

            // Notify operator
            const notification = `🔔 *ЗАПРОС ОПЕРАТОРА*\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `👤 Клиент (${session.language || 'Unknown'}):\n\n` +
                `"${translatedMessage}"\n\n` +
                `📝 История разговора:\n${historyMessages}\n\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `Session: \`${sessionId}\``;

            if (bot && OPERATOR_CHAT_ID) {
                try {
                    await bot.sendMessage(OPERATOR_CHAT_ID, notification, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '❌ Закрыть / Close', callback_data: `close_${sessionId}` }
                            ]]
                        }
                    });
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

// Upload photo endpoint
app.post('/api/upload', (req, res) => {
    upload.single('photo')(req, res, async (err) => {
        // Handle multer errors
        if (err) {
            console.error('Multer error:', err.message);
            if (err.message.includes('Only image files')) {
                return res.status(400).json({
                    error: 'Nepodprt format slike / Unsupported image format',
                    message: 'Prosimo uporabite JPEG, PNG, WEBP ali GIF format.\nPlease use JPEG, PNG, WEBP or GIF format.\n\nℹ️ HEIC format ni podprt. Pretvorite v JPG.\nHEIC format not supported. Convert to JPG.'
                });
            }
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        try {

        const { sessionId } = req.body;
        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        const session = getSession(sessionId);
        const photoUrl = `/uploads/${req.file.filename}`;
        const photoPath = req.file.path;

        // Add photo message to session
        session.messages.push({
            role: 'user',
            content: '[Фото]',
            photo: photoUrl,
            timestamp: new Date()
        });

        // Automatically switch to operator mode when photo is sent
        if (!session.operatorMode) {
            session.operatorMode = true;
        }

        // Send photo to operator via Telegram
        if (bot && OPERATOR_CHAT_ID) {
            const notification = `📸 *ФОТО ОД КОРИСТУВАЧА*\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `Session: \`${sessionId}\``;

            try {
                await bot.sendPhoto(OPERATOR_CHAT_ID, photoPath, {
                    caption: notification,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '❌ Zapri sejo / Close', callback_data: `close_${sessionId}` }
                        ]]
                    }
                });
            } catch (telegramError) {
                console.error('Telegram photo send failed:', telegramError.message);
            }
        }

        res.json({
            success: true,
            photoUrl: photoUrl,
            operatorMode: true
        });
        } catch (error) {
            console.error('Photo upload error:', error);
            res.status(500).json({ error: 'Failed to upload photo' });
        }
    });
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
            photo: msg.photo || null,
            timestamp: msg.timestamp
        }));

    res.json({ messages: newMessages });
});

// Telegram bot commands are now handled in the webhook endpoint above

// Telegram webhook endpoint
app.post(`/telegram/webhook`, async (req, res) => {
    if (!bot) {
        return res.sendStatus(200);
    }

    try {
        const update = req.body;

        // Handle callback queries (button presses)
        if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const chatId = callbackQuery.message.chat.id;
            const data = callbackQuery.data;

            // Answer callback query to remove loading state
            try {
                await bot.answerCallbackQuery(callbackQuery.id);
            } catch (err) {
                console.error('Error answering callback query:', err.message);
            }

            // Handle close button
            if (data.startsWith('close_')) {
                const sessionId = data.substring(6); // Remove 'close_' prefix
                const session = sessions.get(sessionId);

                if (!session) {
                    try {
                        await bot.sendMessage(chatId, `❌ Seja ${sessionId} ne obstaja več / Session no longer exists`);
                    } catch (sendError) {
                        console.error('Error sending message:', sendError.message);
                    }
                    return res.sendStatus(200);
                }

                // Send goodbye message to user
                session.messages.push({
                    role: 'assistant',
                    content: 'Hvala za pogovor! Zdaj se lahko ponovno pogovarjate z našim AI asistentom.\n\nThank you for the conversation! You can now chat with our AI assistant again.',
                    timestamp: new Date(),
                    fromOperator: true
                });

                // Exit operator mode
                session.operatorMode = false;

                console.log(`Session ${sessionId} closed via button by operator`);
                try {
                    await bot.sendMessage(chatId,
                        `✅ Seja ${sessionId} zaprta / Session closed\n\n` +
                        `Uporabnik je vrnjen v AI chat / User returned to AI chat`
                    );
                } catch (sendError) {
                    console.error('Error sending close confirmation:', sendError.message);
                }
            }

            return res.sendStatus(200);
        }

        // Handle incoming messages
        if (update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = msg.text || '';

            console.log(`Received message from ${chatId}: ${text}`);
            console.log(`Has reply_to_message: ${!!msg.reply_to_message}`);

            // Handle reply to notification (easy way to respond to user)
            if (msg.reply_to_message && (msg.reply_to_message.text || msg.reply_to_message.caption)) {
                const replyText = msg.reply_to_message.text || msg.reply_to_message.caption;
                console.log(`Reply to text/caption: ${replyText}`);

                // Extract session ID from the original notification message
                // Note: Telegram removes backticks when displaying Markdown, so we search without them
                const sessionIdMatch = replyText.match(/Session: (session-[a-z0-9]+)/);
                console.log(`Session ID match: ${sessionIdMatch ? sessionIdMatch[1] : 'not found'}`);

                if (sessionIdMatch && chatId.toString() === OPERATOR_CHAT_ID) {
                    const sessionId = sessionIdMatch[1];
                    const session = sessions.get(sessionId);

                    if (!session) {
                        try {
                            await bot.sendMessage(chatId, `❌ Seja ${sessionId} več ne obstaja / Session no longer exists`);
                        } catch (sendError) {
                            console.error('Error sending message:', sendError.message);
                        }
                        return res.sendStatus(200);
                    }

                    // Add operator's message to session
                    session.messages.push({
                        role: 'assistant',
                        content: text,
                        timestamp: new Date(),
                        fromOperator: true
                    });

                    console.log(`Reply sent to session ${sessionId} via reply-to`);
                    try {
                        await bot.sendMessage(chatId, `✅ Sporočilo poslano / Message sent`);
                    } catch (sendError) {
                        console.error('Error sending confirmation:', sendError.message);
                    }

                    return res.sendStatus(200);
                }
            }

            // Handle photo from operator
            if (msg.photo && msg.photo.length > 0) {
                // Check if this is a reply to notification
                let sessionId = null;

                if (msg.reply_to_message && msg.reply_to_message.caption) {
                    const sessionIdMatch = msg.reply_to_message.caption.match(/Session: (session-[a-z0-9]+)/);
                    if (sessionIdMatch) {
                        sessionId = sessionIdMatch[1];
                    }
                }

                if (!sessionId && chatId.toString() === OPERATOR_CHAT_ID) {
                    // If not a reply, ask operator to specify session
                    try {
                        await bot.sendMessage(chatId, '❌ Prosimo odgovorite (reply) na sporočilo uporabnika da pošljete fotografijo\n\nPlease reply to user\'s message to send photo');
                    } catch (sendError) {
                        console.error('Error sending message:', sendError.message);
                    }
                    return res.sendStatus(200);
                }

                if (sessionId && chatId.toString() === OPERATOR_CHAT_ID) {
                    const session = sessions.get(sessionId);
                    if (!session) {
                        try {
                            await bot.sendMessage(chatId, `❌ Seja ${sessionId} več ne obstaja / Session no longer exists`);
                        } catch (sendError) {
                            console.error('Error sending message:', sendError.message);
                        }
                        return res.sendStatus(200);
                    }

                    try {
                        // Get the largest photo
                        const photo = msg.photo[msg.photo.length - 1];
                        const fileId = photo.file_id;

                        // Download photo from Telegram
                        const fileLink = await bot.getFileLink(fileId);
                        const https = require('https');
                        const photoFilename = `photo-operator-${Date.now()}.jpg`;
                        const photoPath = path.join(uploadsDir, photoFilename);
                        const file = fs.createWriteStream(photoPath);

                        await new Promise((resolve, reject) => {
                            https.get(fileLink, (response) => {
                                response.pipe(file);
                                file.on('finish', () => {
                                    file.close();
                                    resolve();
                                });
                            }).on('error', (err) => {
                                fs.unlink(photoPath, () => {});
                                reject(err);
                            });
                        });

                        // Add photo to session
                        session.messages.push({
                            role: 'assistant',
                            content: '[Фото од оператора]',
                            photo: `/uploads/${photoFilename}`,
                            timestamp: new Date(),
                            fromOperator: true
                        });

                        console.log(`Photo sent to session ${sessionId} via operator`);
                        await bot.sendMessage(chatId, `✅ Fotografija poslana / Photo sent`);
                    } catch (error) {
                        console.error('Error processing operator photo:', error);
                        await bot.sendMessage(chatId, `❌ Napaka pri pošiljanju fotografije / Error sending photo`);
                    }

                    return res.sendStatus(200);
                }
            }

            // Handle /start command
            if (text === '/start') {
                try {
                    await bot.sendMessage(chatId,
                        `👋 *Smart Wash Operator Bot*\n\n` +
                        `Vaš Chat ID: \`${chatId}\`\n` +
                        `Your Chat ID: \`${chatId}\`\n\n` +
                        `Kopirajte ta ID v .env datoteko kot OPERATOR_CHAT_ID\n` +
                        `Copy this ID to .env file as OPERATOR_CHAT_ID\n\n` +
                        `*Kako odgovarjati / How to respond:*\n` +
                        `📱 Enostavno odgovorite (reply) na sporočilo\n` +
                        `📱 Simply reply to the notification message\n\n` +
                        `*Ukazi / Commands:*\n` +
                        `/sessions - Prikaži aktivne seje / Show active sessions`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (sendError) {
                    console.error('Error sending start message:', sendError.message);
                }
            }
            // Handle /sessions command
            else if (text === '/sessions') {
                if (chatId.toString() !== OPERATOR_CHAT_ID) {
                    return await bot.sendMessage(chatId, '⛔ Nimate dostopa / Access denied');
                }

                console.log(`Total sessions in memory: ${sessions.size}`);
                console.log(`All session IDs: ${Array.from(sessions.keys()).join(', ')}`);

                const allSessions = Array.from(sessions.entries())
                    .map(([id, session]) => {
                        const lastMessage = session.messages[session.messages.length - 1];
                        const mode = session.operatorMode ? '🔴 OPERATOR' : '🟢 AI';
                        return `${mode} \`${id}\` - ${lastMessage?.content.substring(0, 30)}...`;
                    });

                const activeSessions = Array.from(sessions.entries())
                    .filter(([_, session]) => session.operatorMode)
                    .map(([id, session]) => {
                        const lastMessage = session.messages[session.messages.length - 1];
                        return `• \`${id}\` - ${lastMessage?.content.substring(0, 50)}...`;
                    });

                try {
                    if (allSessions.length === 0) {
                        await bot.sendMessage(chatId, '📭 Ni aktivnih sej / No sessions in memory');
                    } else if (activeSessions.length === 0) {
                        await bot.sendMessage(chatId,
                            `*Vse seje / All sessions (${allSessions.length}):*\n\n${allSessions.join('\n')}\n\n` +
                            `⚠️ Nobena seja ni v operator mode / No sessions in operator mode`,
                            { parse_mode: 'Markdown' }
                        );
                    } else {
                        await bot.sendMessage(chatId,
                            `*Vse seje / All sessions (${allSessions.length}):*\n\n${allSessions.join('\n')}\n\n` +
                            `*Aktivne seje / Active (${activeSessions.length}):*\n\n${activeSessions.join('\n')}`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                } catch (sendError) {
                    console.error('Error sending sessions list:', sendError.message);
                }
            }
            // Handle /reply command
            else if (text.startsWith('/reply ')) {
                if (chatId.toString() !== OPERATOR_CHAT_ID) {
                    return await bot.sendMessage(chatId, '⛔ Nimate dostopa / Access denied');
                }

                const parts = text.split(' ');
                if (parts.length < 3) {
                    return await bot.sendMessage(chatId, '❌ Format: /reply [sessionId] [sporočilo]');
                }

                const sessionId = parts[1];
                const message = parts.slice(2).join(' ');

                console.log(`Looking for session: ${sessionId}`);
                console.log(`Available sessions: ${Array.from(sessions.keys()).join(', ')}`);
                console.log(`Total sessions: ${sessions.size}`);

                const session = sessions.get(sessionId);
                if (!session) {
                    const availableSessions = Array.from(sessions.keys()).join(', ') || 'none';
                    try {
                        await bot.sendMessage(chatId,
                            `❌ Seja ${sessionId} ne obstaja / Session not found\n\n` +
                            `Razpoložljive seje / Available sessions: ${availableSessions}`
                        );
                    } catch (sendError) {
                        console.error('Error sending not found message:', sendError.message);
                    }
                    return;
                }

                // Add operator message to session
                session.messages.push({
                    role: 'assistant',
                    content: message,
                    timestamp: new Date(),
                    fromOperator: true
                });

                console.log(`Message added to session ${sessionId}`);
                try {
                    await bot.sendMessage(chatId, `✅ Sporočilo poslano / Message sent to session ${sessionId}`);
                } catch (sendError) {
                    console.error('Error sending success message:', sendError.message);
                }
            }
            // Handle /close command
            else if (text.startsWith('/close ')) {
                if (chatId.toString() !== OPERATOR_CHAT_ID) {
                    return await bot.sendMessage(chatId, '⛔ Nimate dostopa / Access denied');
                }

                const parts = text.split(' ');
                if (parts.length !== 2) {
                    return await bot.sendMessage(chatId, '❌ Format: /close [sessionId]');
                }

                const sessionId = parts[1];
                const session = sessions.get(sessionId);

                if (!session) {
                    const availableSessions = Array.from(sessions.keys()).join(', ') || 'none';
                    try {
                        await bot.sendMessage(chatId,
                            `❌ Seja ${sessionId} ne obstaja / Session not found\n\n` +
                            `Razpoložljive seje / Available sessions: ${availableSessions}`
                        );
                    } catch (sendError) {
                        console.error('Error sending not found message:', sendError.message);
                    }
                    return;
                }

                // Send goodbye message to user
                session.messages.push({
                    role: 'assistant',
                    content: 'Hvala za pogovor! Zdaj se lahko ponovno pogovarjate z našim AI asistentom.\n\nThank you for the conversation! You can now chat with our AI assistant again.',
                    timestamp: new Date(),
                    fromOperator: true
                });

                // Exit operator mode
                session.operatorMode = false;

                console.log(`Session ${sessionId} closed by operator`);
                try {
                    await bot.sendMessage(chatId,
                        `✅ Seja ${sessionId} zaprta / Session closed\n\n` +
                        `Uporabnik je vrnjen v AI chat / User returned to AI chat`
                    );
                } catch (sendError) {
                    console.error('Error sending close confirmation:', sendError.message);
                }
            }
        }
    } catch (error) {
        console.error('Webhook error:', error);
    }

    res.sendStatus(200);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', sessions: sessions.size });
});

// Reset webhook endpoint (for debugging)
app.get('/reset-webhook', async (req, res) => {
    if (!bot) {
        return res.json({ error: 'Bot not configured' });
    }

    try {
        // Delete webhook with drop_pending_updates
        await bot.deleteWebHook({ drop_pending_updates: true });
        console.log('Webhook deleted with pending updates dropped');

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Set webhook again
        const webhookUrl = `https://claude-production-e0ea.up.railway.app/telegram/webhook`;
        await bot.setWebHook(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);

        // Get webhook info
        const info = await bot.getWebhookInfo();

        res.json({
            success: true,
            message: 'Webhook reset successfully',
            webhookInfo: info
        });
    } catch (error) {
        console.error('Error resetting webhook:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`💬 Chat API ready`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);

    // Set up Telegram webhook
    if (bot) {
        const webhookUrl = `https://claude-production-e0ea.up.railway.app/telegram/webhook`;
        try {
            await bot.setWebHook(webhookUrl);
            console.log(`📱 Telegram webhook set to: ${webhookUrl}`);
            console.log(`💬 Bot ready to receive notifications`);
        } catch (error) {
            console.error('Failed to set Telegram webhook:', error.message);
            console.log(`📱 Telegram bot: notifications may not work`);
        }
    } else {
        console.log(`📱 Telegram bot: disabled`);
    }
});
