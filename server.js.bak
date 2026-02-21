const express = require('express');
const cors = require('cors');
const { Anthropic } = require('@anthropic-ai/sdk');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PlanfixIntegration = require('./planfix-integration');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

// Redirect www to non-www (SEO fix)
app.use((req, res, next) => {
    if (req.headers.host === 'www.smart-wash.si') {
        return res.redirect(301, `https://smart-wash.si${req.url}`);
    }
    next();
});

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

// Initialize Planfix Integration
const planfix = new PlanfixIntegration({
    enabled: process.env.PLANFIX_ENABLED === 'true',
    account: process.env.PLANFIX_ACCOUNT,
    apiToken: process.env.PLANFIX_API_TOKEN,
    projectId: process.env.PLANFIX_PROJECT_ID
});

// Session storage (in production, use Redis or database)
const sessions = new Map();

// Map Telegram message IDs to session IDs (for group chat threading)
const telegramMessageToSession = new Map(); // messageId -> sessionId

// Store website content (updated once per day)
let websiteContent = {
    lastUpdated: null,
    info: 'Loading...'
};

// Fetch and parse website content
async function updateWebsiteContent() {
    try {
        console.log('Fetching website content from www.smart-wash.si...');

        const response = await fetch('https://www.smart-wash.si');
        const html = await response.text();

        // Clean HTML: remove scripts, styles, and HTML tags to get visible text only
        let cleanText = html
            // Remove script tags and their content
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            // Remove style tags and their content
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            // Remove HTML comments
            .replace(/<!--[\s\S]*?-->/g, '')
            // Remove all HTML tags
            .replace(/<[^>]+>/g, ' ')
            // Decode HTML entities
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            // Clean up whitespace
            .replace(/\s+/g, ' ')
            .trim();

        console.log(`Cleaned text length: ${cleanText.length} characters`);

        // Use Claude to extract structured information from clean text
        const extractionResponse = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 4000,
            system: 'You are a content extractor. Extract ALL information from the website text and format it clearly. Do NOT skip any details, rules, or instructions. Be thorough and complete.',
            messages: [{
                role: 'user',
                content: `Extract ALL of the following information from this text (in English). Be VERY thorough — do NOT skip anything:

1. ALL SERVICES offered (washing, drying, disinfection/ozone treatment, etc.) with exact prices in tokens/euros
2. ALL LOCATIONS with full addresses
3. OPENING HOURS for each location (be very specific - different locations may have different hours!)
4. Contact information (phone, email)
5. Payment methods and any special features
6. Any promotions or bonuses
7. ALL RULES AND RESTRICTIONS — what is ALLOWED and what is PROHIBITED/FORBIDDEN (e.g., shoes, pets, dyeing, bleach, overloading, etc.)
8. STEP-BY-STEP USAGE INSTRUCTIONS for each service (washing instructions, drying instructions, disinfection instructions, token purchase instructions, etc.)
9. ANY WARNINGS, TIPS, or IMPORTANT NOTES for customers

IMPORTANT: Look carefully for:
- Disinfection/ozone services
- Different operating hours for different locations (TC Jarše vs Galjevica)
- ANY prohibitions or restrictions (items that cannot be washed, things that are not allowed)
- Step-by-step instructions for using machines
- Rules about what can and cannot be washed

Format clearly with sections and bullet points. Include a dedicated "RULES AND RESTRICTIONS" section.

Text from website:
${cleanText}`
            }]
        });

        websiteContent = {
            lastUpdated: new Date(),
            info: extractionResponse.content[0].text
        };

        console.log('Website content updated successfully');
        console.log('Content preview:', websiteContent.info.substring(0, 200) + '...');
    } catch (error) {
        console.error('Error updating website content:', error.message);
        // Keep old content if update fails
    }
}

// Update website content on startup
updateWebsiteContent();

// Schedule daily update at 5:00 AM Ljubljana time
function scheduleDailyUpdate() {
    const now = new Date();
    const ljubljanaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Ljubljana' }));

    // Calculate time until next 5:00 AM
    const next5AM = new Date(ljubljanaTime);
    next5AM.setHours(5, 0, 0, 0);

    if (ljubljanaTime.getHours() >= 5) {
        // If it's already past 5 AM today, schedule for tomorrow
        next5AM.setDate(next5AM.getDate() + 1);
    }

    const msUntil5AM = next5AM - ljubljanaTime;

    console.log(`Next website update scheduled at 5:00 AM (in ${Math.round(msUntil5AM / 1000 / 60 / 60)} hours)`);

    setTimeout(() => {
        updateWebsiteContent();
        // Schedule next update (24 hours later)
        setInterval(updateWebsiteContent, 24 * 60 * 60 * 1000);
    }, msUntil5AM);
}

scheduleDailyUpdate();

// Read internal knowledge base
let internalKnowledge = '';
try {
    const kbPath = path.join(__dirname, 'AI_KNOWLEDGE_BASE.md');
    if (fs.existsSync(kbPath)) {
        internalKnowledge = fs.readFileSync(kbPath, 'utf8');
        console.log('Internal knowledge base loaded successfully');
    } else {
        console.log('AI_KNOWLEDGE_BASE.md not found, skipping');
    }
} catch (error) {
    console.error('Error loading knowledge base:', error.message);
}

// System prompt for Claude (dynamic based on user language and name status)
function getSystemPrompt(userLanguage, userName, askedForName) {
    // Prompt for asking user's name (after first message)
    if (!askedForName && !userName) {
        return `You are a helpful assistant for Smart Wash, a laundromat service in Ljubljana, Slovenia.

IMPORTANT: You MUST respond ONLY in ${userLanguage}.

This is the user's FIRST message. Your response should:
1. Briefly acknowledge their question/message
2. Ask for their name in ${userLanguage}

Examples:
- Slovenian: "Kako vam lahko pomagam? Kako se lahko obračam na vas?"
- English: "How can I help you? What is your name?"
- Russian: "Чем могу помочь? Как к вам обращаться?"

Be friendly and brief.`;
    }

    return `You are a helpful assistant for Smart Wash, a laundromat service in Ljubljana, Slovenia.

CRITICAL: You MUST respond ONLY in ${userLanguage}. Do not mix languages.

## ⚠️ ABSOLUTE RULE: USE ONLY OFFICIAL DATA — NEVER USE GENERAL KNOWLEDGE

You have OFFICIAL information from two sources below:
1. **WEBSITE DATA** (Prices, locations, services, opening hours)
2. **INTERNAL KNOWLEDGE BASE** (FAQ, cleaning details, specific policies)

These are your ONLY sources of truth.

**STRICT RULES:**
1. ALWAYS answer questions using ONLY the data provided below
2. NEVER use your general knowledge or information from the internet about laundromats
3. NEVER invent, assume, or guess information that is not explicitly stated in the provided data
4. If the answer is NOT found in either section below, honestly say you don't have that information and suggest contacting the operator
5. Do NOT add extra details, tips, or recommendations that are not in the official data

**1. WEBSITE DATA (updated ${websiteContent.lastUpdated ? websiteContent.lastUpdated.toLocaleDateString() : 'recently'}):**

${websiteContent.info}

**2. INTERNAL KNOWLEDGE BASE (FAQ & Specific Policies):**

${internalKnowledge}

**END OF OFFICIAL DATA**

IMPORTANT SCOPE:
- You can ONLY help with Smart Wash laundry services
- If asked about unrelated topics (weather, tourism, Ljubljana info, etc.), politely say you can only help with Smart Wash questions
- DO NOT trigger operator for off-topic questions

ONLY trigger operator (with "TRIGGER_OPERATOR:") when:
1. User explicitly asks to talk to human/operator
2. User reports a problem with machines/payment that you cannot solve
3. User has a complaint or wants a refund
4. User needs assistance at the location right now

For all other questions about Smart Wash, answer directly using ONLY the official data above. Be friendly, helpful, and concise. Remember: ONLY respond in ${userLanguage}.

## PRICING - ALWAYS CONVERT TOKENS TO EUROS

CRITICAL: When mentioning prices, ALWAYS use the EXACT prices from the website data above. ALWAYS include BOTH tokens AND euro amount.

**Token value:** 1 token = €1

**How to format prices:**
- Slovenian: "5 žetonov (€5)" or "2 žetona (€2)"
- English: "5 tokens (€5)" or "2 tokens (€2)"
- Russian: "5 жетонов (€5)" or "2 жетона (€2)"
- Other languages: follow same pattern

ALWAYS add euro amount in parentheses after tokens!

## INSTRUCTION LINKS - ALWAYS INCLUDE RELEVANT LINKS

When answering questions, ALWAYS include a relevant link at the end of your response:

**Topic → Link mapping:**
- Washing / pranje / стирка → https://smart-wash.si/#washing
- Drying / sušenje / сушка → https://smart-wash.si/#drying
- Disinfection / dezinfekcija / дезинфекция / ozone → https://smart-wash.si/#disinfection
- Tokens / žetoni / жетоны / payment / how to pay → https://smart-wash.si/#tokens
- Rules / pravila / правила / what is allowed → https://smart-wash.si/#rules
- Problems / težave / проблемы / not working / error → https://smart-wash.si/#problems
- Contact / kontakt / контакты / phone / help → https://smart-wash.si/#contact
- Locations / lokacije / адреса / where / address → https://smart-wash.si/#locations
- Services / storitve / услуги / prices / цены → https://smart-wash.si/#services

**How to use links:**
1. Answer the question fully in text first
2. Add link on a new line at the end
3. Format in user's language:
   - Slovenian: "Več informacij: [URL]"
   - English: "More details: [URL]"
   - Russian: "Подробнее: [URL]"
   - Ukrainian: "Детальніше: [URL]"
   - Other: "More info: [URL]"
4. If question covers multiple topics, give multiple links

**Example response:**
"Naložite perilo, izberite temperaturo (30°, 40°, 60° ali 90°), vstavite 5 žetonov za 10kg stroj, pritisnite START.

Več informacij: https://smart-wash.si/#washing"`;
}

// Get operator connection message in user's language
function getOperatorConnectMessage(userLanguage) {
    const messages = {
        'Slovenian': '👨‍💼 Povezujem vas z našim operaterjem. Počakajte trenutek...\n\n💡 Tip: Napišite /ai za vrnitev na AI asistenta',
        'English': '👨‍💼 Connecting you with our operator. Please wait a moment...\n\n💡 Tip: Type /ai to switch back to AI assistant',
        'Russian': '👨‍💼 Соединяю вас с оператором. Пожалуйста, подождите...\n\n💡 Совет: Напишите /ai чтобы вернуться к AI ассистенту',
        'Croatian': '👨‍💼 Povezujem vas s našim operatorom. Pričekajte trenutak...\n\n💡 Savjet: Napišite /ai za povratak na AI asistenta',
        'Italian': '👨‍💼 Vi sto collegando con il nostro operatore. Attendere prego...\n\n💡 Suggerimento: Digita /ai per tornare all\'assistente AI',
        'German': '👨‍💼 Ich verbinde Sie mit unserem Operator. Bitte warten Sie...\n\n💡 Tipp: Geben Sie /ai ein, um zum AI-Assistenten zurückzukehren',
        'Spanish': '👨‍💼 Le estoy conectando con nuestro operador. Por favor espere...\n\n💡 Consejo: Escriba /ai para volver al asistente AI',
        'French': '👨‍💼 Je vous connecte avec notre opérateur. Veuillez patienter...\n\n💡 Astuce: Tapez /ai pour revenir à l\'assistant AI',
        'Portuguese': '👨‍💼 Estou conectando você com nosso operador. Por favor aguarde...\n\n💡 Dica: Digite /ai para voltar ao assistente AI',
        'Polish': '👨‍💼 Łączę z naszym operatorem. Proszę czekać...\n\n💡 Wskazówka: Wpisz /ai aby wrócić do asystenta AI',
        'Czech': '👨‍💼 Spojuji vás s naším operátorem. Počkejte prosím...\n\n💡 Tip: Napište /ai pro návrat k AI asistentovi',
        'Ukrainian': '👨‍💼 З\'єдную вас з нашим оператором. Будь ласка, зачекайте...\n\n💡 Порада: Напишіть /ai щоб повернутися до AI асистента',
        'Serbian': '👨‍💼 Povezujem vas sa našim operatorom. Molim sačekajte...\n\n💡 Savet: Napišite /ai za povratak na AI asistenta',
        'Japanese': '👨‍💼 オペレーターにおつなぎします。しばらくお待ちください...\n\n💡 ヒント: /ai と入力すると AI アシスタントに戻ります',
        'Chinese': '正在为您连接我们的客服。请稍候...',
        'Korean': '상담원과 연결 중입니다. 잠시만 기다려 주세요...',
        'Turkish': 'Operatörümüze bağlanıyorsunuz. Lütfen bekleyin...',
        'Arabic': 'جارٍ توصيلك بمشغلنا. يرجى الانتظار...'
    };

    return messages[userLanguage] || messages['English'];
}

// Check if operator is available (6:00-23:00 Ljubljana time)
function isOperatorAvailable() {
    const now = new Date();
    const ljubljanaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Ljubljana' }));
    const hours = ljubljanaTime.getHours();

    // Operator available from 6:00 to 23:00
    return hours >= 6 && hours < 23;
}

// Get operator unavailable message in user's language
function getOperatorUnavailableMessage(userLanguage) {
    const messages = {
        'Slovenian': 'Trenutno operator ni na voljo. Delovni čas: 6:00-23:00.\n\nVaše sporočilo lahko pustite tukaj, ali me vprašajte kaj o Smart Wash!',
        'English': 'Operator is currently unavailable. Working hours: 6:00-23:00.\n\nYou can leave your message here, or ask me anything about Smart Wash!',
        'Russian': 'Оператор сейчас недоступен. Рабочее время: 6:00-23:00.\n\nВы можете оставить сообщение здесь, или спросите меня что-нибудь о Smart Wash!',
        'Croatian': 'Operator trenutno nije dostupan. Radno vrijeme: 6:00-23:00.\n\nMožete ostaviti poruku ovdje, ili me pitajte bilo što o Smart Wash!',
        'Italian': 'L\'operatore non è attualmente disponibile. Orario di lavoro: 6:00-23:00.\n\nPuoi lasciare il tuo messaggio qui, o chiedermi qualsiasi cosa su Smart Wash!',
        'German': 'Der Operator ist derzeit nicht verfügbar. Arbeitszeit: 6:00-23:00.\n\nSie können Ihre Nachricht hier hinterlassen oder mich etwas über Smart Wash fragen!',
        'Spanish': 'El operador no está disponible actualmente. Horario de trabajo: 6:00-23:00.\n\n¡Puedes dejar tu mensaje aquí, o preguntarme cualquier cosa sobre Smart Wash!',
        'French': 'L\'opérateur n\'est pas disponible actuellement. Heures de travail: 6:00-23:00.\n\nVous pouvez laisser votre message ici, ou me demander n\'importe quoi sur Smart Wash!',
        'Portuguese': 'O operador não está disponível no momento. Horário de trabalho: 6:00-23:00.\n\nVocê pode deixar sua mensagem aqui, ou me perguntar qualquer coisa sobre Smart Wash!',
        'Polish': 'Operator jest obecnie niedostępny. Godziny pracy: 6:00-23:00.\n\nMożesz zostawić wiadomość tutaj lub zapytać mnie o cokolwiek dotyczącego Smart Wash!',
        'Czech': 'Operátor je momentálně nedostupný. Pracovní doba: 6:00-23:00.\n\nMůžete zanechat zprávu zde, nebo se mě zeptejte na cokoliv o Smart Wash!',
        'Ukrainian': 'Оператор зараз недоступний. Робочий час: 6:00-23:00.\n\nВи можете залишити повідомлення тут, або запитайте мене про Smart Wash!',
        'Serbian': 'Operator trenutno nije dostupan. Radno vreme: 6:00-23:00.\n\nMožete ostaviti poruku ovde, ili me pitajte bilo šta o Smart Wash!',
        'Japanese': 'オペレーターは現在対応しておりません。営業時間：6:00-23:00。\n\nメッセージをここに残すか、Smart Washについて何でもお尋ねください！',
        'Chinese': '客服人员目前不可用。工作时间：6:00-23:00。\n\n您可以在此留言，或询问我关于Smart Wash的任何问题！',
        'Korean': '상담원이 현재 이용 불가능합니다. 근무 시간: 6:00-23:00.\n\n여기에 메시지를 남기거나 Smart Wash에 대해 무엇이든 물어보세요!',
        'Turkish': 'Operatör şu anda müsait değil. Çalışma saatleri: 6:00-23:00.\n\nMesajınızı buraya bırakabilir veya Smart Wash hakkında bana bir şey sorabilirsiniz!',
        'Arabic': 'المشغل غير متاح حاليًا. ساعات العمل: 6:00-23:00.\n\nيمكنك ترك رسالتك هنا، أو اسألني أي شيء عن Smart Wash!'
    };

    return messages[userLanguage] || messages['English'];
}

// Get goodbye message in user's language
function getGoodbyeMessage(userLanguage) {
    const messages = {
        'Slovenian': 'Hvala za pogovor! Zdaj se lahko ponovno pogovarjate z našim AI asistentom.',
        'English': 'Thank you for the conversation! You can now chat with our AI assistant again.',
        'Russian': 'Спасибо за общение! Теперь вы можете снова общаться с нашим AI ассистентом.',
        'Croatian': 'Hvala na razgovoru! Sada se opet možete razgovarati s našim AI asistentom.',
        'Italian': 'Grazie per la conversazione! Ora puoi chattare di nuovo con il nostro assistente AI.',
        'German': 'Vielen Dank für das Gespräch! Sie können jetzt wieder mit unserem KI-Assistenten chatten.',
        'Spanish': 'Gracias por la conversación. Ahora puede chatear de nuevo con nuestro asistente de IA.',
        'French': 'Merci pour la conversation! Vous pouvez maintenant discuter à nouveau avec notre assistant IA.',
        'Portuguese': 'Obrigado pela conversa! Agora você pode conversar novamente com nosso assistente de IA.',
        'Polish': 'Dziękuję za rozmowę! Możesz teraz ponownie rozmawiać z naszym asystentem AI.',
        'Czech': 'Děkuji za rozhovor! Nyní můžete znovu chatovat s naším AI asistentem.',
        'Ukrainian': 'Дякую за розмову! Тепер ви можете знову спілкуватися з нашим AI асистентом.',
        'Serbian': 'Hvala na razgovoru! Sada možete ponovo razgovarati sa našim AI asistentom.',
        'Japanese': 'ご利用ありがとうございました！今すぐAIアシスタントと再度チャットできます。',
        'Chinese': '感谢您的对话！您现在可以再次与我们的AI助手聊天。',
        'Korean': '대화해 주셔서 감사합니다! 이제 AI 어시스턴트와 다시 채팅할 수 있습니다.',
        'Turkish': 'Konuşma için teşekkürler! Artık AI asistanımızla tekrar sohbet edebilirsiniz.',
        'Arabic': 'شكرا للمحادثة! يمكنك الآن الدردشة مع مساعد الذكاء الاصطناعي مرة أخرى.'
    };

    return messages[userLanguage] || messages['English'];
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
// Counter for auto-generated customer names
let customerCounter = 0;

async function getSession(sessionId) {
    if (!sessions.has(sessionId)) {
        console.log(`Creating new session: ${sessionId}`);
        customerCounter++;
        const newSession = {
            id: sessionId,
            messages: [],
            operatorMode: false,
            language: 'Slovenian', // Default language is Slovenian
            userName: null,
            askedForName: false,
            customerNumber: customerCounter,
            createdAt: new Date(),
            lastUserMessageTime: new Date(),
            planfixTaskId: null // ID задачи в Планфиксе
        };
        sessions.set(sessionId, newSession);

        // Создаем задачу в Планфиксе (асинхронно, не блокируя)
        createPlanfixTaskForSession(newSession).catch(err => {
            console.error('Failed to create Planfix task:', err);
        });
    }
    return sessions.get(sessionId);
}

// Асинхронное создание задачи в Планфиксе
async function createPlanfixTaskForSession(session) {
    // Ждем немного, чтобы собрать базовую информацию о сессии
    await new Promise(resolve => setTimeout(resolve, 2000));

    const taskInfo = await planfix.createTaskForSession(session);
    if (taskInfo) {
        session.planfixTaskId = taskInfo.taskId;
        console.log(`✅ Session ${session.id} linked to Planfix task ${taskInfo.taskId}`);
        console.log(`📎 Task URL: ${taskInfo.taskUrl}`);
    }
}

// Логирование сообщения в Планфикс
async function logMessageToPlanfix(session, message, senderInfo) {
    if (!session.planfixTaskId) {
        return;
    }

    try {
        await planfix.addMessageComment(session.planfixTaskId, message, senderInfo);
    } catch (error) {
        console.error('Failed to log message to Planfix:', error);
    }
}

// Закрытие задачи в Планфиксе при завершении сессии
async function closePlanfixTask(session) {
    if (!session.planfixTaskId) {
        return;
    }

    try {
        // Добавляем итоговую сводку
        await planfix.addSessionSummary(session.planfixTaskId, session);

        // Обновляем статус на "Завершено"
        await planfix.updateTaskStatus(session.planfixTaskId, 'completed', {
            completedAt: new Date().toISOString()
        });

        console.log(`✅ Planfix task ${session.planfixTaskId} closed for session ${session.id}`);
    } catch (error) {
        console.error('Failed to close Planfix task:', error);
    }
}

// Translate text to Russian if needed
async function translateToRussian(text, sourceLanguage) {
    // Only skip translation if already in Russian
    if (sourceLanguage === 'Russian') {
        return text;
    }

    try {
        console.log(`Translating from ${sourceLanguage} to Russian: "${text.substring(0, 50)}..."`);

        const response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 500,
            system: `You are a translator. Translate the following text to Russian. Only output the translation, nothing else.`,
            messages: [{
                role: 'user',
                content: `Translate to Russian:\n\n${text}`
            }]
        });

        const translated = response.content[0].text.trim();
        console.log(`Translation result: "${translated.substring(0, 50)}..."`);
        return translated;
    } catch (error) {
        console.error('Translation error:', error);
        return `[${sourceLanguage}] ${text}`; // Return original with language tag if translation fails
    }
}

// Translate operator's response to user's language
async function translateToLanguage(text, targetLanguage) {
    console.log(`translateToLanguage called: target=${targetLanguage}`);

    // Don't translate if user's language is Russian (same as operator)
    if (targetLanguage === 'Russian') {
        console.log(`No translation needed - user speaks Russian`);
        return text;
    }

    console.log(`Translating from Russian to ${targetLanguage}: "${text.substring(0, 50)}..."`);

    try {
        const response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 500,
            system: `You are a translator. Translate the following text to ${targetLanguage}. Only output the translation, nothing else.`,
            messages: [{
                role: 'user',
                content: `Translate to ${targetLanguage}:\n\n${text}`
            }]
        });

        const translated = response.content[0].text.trim();
        console.log(`Translation result: "${translated.substring(0, 50)}..."`);
        return translated;
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

        const session = await getSession(sessionId);

        // Update last user message time for inactivity tracking
        session.lastUserMessageTime = new Date();

        // Add user message to session
        const userMessage = {
            role: 'user',
            content: message,
            timestamp: new Date()
        };
        session.messages.push(userMessage);

        // Log message to Planfix (async, don't block)
        if (session.planfixTaskId) {
            logMessageToPlanfix(session, userMessage, session.userName || `Customer${session.customerNumber}`)
                .catch(err => console.error('Failed to log message to Planfix:', err));
        }

        // Handle user commands
        const command = message.trim().toLowerCase();

        // Check if awaiting name for operator connection
        if (session.awaitingNameForOperator) {
            session.userName = message.trim();
            session.awaitingNameForOperator = false;

            console.log(`✅ User provided name: ${session.userName} for session ${sessionId}`);

            // Now actually connect to operator
            session.operatorMode = true;

            // Translate user's original request to Russian for operator
            const originalRequest = session.pendingOperatorRequest || 'Запрос оператора';
            const translatedMessage = session.language === 'Russian'
                ? originalRequest
                : await translateToRussian(originalRequest, session.language);

            // Notify operator via Telegram
            const notification = `🔔 *ЗАПРОС ОПЕРАТОРА*\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `👤 ${session.userName} (${session.language || 'Slovenian'}):\n\n` +
                `"${translatedMessage}"\n\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `Session: \`${sessionId}\``;

            if (bot && OPERATOR_CHAT_ID) {
                try {
                    const messageOptions = {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🔄 V AI / To AI', callback_data: `close_${sessionId}` },
                                { text: '🗑️ Izbriši / Delete', callback_data: `delete_${sessionId}` }
                            ]]
                        }
                    };

                    const sentMessage = await bot.sendMessage(OPERATOR_CHAT_ID, notification, messageOptions);
                    session.telegramThreadId = sentMessage.message_id;
                    telegramMessageToSession.set(sentMessage.message_id, sessionId);
                } catch (telegramError) {
                    console.error('Telegram notification failed:', telegramError.message);
                }
            }

            const thankYouMessages = {
                'English': `Thank you, ${session.userName}! Connecting you with our operator...`,
                'Slovenian': `Hvala, ${session.userName}! Povezujem vas z našim operaterjem...`,
                'Russian': `Спасибо, ${session.userName}! Соединяю вас с оператором...`,
                'Ukrainian': `Дякую, ${session.userName}! З'єдную вас з оператором...`,
                'Croatian': `Hvala, ${session.userName}! Povezujem vas s našim operaterom...`,
                'Serbian': `Hvala, ${session.userName}! Povezujem vas s našim operatorom...`,
                'Italian': `Grazie, ${session.userName}! Ti sto collegando con il nostro operatore...`,
                'German': `Danke, ${session.userName}! Ich verbinde Sie mit unserem Operator...`
            };

            return res.json({
                response: thankYouMessages[session.language] || thankYouMessages['English'],
                operatorMode: true
            });
        }

        // Command: /ai or /bot - switch back to AI
        if (command === '/ai' || command === '/bot') {
            if (session.operatorMode) {
                session.operatorMode = false;

                // Close Planfix task (async)
                closePlanfixTask(session).catch(err => console.error('Failed to close Planfix task:', err));

                const aiSwitchMessage = {
                    'English': '🤖 Switched back to AI assistant. How can I help you?',
                    'Slovenian': '🤖 Preklopljeno nazaj na AI asistenta. Kako vam lahko pomagam?',
                    'Russian': '🤖 Переключено обратно на AI ассистента. Чем могу помочь?',
                    'Ukrainian': '🤖 Перемкнуто назад на AI асистента. Чим можу допомогти?',
                    'Croatian': '🤖 Vraćeno na AI asistenta. Kako vam mogu pomoći?',
                    'Serbian': '🤖 Vraćeno na AI asistenta. Kako vam mogu pomoći?',
                    'Italian': '🤖 Ritornato all\'assistente AI. Come posso aiutarti?',
                    'German': '🤖 Zurück zum AI-Assistenten. Wie kann ich Ihnen helfen?'
                };

                const switchMsg = {
                    role: 'assistant',
                    content: aiSwitchMessage[session.language] || aiSwitchMessage['English'],
                    timestamp: new Date()
                };
                session.messages.push(switchMsg);

                // Log switch to Planfix
                if (session.planfixTaskId) {
                    logMessageToPlanfix(session, switchMsg, 'СИСТЕМА')
                        .catch(err => console.error('Failed to log to Planfix:', err));
                }

                return res.json({
                    response: aiSwitchMessage[session.language] || aiSwitchMessage['English'],
                    operatorMode: false
                });
            } else {
                const alreadyAiMessage = {
                    'English': '✓ You are already chatting with AI assistant.',
                    'Slovenian': '✓ Že klepetate z AI asistentom.',
                    'Russian': '✓ Вы уже общаетесь с AI ассистентом.',
                    'Ukrainian': '✓ Ви вже спілкуєтеся з AI асистентом.',
                    'Croatian': '✓ Već razgovarate s AI asistentom.',
                    'Serbian': '✓ Već razgovarate s AI asistentom.',
                    'Italian': '✓ Stai già chattando con l\'assistente AI.',
                    'German': '✓ Sie chatten bereits mit dem AI-Assistenten.'
                };

                return res.json({
                    response: alreadyAiMessage[session.language] || alreadyAiMessage['English'],
                    operatorMode: false
                });
            }
        }

        // Command: /operator or /live - switch to operator
        if (command === '/operator' || command === '/live') {
            if (session.operatorMode) {
                const alreadyOperatorMessage = {
                    'English': '✓ You are already connected to an operator.',
                    'Slovenian': '✓ Že ste povezani z operaterjem.',
                    'Russian': '✓ Вы уже подключены к оператору.',
                    'Ukrainian': '✓ Ви вже підключені до оператора.',
                    'Croatian': '✓ Već ste povezani s operaterom.',
                    'Serbian': '✓ Već ste povezani s operaterom.',
                    'Italian': '✓ Sei già connesso a un operatore.',
                    'German': '✓ Sie sind bereits mit einem Operator verbunden.'
                };

                return res.json({
                    response: alreadyOperatorMessage[session.language] || alreadyOperatorMessage['English'],
                    operatorMode: true
                });
            }
            // If not in operator mode, fall through to trigger operator below
        }

        // Check if in operator mode
        if (session.operatorMode) {
            // Always translate to Russian for operator (except if already Russian)
            const translatedMessage = session.language === 'Russian'
                ? message
                : await translateToRussian(message, session.language);

            // Always show Russian translation to operator
            const displayMessage = translatedMessage;
            const clientInfo = session.userName || `Customer${session.customerNumber}`;
            const notification = `💬 *NOVO SPOROČILO*\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `👤 ${clientInfo} (${session.language || 'Slovenian'}):\n\n` +
                `"${displayMessage}"\n\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `Session: \`${sessionId}\``;

            if (bot && OPERATOR_CHAT_ID) {
                try {
                    const messageOptions = {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🔄 V AI / To AI', callback_data: `close_${sessionId}` },
                                { text: '🗑️ Izbriši / Delete', callback_data: `delete_${sessionId}` }
                            ]]
                        }
                    };

                    // If this session already has a thread, reply to it
                    if (session.telegramThreadId) {
                        messageOptions.reply_to_message_id = session.telegramThreadId;
                    }

                    const sentMessage = await bot.sendMessage(OPERATOR_CHAT_ID, notification, messageOptions);

                    // Store message ID for thread tracking (use first message as thread root)
                    if (!session.telegramThreadId) {
                        session.telegramThreadId = sentMessage.message_id;
                    }
                    telegramMessageToSession.set(sentMessage.message_id, sessionId);
                } catch (telegramError) {
                    console.error('Telegram notification failed:', telegramError.message);
                }
            }

            return res.json({
                response: '✓✓',
                operatorMode: true
            });
        }

        // Check if should trigger operator (by keyword or command)
        if (command === '/operator' || command === '/live' || shouldTriggerOperator(message)) {
            // Check if operator is available (6:00-23:00 Ljubljana time)
            if (!isOperatorAvailable()) {
                console.log('Operator requested but unavailable (outside working hours)');
                return res.json({
                    response: getOperatorUnavailableMessage(session.language),
                    operatorMode: false
                });
            }

            // If user doesn't have a name yet, ask for it first
            if (!session.userName) {
                session.awaitingNameForOperator = true;
                session.pendingOperatorRequest = message; // Save original message

                const askNameMessages = {
                    'English': '👋 Before connecting you with our operator, how should I address you? Please share your name.',
                    'Slovenian': '👋 Preden vas povežem z našim operaterjem, kako naj vas naslovim? Prosim, delite svoje ime.',
                    'Russian': '👋 Прежде чем соединить вас с оператором, как мне к вам обращаться? Пожалуйста, назовите ваше имя.',
                    'Ukrainian': '👋 Перш ніж з\'єднати вас з оператором, як мені до вас звертатися? Будь ласка, назвіть ваше ім\'я.',
                    'Croatian': '👋 Prije nego vas povežem s našim operaterom, kako da vas oslovljavam? Molim podijelite svoje ime.',
                    'Serbian': '👋 Pre nego što vas povežem s našim operatorom, kako da vas oslovljavam? Molim podelite svoje ime.',
                    'Italian': '👋 Prima di collegarti con il nostro operatore, come dovrei rivolgermi a te? Per favore, condividi il tuo nome.',
                    'German': '👋 Bevor ich Sie mit unserem Operator verbinde, wie soll ich Sie ansprechen? Bitte teilen Sie mir Ihren Namen mit.'
                };

                return res.json({
                    response: askNameMessages[session.language] || askNameMessages['English'],
                    operatorMode: false
                });
            }

            // If already has name, proceed with operator connection
            session.operatorMode = true;

            // Always translate to Russian for operator (except if already Russian)
            const translatedMessage = session.language === 'Russian'
                ? message
                : await translateToRussian(message, session.language);

            // Notify operator via Telegram (always in Russian)
            const clientInfo = session.userName || `Customer${session.customerNumber}`;
            const notification = `🔔 *ЗАПРОС ОПЕРАТОРА*\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `👤 ${clientInfo} (${session.language || 'Slovenian'}):\n\n` +
                `"${translatedMessage}"\n\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `Session: \`${sessionId}\``;

            if (bot && OPERATOR_CHAT_ID) {
                try {
                    const messageOptions = {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🔄 В AI / To AI', callback_data: `close_${sessionId}` },
                                { text: '🗑️ Удалить / Delete', callback_data: `delete_${sessionId}` }
                            ]]
                        }
                    };

                    // If this session already has a thread, reply to it
                    if (session.telegramThreadId) {
                        messageOptions.reply_to_message_id = session.telegramThreadId;
                    }

                    const sentMessage = await bot.sendMessage(OPERATOR_CHAT_ID, notification, messageOptions);

                    // Store message ID for thread tracking (use first message as thread root)
                    if (!session.telegramThreadId) {
                        session.telegramThreadId = sentMessage.message_id;
                    }
                    telegramMessageToSession.set(sentMessage.message_id, sessionId);
                } catch (telegramError) {
                    console.error('Telegram notification failed:', telegramError.message);
                }
            }

            return res.json({
                response: getOperatorConnectMessage(session.language),
                operatorMode: true
            });
        }

        // Handle user name after first message
        if (!session.askedForName && session.messages.length === 2) {
            // This is the second message - save user's name
            const userName = message.trim();

            if (userName && userName.length > 0 && userName.length < 50) {
                // User provided a name
                session.userName = userName;
                console.log(`User name set to: ${userName}`);
            } else {
                // No valid name provided, use default
                session.userName = `Customer${session.customerNumber}`;
                console.log(`Using default name: ${session.userName}`);
            }
        }

        // Mark that we asked for name after first message
        if (session.messages.length === 1 && !session.askedForName) {
            session.askedForName = true;
        }

        // Detect language from first user message
        if (session.messages.length === 1) {
            try {
                const languageDetectionResponse = await anthropic.messages.create({
                    model: 'claude-3-haiku-20240307',
                    max_tokens: 50,
                    messages: [{
                        role: 'user',
                        content: `Detect the language of this text and respond with ONLY the language name in English (e.g., "Slovenian", "English", "Russian", "Croatian", "Serbian", "Italian", "German", "Spanish", "French", "Ukrainian", "Polish", "Czech", etc.):\n\n"${message}"`
                    }]
                });

                const detectedLanguage = languageDetectionResponse.content[0].text.trim();
                console.log(`Detected language: ${detectedLanguage} from message: "${message}"`);

                // Check if language detection returned something valid
                // (should be a single word, max 20 characters)
                if (detectedLanguage && detectedLanguage.length > 0 && detectedLanguage.length < 20 && !detectedLanguage.includes(' ')) {
                    session.language = detectedLanguage;
                    console.log(`Language set to: ${detectedLanguage}`);
                } else {
                    // Language detection failed or returned invalid value
                    console.log(`Invalid language detected: "${detectedLanguage}", defaulting to English`);
                    session.language = 'English';

                    // Send error message in English
                    const errorMessage = '⚠️ Sorry, we could not detect your language. Please continue in English.';
                    session.messages.push({
                        role: 'assistant',
                        content: errorMessage,
                        timestamp: new Date()
                    });

                    return res.json({
                        response: errorMessage,
                        operatorMode: false
                    });
                }
            } catch (error) {
                console.error('Language detection error:', error);
                session.language = 'English'; // Fallback to English

                // Send error message in English
                const errorMessage = '⚠️ Sorry, we could not detect your language. Please continue in English.';
                session.messages.push({
                    role: 'assistant',
                    content: errorMessage,
                    timestamp: new Date()
                });

                return res.json({
                    response: errorMessage,
                    operatorMode: false
                });
            }
        }

        // Get AI response from Claude
        const response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 500,
            system: getSystemPrompt(session.language, session.userName, session.askedForName),
            messages: session.messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }))
        });

        const assistantMessage = response.content[0].text;

        // Check if Claude wants to trigger operator
        if (assistantMessage.includes('TRIGGER_OPERATOR:')) {
            // Check if operator is available (6:00-23:00 Ljubljana time)
            if (!isOperatorAvailable()) {
                console.log('AI triggered operator but unavailable (outside working hours)');
                // Remove assistant message with TRIGGER_OPERATOR from history
                session.messages.pop();
                // Return unavailability message instead
                return res.json({
                    response: getOperatorUnavailableMessage(session.language),
                    operatorMode: false
                });
            }

            session.operatorMode = true;

            // Always translate to Russian for operator (except if already Russian)
            const translatedMessage = session.language === 'Russian'
                ? message
                : await translateToRussian(message, session.language);

            // Build conversation history (last 5 messages) - always translate to Russian
            const historyPromises = session.messages.slice(-5).map(async msg => {
                const icon = msg.role === 'user' ? '👤' : '🤖';
                let text = msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content;

                // Always translate history to Russian (except if already Russian)
                if (session.language !== 'Russian') {
                    text = await translateToRussian(text, session.language);
                }

                return `${icon}: ${text}`;
            });
            const historyMessages = (await Promise.all(historyPromises)).join('\n');

            // Notify operator
            const clientInfo = session.userName || `Customer${session.customerNumber}`;
            const notification = `🔔 *ЗАПРОС ОПЕРАТОРА*\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `👤 ${clientInfo} (${session.language || 'Slovenian'}):\n\n` +
                `"${translatedMessage}"\n\n` +
                `📝 История разговора:\n${historyMessages}\n\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `Session: \`${sessionId}\``;

            if (bot && OPERATOR_CHAT_ID) {
                try {
                    const messageOptions = {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🔄 В AI / To AI', callback_data: `close_${sessionId}` },
                                { text: '🗑️ Удалить / Delete', callback_data: `delete_${sessionId}` }
                            ]]
                        }
                    };

                    // If this session already has a thread, reply to it
                    if (session.telegramThreadId) {
                        messageOptions.reply_to_message_id = session.telegramThreadId;
                    }

                    const sentMessage = await bot.sendMessage(OPERATOR_CHAT_ID, notification, messageOptions);

                    // Store message ID for thread tracking (use first message as thread root)
                    if (!session.telegramThreadId) {
                        session.telegramThreadId = sentMessage.message_id;
                    }
                    telegramMessageToSession.set(sentMessage.message_id, sessionId);
                } catch (telegramError) {
                    console.error('Telegram notification failed:', telegramError.message);
                }
            }

            return res.json({
                response: getOperatorConnectMessage(session.language),
                operatorMode: true
            });
        }

        // Add assistant response to session
        const assistantMsg = {
            role: 'assistant',
            content: assistantMessage,
            timestamp: new Date()
        };
        session.messages.push(assistantMsg);

        // Log assistant message to Planfix (async)
        if (session.planfixTaskId) {
            logMessageToPlanfix(session, assistantMsg, 'AI Assistant')
                .catch(err => console.error('Failed to log AI response to Planfix:', err));
        }

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

            // Update last user message time for inactivity tracking
            session.lastUserMessageTime = new Date();

            // Add photo message to session
            session.messages.push({
                role: 'user',
                content: '[Фото]',
                photo: photoUrl,
                timestamp: new Date()
            });

            // Automatically switch to operator mode when photo is sent
            if (!session.operatorMode) {
                // Check if operator is available
                if (!isOperatorAvailable()) {
                    console.log('Photo sent but operator unavailable (outside working hours)');
                    return res.json({
                        response: getOperatorUnavailableMessage(session.language),
                        operatorMode: false
                    });
                }

                session.operatorMode = true;
            }

            // Send photo to operator via Telegram
            if (bot && OPERATOR_CHAT_ID) {
                const clientInfo = session.userName || `Customer${session.customerNumber}`;
                const notification = `📸 *ФОТО ОТ КЛИЕНТА*\n` +
                    `━━━━━━━━━━━━━━━━━\n` +
                    `👤 ${clientInfo} (${session.language || 'Slovenian'})\n` +
                    `Session: \`${sessionId}\``;

                try {
                    const photoOptions = {
                        caption: notification,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🔄 V AI / To AI', callback_data: `close_${sessionId}` },
                                { text: '🗑️ Izbriši / Delete', callback_data: `delete_${sessionId}` }
                            ]]
                        }
                    };

                    // If this session already has a thread, reply to it
                    if (session.telegramThreadId) {
                        photoOptions.reply_to_message_id = session.telegramThreadId;
                    }

                    const sentMessage = await bot.sendPhoto(OPERATOR_CHAT_ID, photoPath, photoOptions);

                    // Store message ID for thread tracking (use first message as thread root)
                    if (!session.telegramThreadId) {
                        session.telegramThreadId = sentMessage.message_id;
                    }
                    telegramMessageToSession.set(sentMessage.message_id, sessionId);
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

    console.log(`📥 POLLING REQUEST for session ${sessionId}`);
    console.log(`   - lastMessageTime: ${lastMessageTime}`);

    const session = sessions.get(sessionId);
    if (!session) {
        console.log(`   ❌ Session not found`);
        return res.json({ messages: [] });
    }

    const lastTime = lastMessageTime ? new Date(lastMessageTime) : new Date(0);
    console.log(`   - lastTime parsed: ${lastTime.toISOString()}`);
    console.log(`   - Total messages in session: ${session.messages.length}`);

    // Log all assistant messages with timestamps
    const assistantMessages = session.messages.filter(msg => msg.role === 'assistant');
    console.log(`   - Assistant messages count: ${assistantMessages.length}`);
    assistantMessages.forEach((msg, idx) => {
        const isNew = msg.timestamp > lastTime;
        console.log(`     [${idx}] ${isNew ? '✅ NEW' : '⏭️ OLD'} - ${msg.timestamp.toISOString()} - ${msg.content.substring(0, 30)}...`);
    });

    const newMessages = session.messages
        .filter(msg => msg.timestamp > lastTime && msg.role === 'assistant')
        .map(msg => ({
            content: msg.content,
            photo: msg.photo || null,
            timestamp: msg.timestamp
        }));

    console.log(`   📤 Returning ${newMessages.length} new messages, operatorMode: ${session.operatorMode}`);
    res.json({
        messages: newMessages,
        operatorMode: session.operatorMode
    });
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

            // Handle menu button - sessions
            if (data === 'menu_sessions') {
                if (chatId.toString() !== OPERATOR_CHAT_ID) {
                    return res.sendStatus(200);
                }

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

                let message = '';
                if (allSessions.length === 0) {
                    message = '📭 Ni aktivnih sej / No sessions in memory';
                } else if (activeSessions.length === 0) {
                    message = `*Vse seje / All sessions (${allSessions.length}):*\n\n${allSessions.join('\n')}\n\n` +
                        `⚠️ Nobena seja ni v operator mode / No sessions in operator mode`;
                } else {
                    message = `*Vse seje / All sessions (${allSessions.length}):*\n\n${allSessions.join('\n')}\n\n` +
                        `*Aktivne seje / Active (${activeSessions.length}):*\n\n${activeSessions.join('\n')}`;
                }

                try {
                    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                } catch (sendError) {
                    console.error('Error sending sessions list:', sendError.message);
                }
                return res.sendStatus(200);
            }

            // Handle menu button - closeall
            if (data === 'menu_closeall') {
                if (chatId.toString() !== OPERATOR_CHAT_ID) {
                    return res.sendStatus(200);
                }

                const sessionCount = sessions.size;
                if (sessionCount === 0) {
                    try {
                        await bot.sendMessage(chatId, 'ℹ️ Ni aktivnih sej / No active sessions');
                    } catch (sendError) {
                        console.error('Error sending message:', sendError.message);
                    }
                    return res.sendStatus(200);
                }

                // Send goodbye message to all users and delete all sessions
                let closedCount = 0;
                for (const [sessionId, session] of sessions.entries()) {
                    try {
                        session.messages.push({
                            role: 'assistant',
                            content: getGoodbyeMessage(session.language),
                            timestamp: new Date(),
                            fromOperator: true
                        });
                        closedCount++;
                    } catch (error) {
                        console.error(`Error closing session ${sessionId}:`, error);
                    }
                }

                telegramMessageToSession.clear();
                sessions.clear();

                try {
                    await bot.sendMessage(chatId,
                        `✅ Izbrisano ${closedCount} sej / Deleted ${closedCount} sessions\n\n` +
                        `Vse seje so odstranjene iz spomina / All sessions removed from memory`
                    );
                } catch (sendError) {
                    console.error('Error sending closeall confirmation:', sendError.message);
                }
                return res.sendStatus(200);
            }

            // Handle menu button - refresh
            if (data === 'menu_refresh') {
                if (chatId.toString() !== OPERATOR_CHAT_ID) {
                    return res.sendStatus(200);
                }

                try {
                    await bot.editMessageText(
                        `🎛️ *Operator Control Panel / Панель оператора*\n\n` +
                        `Используйте кнопки ниже для управления сессиями:\n` +
                        `Use buttons below to manage sessions:\n\n` +
                        `🔄 Обновлено / Refreshed: ${new Date().toLocaleTimeString('sl-SI', { timeZone: 'Europe/Ljubljana' })}`,
                        {
                            chat_id: chatId,
                            message_id: callbackQuery.message.message_id,
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📋 Активные сессии / Sessions', callback_data: 'menu_sessions' }
                                    ],
                                    [
                                        { text: '🗑️ Закрыть все / Close All', callback_data: 'menu_closeall' }
                                    ],
                                    [
                                        { text: '🔄 Обновить меню / Refresh', callback_data: 'menu_refresh' }
                                    ]
                                ]
                            }
                        }
                    );
                } catch (sendError) {
                    console.error('Error refreshing menu:', sendError.message);
                }
                return res.sendStatus(200);
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
                    content: getGoodbyeMessage(session.language),
                    timestamp: new Date(),
                    fromOperator: true
                });

                // Exit operator mode
                session.operatorMode = false;

                // Close Planfix task (async)
                closePlanfixTask(session).catch(err => console.error('Failed to close Planfix task:', err));

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

            // Handle delete button
            if (data.startsWith('delete_')) {
                const sessionId = data.substring(7); // Remove 'delete_' prefix
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
                    content: getGoodbyeMessage(session.language),
                    timestamp: new Date(),
                    fromOperator: true
                });

                // Clean up telegram message mappings for this session
                for (const [messageId, sid] of telegramMessageToSession.entries()) {
                    if (sid === sessionId) {
                        telegramMessageToSession.delete(messageId);
                    }
                }

                // Delete session from memory
                sessions.delete(sessionId);

                console.log(`Session ${sessionId} deleted via button by operator`);
                try {
                    await bot.sendMessage(chatId,
                        `🗑️ Seja ${sessionId} izbrisana / Session deleted\n\n` +
                        `Seja je odstranjena iz spomina / Session removed from memory`
                    );
                } catch (sendError) {
                    console.error('Error sending delete confirmation:', sendError.message);
                }
            }

            return res.sendStatus(200);
        }

        // Handle incoming messages
        if (update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            let text = msg.text || '';

            // Ignore messages from the bot itself
            if (msg.from && msg.from.is_bot) {
                console.log(`Ignoring message from bot`);
                return res.sendStatus(200);
            }

            // Remove bot mention from commands (e.g., /sessions@botname -> /sessions)
            text = text.replace(/@\w+/, '');

            console.log(`Received message from ${chatId}: ${text}`);
            console.log(`Has reply_to_message: ${!!msg.reply_to_message}`);

            // Handle reply to notification (easy way to respond to user)
            // Skip if message is a command (starts with /)
            if (msg.reply_to_message && (msg.reply_to_message.text || msg.reply_to_message.caption) && !text.startsWith('/')) {
                console.log(`Message is a reply to message ID: ${msg.reply_to_message.message_id}`);
                console.log(`Chat type: ${msg.chat.type}, Chat ID: ${chatId}, OPERATOR_CHAT_ID: ${OPERATOR_CHAT_ID}`);

                // Check if this is from the operator group/chat
                const isOperatorChat = chatId.toString() === OPERATOR_CHAT_ID;

                if (isOperatorChat) {
                    let sessionId = null;

                    // Method 1: Try to get session ID from message ID mapping (for threaded group messages)
                    if (msg.reply_to_message.from && msg.reply_to_message.from.is_bot) {
                        sessionId = telegramMessageToSession.get(msg.reply_to_message.message_id);
                        console.log(`Method 1 (message map): ${sessionId || 'not found'}`);
                    }

                    // Method 2: Fallback to extracting session ID from reply text (backward compatibility)
                    if (!sessionId) {
                        const replyText = msg.reply_to_message.text || msg.reply_to_message.caption;
                        if (replyText) {
                            const sessionIdMatch = replyText.match(/Session: `?(session-[a-z0-9]+)`?/);
                            if (sessionIdMatch) {
                                sessionId = sessionIdMatch[1];
                                console.log(`Method 2 (regex from text): ${sessionId}`);
                            }
                        }
                    }

                    if (sessionId) {
                        const session = sessions.get(sessionId);

                        if (!session) {
                            try {
                                await bot.sendMessage(chatId, `❌ Seja ${sessionId} več ne obstaja / Session no longer exists`, {
                                    reply_to_message_id: msg.message_id
                                });
                            } catch (sendError) {
                                console.error('Error sending message:', sendError.message);
                            }
                            return res.sendStatus(200);
                        }

                        // Get operator's first name from Telegram
                        const operatorName = msg.from && msg.from.first_name ? msg.from.first_name : 'Оператор';

                        // Translate operator's message to user's language
                        const userLanguage = session.language || 'English';
                        const translatedText = await translateToLanguage(text, userLanguage);
                        console.log(`Translating operator response from Russian to ${userLanguage}`);

                        // Add operator's message to session (in user's language)
                        const messageTimestamp = new Date();
                        const operatorMsg = {
                            role: 'assistant',
                            content: translatedText,
                            timestamp: messageTimestamp,
                            fromOperator: true
                        };
                        session.messages.push(operatorMsg);

                        // Log operator message to Planfix (async)
                        if (session.planfixTaskId) {
                            logMessageToPlanfix(session, operatorMsg, operatorName)
                                .catch(err => console.error('Failed to log operator message to Planfix:', err));
                        }

                        console.log(`✅ OPERATOR MESSAGE ADDED TO SESSION ${sessionId}`);
                        console.log(`   - Content: ${translatedText.substring(0, 50)}...`);
                        console.log(`   - Timestamp: ${messageTimestamp.toISOString()}`);
                        console.log(`   - Role: assistant`);
                        console.log(`   - Total messages in session: ${session.messages.length}`);
                        try {
                            await bot.sendMessage(chatId, `✅ Sporočilo poslano / Message sent`, {
                                reply_to_message_id: msg.message_id
                            });
                        } catch (sendError) {
                            console.error('Error sending confirmation:', sendError.message);
                        }

                        return res.sendStatus(200);
                    }
                }
            }

            // Handle photo from operator (skip if caption is a command)
            if (msg.photo && msg.photo.length > 0 && !text.startsWith('/')) {
                const isOperatorChat = chatId.toString() === OPERATOR_CHAT_ID;
                let sessionId = null;

                // Try to find session ID from reply message mapping
                if (msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.is_bot) {
                    sessionId = telegramMessageToSession.get(msg.reply_to_message.message_id);
                    console.log(`Found session ID from photo reply: ${sessionId}`);
                }

                if (!sessionId && isOperatorChat) {
                    // If not a reply, ask operator to specify session
                    try {
                        await bot.sendMessage(chatId, '❌ Prosimo odgovorite (reply) na sporočilo uporabnika da pošljete fotografijo\n\nPlease reply to user\'s message to send photo', {
                            reply_to_message_id: msg.message_id
                        });
                    } catch (sendError) {
                        console.error('Error sending message:', sendError.message);
                    }
                    return res.sendStatus(200);
                }

                if (sessionId && isOperatorChat) {
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
                                fs.unlink(photoPath, () => { });
                                reject(err);
                            });
                        });

                        // Get operator's first name from Telegram
                        const operatorName = msg.from && msg.from.first_name ? msg.from.first_name : 'Оператор';

                        // Add photo to session
                        const photoMsg = {
                            role: 'assistant',
                            content: '[Фото от оператора]',
                            photo: `/uploads/${photoFilename}`,
                            timestamp: new Date(),
                            fromOperator: true
                        };
                        session.messages.push(photoMsg);

                        // Log photo message to Planfix (async)
                        if (session.planfixTaskId) {
                            logMessageToPlanfix(session, photoMsg, operatorName)
                                .catch(err => console.error('Failed to log photo to Planfix:', err));
                        }

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
                        `*Быстрые команды:*\n` +
                        `Используйте команду /menu для панели управления\n` +
                        `Use /menu command for control panel`,
                        {
                            parse_mode: 'Markdown'
                        }
                    );
                } catch (sendError) {
                    console.error('Error sending start message:', sendError.message);
                }
                return res.sendStatus(200);
            }

            // Handle menu command - show control panel with inline buttons
            if (text === '/menu' || text === 'menu' || text === 'Menu' || text === 'MENU') {
                if (chatId.toString() !== OPERATOR_CHAT_ID) {
                    return res.sendStatus(200);
                }

                try {
                    await bot.sendMessage(chatId,
                        `🎛️ *Operator Control Panel / Панель оператора*\n\n` +
                        `Используйте кнопки ниже для управления сессиями:\n` +
                        `Use buttons below to manage sessions:`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📋 Активные сессии / Sessions', callback_data: 'menu_sessions' }
                                    ],
                                    [
                                        { text: '🗑️ Закрыть все / Close All', callback_data: 'menu_closeall' }
                                    ],
                                    [
                                        { text: '🔄 Обновить меню / Refresh', callback_data: 'menu_refresh' }
                                    ]
                                ]
                            }
                        }
                    );
                } catch (sendError) {
                    console.error('Error sending menu:', sendError.message);
                }
                return res.sendStatus(200);
            }

            // Handle sessions command
            if (text === '/sessions' || text === 'sessions' || text === 'Sessions' || text === 'SESSIONS') {
                if (chatId.toString() !== OPERATOR_CHAT_ID) {
                    return res.sendStatus(200);
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
                return res.sendStatus(200);
            }

            // Handle /reply command
            if (text.startsWith('/reply ')) {
                if (chatId.toString() !== OPERATOR_CHAT_ID) {
                    try {
                        await bot.sendMessage(chatId, '⛔ Nimate dostopa / Access denied');
                    } catch (err) {
                        console.error('Error sending access denied:', err.message);
                    }
                    return res.sendStatus(200);
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

                // Get operator's first name from Telegram
                const operatorName = msg.from && msg.from.first_name ? msg.from.first_name : 'Оператор';

                // Translate operator's message to user's language
                const userLanguage = session.language || 'English';
                const translatedMessage = await translateToLanguage(message, userLanguage);
                console.log(`Translating operator response from Russian to ${userLanguage}`);

                // Add operator message to session (in user's language)
                const operatorMsg = {
                    role: 'assistant',
                    content: translatedMessage,
                    timestamp: new Date(),
                    fromOperator: true
                };
                session.messages.push(operatorMsg);

                // Log operator message to Planfix (async)
                if (session.planfixTaskId) {
                    logMessageToPlanfix(session, operatorMsg, operatorName)
                        .catch(err => console.error('Failed to log operator message to Planfix:', err));
                }

                console.log(`Message added to session ${sessionId}`);
                try {
                    await bot.sendMessage(chatId, `✅ Sporočilo poslano / Message sent to session ${sessionId}`);
                } catch (sendError) {
                    console.error('Error sending success message:', sendError.message);
                }
                return res.sendStatus(200);
            }

            // Handle /close command
            if (text.startsWith('/close ')) {
                if (chatId.toString() !== OPERATOR_CHAT_ID) {
                    try {
                        await bot.sendMessage(chatId, '⛔ Nimate dostopa / Access denied');
                    } catch (err) {
                        console.error('Error sending access denied:', err.message);
                    }
                    return res.sendStatus(200);
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
                    content: getGoodbyeMessage(session.language),
                    timestamp: new Date(),
                    fromOperator: true
                });

                // Exit operator mode
                session.operatorMode = false;

                // Close Planfix task (async)
                closePlanfixTask(session).catch(err => console.error('Failed to close Planfix task:', err));

                console.log(`Session ${sessionId} closed by operator`);
                try {
                    await bot.sendMessage(chatId,
                        `✅ Seja ${sessionId} zaprta / Session closed\n\n` +
                        `Uporabnik je vrnjen v AI chat / User returned to AI chat`
                    );
                } catch (sendError) {
                    console.error('Error sending close confirmation:', sendError.message);
                }
                return res.sendStatus(200);
            }

            // Handle closeall command
            if (text === '/closeall' || text === 'closeall' || text === 'Closeall' || text === 'CLOSEALL' || text === 'close all') {
                if (chatId.toString() !== OPERATOR_CHAT_ID) {
                    return res.sendStatus(200);
                }

                const sessionCount = sessions.size;

                if (sessionCount === 0) {
                    try {
                        await bot.sendMessage(chatId, 'ℹ️ Ni aktivnih sej / No active sessions');
                    } catch (sendError) {
                        console.error('Error sending message:', sendError.message);
                    }
                    return;
                }

                // Send goodbye message to all users and delete all sessions
                let closedCount = 0;
                for (const [sessionId, session] of sessions.entries()) {
                    try {
                        // Send goodbye message to user
                        session.messages.push({
                            role: 'assistant',
                            content: getGoodbyeMessage(session.language),
                            timestamp: new Date(),
                            fromOperator: true
                        });

                        closedCount++;
                    } catch (error) {
                        console.error(`Error closing session ${sessionId}:`, error);
                    }
                }

                // Clean up all telegram message mappings
                telegramMessageToSession.clear();

                // Delete all sessions from memory
                sessions.clear();

                console.log(`Closed and deleted ${closedCount} sessions`);
                try {
                    await bot.sendMessage(chatId,
                        `✅ Izbrisano ${closedCount} sej / Deleted ${closedCount} sessions\n\n` +
                        `Vse seje so odstranjene iz spomina / All sessions removed from memory`
                    );
                } catch (sendError) {
                    console.error('Error sending closeall confirmation:', sendError.message);
                }
                return res.sendStatus(200);
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

        // Clear all bot commands for all scopes
        await bot.setMyCommands([]);
        await bot.setMyCommands([], { scope: { type: 'all_private_chats' } });
        await bot.setMyCommands([], { scope: { type: 'all_group_chats' } });
        if (OPERATOR_CHAT_ID) {
            await bot.setMyCommands([], { scope: { type: 'chat', chat_id: OPERATOR_CHAT_ID } });
        }
        console.log('All bot commands cleared for all scopes');

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Set webhook again
        const webhookUrl = `https://claude-production-e0ea.up.railway.app/telegram/webhook`;
        await bot.setWebHook(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);

        // Get webhook info
        const info = await bot.getWebHookInfo();

        res.json({
            success: true,
            message: 'Webhook reset successfully, all commands cleared',
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

// Debug endpoint to check loaded website content
app.get('/api/debug/content', (req, res) => {
    res.json({
        lastUpdated: websiteContent.lastUpdated,
        info: websiteContent.info,
        infoLength: websiteContent.info.length
    });
});

// Auto-close inactive sessions after 5 minutes of user inactivity
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

async function checkInactiveSessions() {
    const now = new Date();
    console.log(`⏰ Checking for inactive sessions... (${sessions.size} total sessions)`);

    for (const [sessionId, session] of sessions.entries()) {
        // Only check sessions in operator mode
        if (!session.operatorMode) continue;

        // Check if session has been inactive for more than 5 minutes
        const inactiveTime = now - session.lastUserMessageTime;

        if (inactiveTime >= INACTIVITY_TIMEOUT) {
            console.log(`⏰ Session ${sessionId} inactive for ${Math.floor(inactiveTime / 1000 / 60)} minutes - closing...`);

            // Send timeout message to user
            const timeoutMessage = {
                'English': '⏰ Session closed due to inactivity. Type /live if you need help.',
                'Slovenian': '⏰ Seja zaprta zaradi neaktivnosti. Vnesite /live če potrebujete pomoč.',
                'Russian': '⏰ Сессия закрыта из-за неактивности. Введите /live если нужна помощь.',
                'Ukrainian': '⏰ Сесію закрито через неактивність. Введіть /live якщо потрібна допомога.',
                'Croatian': '⏰ Sesija zatvorena zbog neaktivnosti. Unesite /live ako trebate pomoć.',
                'Serbian': '⏰ Sesija zatvorena zbog neaktivnosti. Unesite /live ako trebate pomoć.',
                'Italian': '⏰ Sessione chiusa per inattività. Digita /live se hai bisogno di aiuto.',
                'German': '⏰ Sitzung wegen Inaktivität geschlossen. Geben Sie /live ein, wenn Sie Hilfe benötigen.'
            };

            session.messages.push({
                role: 'assistant',
                content: timeoutMessage[session.language] || timeoutMessage['English'],
                timestamp: new Date(),
                fromOperator: true
            });

            // Notify operator in Telegram
            if (bot && OPERATOR_CHAT_ID) {
                try {
                    await bot.sendMessage(OPERATOR_CHAT_ID,
                        `⏰ *СЕССИЯ ЗАКРЫТА - НЕАКТИВНОСТЬ*\n` +
                        `━━━━━━━━━━━━━━━━━\n` +
                        `📝 Session ID: \`${sessionId}\`\n` +
                        `⏱️ Неактивность: ${Math.floor(inactiveTime / 1000 / 60)} минут\n\n` +
                        `Сессия автоматически закрыта из-за отсутствия сообщений от пользователя.\n` +
                        `Session automatically closed - no messages from user.`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (error) {
                    console.error('Error notifying operator about timeout:', error);
                }
            }

            // Exit operator mode
            session.operatorMode = false;

            // Close Planfix task (async)
            closePlanfixTask(session).catch(err => console.error('Failed to close Planfix task:', err));

            console.log(`✅ Session ${sessionId} closed due to inactivity`);
        }
    }
}

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

            // Set up bot commands for operator chat (group)
            if (OPERATOR_CHAT_ID) {
                const operatorCommands = [
                    { command: 'start', description: 'Show bot info and Chat ID' },
                    { command: 'menu', description: 'Open operator control panel' },
                    { command: 'sessions', description: 'Show active sessions' },
                    { command: 'reply', description: 'Reply to user: /reply [sessionId] [message]' },
                    { command: 'close', description: 'Close session: /close [sessionId]' },
                    { command: 'closeall', description: 'Close all sessions' }
                ];

                await bot.setMyCommands(operatorCommands, {
                    scope: { type: 'chat', chat_id: OPERATOR_CHAT_ID }
                });
                console.log(`📋 Bot commands set for operator chat: ${OPERATOR_CHAT_ID}`);
                console.log(`   Commands: ${operatorCommands.map(c => '/' + c.command).join(', ')}`);
            }

            // Clear commands for other chats (so menu button doesn't appear there)
            await bot.setMyCommands([]);
            console.log(`📋 Bot commands cleared for other chats`);

            console.log(`💬 Bot ready to receive notifications`);
        } catch (error) {
            console.error('Failed to set Telegram webhook:', error.message);
            console.log(`📱 Telegram bot: notifications may not work`);
        }
    } else {
        console.log(`📱 Telegram bot: disabled`);
    }

    // Start checking for inactive sessions every minute
    setInterval(checkInactiveSessions, 60 * 1000);
    console.log(`⏰ Inactivity checker started: sessions will auto-close after 5 minutes of user inactivity`);
});
