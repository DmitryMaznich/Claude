# 📱 Схема интеграции статусов сообщений с Telegram Bot API

## 🏗️ Архитектура системы

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Browser   │◄────────┤   Backend    │◄────────┤  Telegram Bot   │
│  (Frontend) │  HTTP   │   Server     │  HTTPS  │      API        │
└─────────────┘ Polling └──────────────┘ Webhook └─────────────────┘
                2 sec          │                         │
                               │                         │
                               ▼                         ▼
                        ┌──────────────┐         ┌─────────────────┐
                        │   Database   │         │  Telegram Chat  │
                        │  (Messages)  │         │  with Operator  │
                        └──────────────┘         └─────────────────┘
```

---

## 📊 Статусы сообщений

### Lifecycle сообщения:

```
1. SENDING     ⏳ (фронтенд отправляет)
2. SENT        ✓  (получено бэкендом)
3. DELIVERED   ✓✓ (доставлено в Telegram оператору)
4. READ        ✓✓ (прочитано оператором) - синие галочки
```

---

## 🗄️ Структура данных

### База данных - Message Schema:

```javascript
{
  messageId: "uuid-v4",              // Уникальный ID сообщения
  sessionId: "session-uuid",         // ID сессии пользователя
  content: "Текст сообщения",
  sender: "user" | "bot" | "operator",
  timestamp: "2024-02-13T10:30:00Z",

  // Статусы
  status: "sending" | "sent" | "delivered" | "read",
  statusTimestamps: {
    sent: "2024-02-13T10:30:00Z",
    delivered: "2024-02-13T10:30:05Z",
    read: "2024-02-13T10:30:15Z"
  },

  // Telegram интеграция
  telegramMessageId: 12345,          // ID сообщения в Telegram
  telegramChatId: -1001234567890,    // ID чата с оператором

  // Метаданные
  isOperatorMode: false,
  attachments: []
}
```

---

## 🔌 API Endpoints (Backend)

### 1. **POST /api/chat** - Отправка сообщения
```javascript
// Request
{
  sessionId: "uuid",
  message: "Текст",
  operatorMode: false
}

// Response
{
  messageId: "uuid",           // ID сообщения для отслеживания
  status: "sent",              // Начальный статус
  response: "Ответ бота",
  operatorMode: false
}
```

### 2. **GET /api/messages/:sessionId** - Polling новых сообщений
```javascript
// Request
GET /api/messages/uuid-session?lastMessageTime=2024-02-13T10:30:00Z

// Response
{
  messages: [
    {
      messageId: "uuid",
      content: "Текст",
      sender: "operator",
      timestamp: "2024-02-13T10:30:05Z"
    }
  ],

  // Статусы для обновления
  statusUpdates: [
    {
      messageId: "uuid-user-message",
      status: "delivered",
      timestamp: "2024-02-13T10:30:05Z"
    },
    {
      messageId: "uuid-user-message-2",
      status: "read",
      timestamp: "2024-02-13T10:30:15Z"
    }
  ],

  operatorMode: true
}
```

### 3. **POST /api/webhook/telegram** - Webhook от Telegram
```javascript
// Telegram отправляет update при событиях
{
  update_id: 123456,
  message: {
    message_id: 12345,
    from: { id: 987654321, username: "operator" },
    chat: { id: -1001234567890 },
    date: 1707825600,
    text: "Ответ оператора"
  }
}

// ИЛИ для статуса "прочитано"
{
  update_id: 123457,
  message_reaction: {
    chat: { id: -1001234567890 },
    message_id: 12345,
    date: 1707825615,
    old_reaction: [],
    new_reaction: [{ type: "emoji", emoji: "👀" }]
  }
}
```

---

## 🤖 Telegram Bot API Integration

### Методы которые нужно использовать:

#### 1. **sendMessage** - Отправка сообщения оператору
```javascript
POST https://api.telegram.org/bot<TOKEN>/sendMessage
{
  chat_id: -1001234567890,  // ID группы/чата с операторами
  text: "Новое сообщение от пользователя:\n\nТекст...",
  reply_markup: {
    inline_keyboard: [[
      { text: "✓ Прочитано", callback_data: "read_uuid-message" }
    ]]
  }
}

// Response
{
  ok: true,
  result: {
    message_id: 12345,  // ВАЖНО: сохранить для отслеживания
    date: 1707825600
  }
}
```

#### 2. **getUpdates** или **setWebhook** - Получение обновлений

**Вариант A: Polling (проще для начала)**
```javascript
GET https://api.telegram.org/bot<TOKEN>/getUpdates
?offset=<last_update_id+1>
&timeout=30  // Long polling

// Проверять каждую секунду
```

**Вариант B: Webhook (production-ready)**
```javascript
POST https://api.telegram.org/bot<TOKEN>/setWebhook
{
  url: "https://smartwash.si/api/webhook/telegram",
  allowed_updates: ["message", "callback_query", "message_reaction"]
}
```

#### 3. **answerCallbackQuery** - Обработка нажатия кнопки "Прочитано"
```javascript
POST https://api.telegram.org/bot<TOKEN>/answerCallbackQuery
{
  callback_query_id: "query_id",
  text: "Отмечено как прочитано ✓"
}
```

---

## 🔄 Логика обработки статусов

### Backend Logic (Node.js/Python пример):

```javascript
// 1. При отправке сообщения в Telegram
async function sendToTelegram(message, sessionId) {
  // Отправляем в Telegram
  const telegramResponse = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: OPERATOR_CHAT_ID,
        text: `[${sessionId}]\n${message}`,
        reply_markup: {
          inline_keyboard: [[
            { text: "✓ Прочитано", callback_data: `read_${messageId}` }
          ]]
        }
      })
    }
  );

  const data = await telegramResponse.json();

  // Сохраняем message_id из Telegram
  await db.updateMessage(messageId, {
    telegramMessageId: data.result.message_id,
    status: 'delivered',  // Доставлено в Telegram
    'statusTimestamps.delivered': new Date()
  });

  return data.result.message_id;
}

// 2. Обработка webhook от Telegram
async function handleTelegramWebhook(update) {
  // Callback от кнопки "Прочитано"
  if (update.callback_query) {
    const callbackData = update.callback_query.data;

    if (callbackData.startsWith('read_')) {
      const messageId = callbackData.replace('read_', '');

      // Обновляем статус на "прочитано"
      await db.updateMessage(messageId, {
        status: 'read',
        'statusTimestamps.read': new Date()
      });

      // Подтверждаем нажатие кнопки
      await answerCallbackQuery(update.callback_query.id);
    }
  }

  // Сообщение от оператора
  if (update.message && update.message.text) {
    const operatorMessage = update.message.text;

    // Извлекаем sessionId из текста (если есть)
    const sessionMatch = operatorMessage.match(/\[([\w-]+)\]/);

    if (sessionMatch) {
      const sessionId = sessionMatch[1];

      // Сохраняем ответ оператора
      await db.createMessage({
        sessionId,
        content: operatorMessage,
        sender: 'operator',
        timestamp: new Date(),
        status: 'sent'
      });

      // Фронтенд получит это через polling
    }
  }
}

// 3. Polling endpoint - отдаём обновления статусов
async function getMessages(sessionId, lastMessageTime) {
  // Получаем новые сообщения
  const messages = await db.getMessages({
    sessionId,
    timestamp: { $gt: lastMessageTime }
  });

  // Получаем обновления статусов
  const statusUpdates = await db.getStatusUpdates({
    sessionId,
    'statusTimestamps.delivered': { $gt: lastMessageTime }
  });

  return {
    messages,
    statusUpdates: statusUpdates.map(msg => ({
      messageId: msg.messageId,
      status: msg.status,
      timestamp: msg.statusTimestamps[msg.status]
    }))
  };
}
```

---

## 🎨 Frontend Implementation

### 1. HTML структура сообщения с статусом:

```html
<div class="chat-message user" data-message-id="uuid">
  <div class="message-bubble">
    Текст сообщения
    <span class="message-status">
      <span class="status-icon sending">⏳</span>
    </span>
  </div>
</div>
```

### 2. CSS стили:

```css
.message-status {
  display: inline-block;
  margin-left: 6px;
  font-size: 0.85em;
}

.status-icon {
  transition: all 0.3s ease;
}

.status-icon.sending {
  color: #999;
}

.status-icon.sent {
  color: #999;
}

.status-icon.delivered {
  color: #4ade80;
}

.status-icon.read {
  color: #34b7f1;
}
```

### 3. JavaScript логика:

```javascript
// Отправка сообщения
async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  // Создаём временный ID
  const tempMessageId = 'temp_' + Date.now();

  // Добавляем сообщение со статусом "sending"
  const messageElement = addMessage(message, 'user', tempMessageId);
  updateMessageStatus(tempMessageId, 'sending');

  chatInput.value = '';

  try {
    const response = await fetch(`${API_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        message,
        operatorMode: chatMode === 'live'
      })
    });

    const data = await response.json();

    // Обновляем временный ID на реальный
    messageElement.dataset.messageId = data.messageId;
    updateMessageStatus(data.messageId, 'sent');

    // Через 1-2 секунды статус обновится через polling

  } catch (error) {
    updateMessageStatus(tempMessageId, 'error');
  }
}

// Обновление статуса сообщения
function updateMessageStatus(messageId, status) {
  const messageElement = document.querySelector(
    `[data-message-id="${messageId}"]`
  );

  if (!messageElement) return;

  const statusIcon = messageElement.querySelector('.status-icon');
  if (!statusIcon) return;

  // Убираем старые классы
  statusIcon.className = 'status-icon ' + status;

  // Устанавливаем новую иконку
  switch(status) {
    case 'sending':
      statusIcon.textContent = '⏳';
      break;
    case 'sent':
      statusIcon.textContent = '✓';
      break;
    case 'delivered':
      statusIcon.textContent = '✓✓';
      break;
    case 'read':
      statusIcon.textContent = '✓✓';
      statusIcon.style.color = '#34b7f1';
      break;
    case 'error':
      statusIcon.textContent = '✕';
      statusIcon.style.color = '#ff4444';
      break;
  }
}

// Обновлённый polling - обрабатываем статусы
async function startPolling() {
  if (pollingInterval) return;

  pollingInterval = setInterval(async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      const response = await fetch(
        `${API_URL}/api/messages/${SESSION_ID}?lastMessageTime=${lastMessageTime}`
      );
      const data = await response.json();

      // Добавляем новые сообщения
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(msg => {
          addMessage(msg.content, msg.sender);
        });

        lastMessageTime = data.messages[data.messages.length - 1].timestamp;
      }

      // Обновляем статусы существующих сообщений
      if (data.statusUpdates && data.statusUpdates.length > 0) {
        data.statusUpdates.forEach(update => {
          updateMessageStatus(update.messageId, update.status);
        });
      }

    } catch (error) {
      console.error('Polling error:', error);
    } finally {
      isPolling = false;
    }
  }, 2000);
}
```

---

## 🔐 Безопасность

### 1. **Telegram Bot Token:**
```javascript
// Хранить в переменных окружения
process.env.TELEGRAM_BOT_TOKEN

// НЕ коммитить в git!
```

### 2. **Webhook verification:**
```javascript
// Проверять что запрос пришёл от Telegram
function verifyTelegramWebhook(req) {
  const token = req.headers['x-telegram-bot-api-secret-token'];
  return token === process.env.TELEGRAM_WEBHOOK_SECRET;
}
```

### 3. **Rate limiting:**
```javascript
// Ограничить частоту запросов к Telegram API
// Max 30 messages per second
```

---

## 📈 Этапы реализации

### Phase 1: Базовая интеграция (MVP)
1. ✅ Добавить поле `messageId` в сообщения
2. ✅ Сохранять `telegramMessageId` при отправке
3. ✅ Добавить статус "delivered" когда отправлено в Telegram
4. ✅ Обновить фронтенд для отображения статусов

### Phase 2: Telegram Webhook
1. ✅ Настроить webhook endpoint
2. ✅ Обрабатывать callback_query для кнопки "Прочитано"
3. ✅ Добавить inline кнопки к сообщениям в Telegram
4. ✅ Обновлять статус "read" при нажатии кнопки

### Phase 3: Продвинутые фичи
1. ⭐ Автоопределение "прочитано" через Telegram API
2. ⭐ Добавить статусы для вложений (фото)
3. ⭐ История статусов для аналитики
4. ⭐ Push уведомления через WebSocket вместо polling

---

## 🧪 Тестирование

### Test Cases:

```javascript
// 1. Отправка сообщения пользователем
Test: Сообщение проходит все статусы
Expected: sending → sent → delivered

// 2. Оператор нажимает "Прочитано"
Test: Статус обновляется в реальном времени
Expected: delivered → read (синие галочки)

// 3. Потеря соединения
Test: Сообщение остаётся в статусе "sending"
Expected: Показывается ошибка или retry

// 4. Множественные сообщения
Test: Статусы не путаются между сообщениями
Expected: Каждое сообщение имеет свой корректный статус
```

---

## 🎯 Итоговая схема данных

```
User sends "Привет" →
  Frontend:
    - Creates temp message with ⏳
    - Sends to backend

  Backend:
    - Saves to DB with status "sent" ✓
    - Sends to Telegram API
    - Gets telegramMessageId: 12345
    - Updates DB: status "delivered" ✓✓

  Telegram:
    - Operator sees message with button [✓ Прочитано]
    - Operator clicks button

  Backend Webhook:
    - Receives callback_query
    - Updates DB: status "read" ✓✓ (blue)

  Frontend Polling:
    - Gets statusUpdate: { messageId, status: "read" }
    - Updates UI: ✓✓ turns blue
```

---

## 📝 Конфигурация

### Environment Variables (.env):

```bash
# Telegram Bot
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_OPERATOR_CHAT_ID=-1001234567890
TELEGRAM_WEBHOOK_SECRET=your-secret-token-here

# Backend
API_URL=https://claude-production-e0ea.up.railway.app
PORT=3000

# Database
DATABASE_URL=postgresql://user:pass@host:5432/smartwash
```

### Telegram Bot Setup:

```bash
# 1. Создать бота через @BotFather
/newbot
# Получить token

# 2. Добавить бота в группу с операторами
# Сделать его админом для получения message_id

# 3. Получить chat_id группы
# Отправить сообщение в группу и проверить:
curl https://api.telegram.org/bot<TOKEN>/getUpdates

# 4. Установить webhook (production)
curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://smartwash.si/api/webhook/telegram",
    "allowed_updates": ["message", "callback_query"]
  }'
```

---

## 🚀 Ready to implement!

Эта схема покрывает все аспекты интеграции статусов сообщений с Telegram Bot API.
