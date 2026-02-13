# 📱 Упрощённая схема статусов сообщений (Polling only)

## 🎯 Простая архитектура

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Browser   │  Poll   │   Backend    │  Poll   │  Telegram Bot   │
│  (Frontend) │◄───────►│   Server     │◄───────►│      API        │
└─────────────┘  2 sec  └──────────────┘  3 sec  └─────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │   Database   │
                        │  (Messages)  │
                        └──────────────┘
```

**Без webhook - только polling!** ✅

---

## 📊 Три простых статуса

```
1. SENT        ✓  (отправлено на сервер)
2. DELIVERED   ✓✓ (доставлено в Telegram)
3. READ        ✓✓ (прочитано - синие галочки)
```

---

## 🗄️ База данных - Message (упрощённая)

```javascript
{
  messageId: "uuid",
  sessionId: "session-uuid",
  content: "Текст",
  sender: "user" | "operator",
  timestamp: "2024-02-13T10:30:00Z",

  // Статусы
  status: "sent" | "delivered" | "read",

  // Telegram
  telegramMessageId: 12345  // ID в Telegram (чтобы отслеживать)
}
```

---

## 🔌 Backend API (только 2 эндпоинта)

### 1. POST /api/chat - Отправка
```javascript
// Request
{
  sessionId: "uuid",
  message: "Привет"
}

// Response
{
  messageId: "uuid-123",
  status: "sent",
  response: "Ответ"
}
```

### 2. GET /api/messages/:sessionId - Polling
```javascript
// Request
GET /api/messages/uuid?lastMessageTime=2024-02-13T10:30:00Z

// Response
{
  messages: [...],

  // Обновления статусов
  statusUpdates: [
    {
      messageId: "uuid-123",
      status: "delivered"  // или "read"
    }
  ]
}
```

---

## 🤖 Telegram Bot API (только 2 метода)

### 1. sendMessage - Отправка в Telegram
```javascript
POST https://api.telegram.org/bot<TOKEN>/sendMessage
{
  chat_id: -1001234567890,  // ID группы с операторами
  text: "User: Привет"
}

// Response
{
  ok: true,
  result: {
    message_id: 12345  // ← Сохранить это!
  }
}
```

### 2. getUpdates - Проверка прочитано ли
```javascript
GET https://api.telegram.org/bot<TOKEN>/getUpdates

// Response
{
  ok: true,
  result: [
    {
      update_id: 123456,
      message: {
        message_id: 12346,
        from: { username: "operator" },
        text: "Ответ оператора"
      }
    }
  ]
}
```

---

## 💻 Backend Logic (Node.js пример)

```javascript
// ============================================
// 1. Отправка сообщения в Telegram
// ============================================
async function sendToTelegram(messageId, text, sessionId) {
  // Отправляем в Telegram
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_OPERATOR_CHAT_ID,
        text: `[Session: ${sessionId}]\n\n${text}`
      })
    }
  );

  const data = await response.json();

  // Сохраняем ID из Telegram и ставим статус "delivered"
  await db.updateMessage(messageId, {
    telegramMessageId: data.result.message_id,
    status: 'delivered'  // ✓✓
  });
}

// ============================================
// 2. Polling Telegram каждые 3 секунды
// ============================================
let lastUpdateId = 0;

setInterval(async () => {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}`
    );
    const data = await response.json();

    if (!data.ok || !data.result.length) return;

    for (const update of data.result) {
      lastUpdateId = update.update_id;

      // Если оператор написал ответ
      if (update.message && update.message.text) {
        const text = update.message.text;

        // Извлекаем sessionId
        const match = text.match(/\[Session: ([\w-]+)\]/);
        if (match) {
          const sessionId = match[1];

          // Сохраняем ответ оператора
          await db.createMessage({
            sessionId,
            content: text,
            sender: 'operator',
            status: 'sent'
          });
        }

        // Отмечаем предыдущее сообщение пользователя как прочитанное
        // Логика: если оператор ответил, значит прочитал
        await markPreviousUserMessageAsRead(sessionId);
      }
    }
  } catch (error) {
    console.error('Telegram polling error:', error);
  }
}, 3000); // Каждые 3 секунды

// ============================================
// 3. Помечаем сообщение как прочитанное
// ============================================
async function markPreviousUserMessageAsRead(sessionId) {
  // Находим последнее сообщение от пользователя
  const lastUserMessage = await db.findOne({
    sessionId,
    sender: 'user',
    status: { $ne: 'read' }  // Ещё не прочитано
  })
  .sort({ timestamp: -1 });

  if (lastUserMessage) {
    await db.updateMessage(lastUserMessage.messageId, {
      status: 'read'  // ✓✓ синие
    });
  }
}

// ============================================
// 4. API endpoint для фронтенда
// ============================================
app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;

  // Создаём сообщение
  const messageId = uuidv4();
  await db.createMessage({
    messageId,
    sessionId,
    content: message,
    sender: 'user',
    status: 'sent',  // ✓
    timestamp: new Date()
  });

  // Отправляем в Telegram (асинхронно)
  sendToTelegram(messageId, message, sessionId);

  // Отвечаем фронтенду
  res.json({
    messageId,
    status: 'sent',
    response: 'Сообщение отправлено оператору'
  });
});

app.get('/api/messages/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { lastMessageTime } = req.query;

  // Новые сообщения
  const messages = await db.find({
    sessionId,
    timestamp: { $gt: new Date(lastMessageTime) }
  });

  // Обновления статусов
  const statusUpdates = await db.find({
    sessionId,
    sender: 'user',
    status: { $in: ['delivered', 'read'] },
    updatedAt: { $gt: new Date(lastMessageTime) }
  }).select('messageId status');

  res.json({
    messages,
    statusUpdates
  });
});
```

---

## 🎨 Frontend (изменения в index.html)

### 1. Обновить функцию addMessage:

```javascript
function addMessage(text, sender, messageId = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${sender}`;

  // Добавляем data-message-id
  if (messageId) {
    messageDiv.dataset.messageId = messageId;
  }

  messageDiv.innerHTML = `
    <div class="message-bubble">
      ${text}
      ${sender === 'user' ? '<span class="message-status">✓</span>' : ''}
    </div>
  `;

  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return messageDiv;
}
```

### 2. Обновить sendMessage:

```javascript
async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  chatInput.value = '';

  try {
    const response = await fetch(`${API_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        message
      })
    });

    const data = await response.json();

    // Добавляем сообщение со статусом "sent" ✓
    addMessage(message, 'user', data.messageId);

    // Через polling статус обновится на ✓✓

  } catch (error) {
    console.error('Error:', error);
  }
}
```

### 3. Новая функция обновления статуса:

```javascript
function updateMessageStatus(messageId, status) {
  const messageElement = document.querySelector(
    `[data-message-id="${messageId}"]`
  );

  if (!messageElement) return;

  const statusSpan = messageElement.querySelector('.message-status');
  if (!statusSpan) return;

  // Обновляем иконку
  if (status === 'sent') {
    statusSpan.textContent = '✓';
    statusSpan.style.color = '#999';
  } else if (status === 'delivered') {
    statusSpan.textContent = '✓✓';
    statusSpan.style.color = '#999';
  } else if (status === 'read') {
    statusSpan.textContent = '✓✓';
    statusSpan.style.color = '#34b7f1';  // Синий
  }
}
```

### 4. Обновить polling:

```javascript
function startPolling() {
  if (pollingInterval) return;

  pollingInterval = setInterval(async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      const response = await fetch(
        `${API_URL}/api/messages/${SESSION_ID}?lastMessageTime=${lastMessageTime}`
      );
      const data = await response.json();

      // Новые сообщения от оператора
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(msg => {
          addMessage(msg.content, msg.sender);
        });
        lastMessageTime = data.messages[data.messages.length - 1].timestamp;
      }

      // Обновления статусов ← НОВОЕ!
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

### 5. CSS стили:

```css
.message-status {
  font-size: 0.75em;
  margin-left: 6px;
  color: #999;
  transition: color 0.3s ease;
}

/* Синий цвет для прочитанных */
.message-status[style*="color: rgb(52, 183, 241)"] {
  animation: checkmarkPulse 0.3s ease;
}

@keyframes checkmarkPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
}
```

---

## 🔑 Логика определения "прочитано"

### Простое правило:
```
Когда оператор ОТВЕТИЛ на сообщение = он его ПРОЧИТАЛ
```

```javascript
// В Telegram polling:
if (update.message && update.message.from.username === 'operator') {
  // Оператор написал ответ

  // 1. Сохраняем его ответ
  await saveOperatorMessage(update.message);

  // 2. Помечаем последнее сообщение пользователя как "read"
  await markLastUserMessageAsRead(sessionId);
}
```

---

## 📋 Checklist для реализации

### Backend:
- [ ] Добавить поле `telegramMessageId` в схему Message
- [ ] Добавить поле `status` со значениями: sent, delivered, read
- [ ] Реализовать `sendToTelegram()` функцию
- [ ] Запустить Telegram polling (getUpdates каждые 3 сек)
- [ ] Обновить `/api/messages` endpoint - добавить `statusUpdates`

### Frontend:
- [ ] Добавить `data-message-id` к сообщениям пользователя
- [ ] Добавить `<span class="message-status">` к каждому user сообщению
- [ ] Реализовать `updateMessageStatus()` функцию
- [ ] Обновить polling для обработки `statusUpdates`
- [ ] Добавить CSS анимацию для изменения статуса

### Telegram:
- [ ] Создать бота через @BotFather
- [ ] Добавить бота в группу с операторами
- [ ] Получить `chat_id` группы
- [ ] Сохранить `TELEGRAM_BOT_TOKEN` в .env

---

## 🧪 Как протестировать

### 1. Отправить сообщение с фронтенда:
```
User пишет: "Привет"
Ожидается: Статус ✓ (sent)
```

### 2. Проверить в Telegram:
```
В группе операторов должно появиться:
[Session: uuid-123]

Привет
```

### 3. Подождать 3 секунды:
```
Backend опросит Telegram
Статус обновится: ✓✓ (delivered)
```

### 4. Оператор отвечает в Telegram:
```
Оператор пишет: "Здравствуйте!"
```

### 5. Фронтенд получит через polling:
```
- Новое сообщение от оператора
- Статус предыдущего ✓✓ станет синим (read)
```

---

## 🎯 Итого

### Что нужно:
1. ✅ База данных с полями `messageId`, `telegramMessageId`, `status`
2. ✅ Telegram Bot Token
3. ✅ ID группы с операторами
4. ✅ Две функции на бэкенде:
   - sendToTelegram()
   - Telegram polling loop
5. ✅ Три функции на фронтенде:
   - addMessage() с messageId
   - updateMessageStatus()
   - обновлённый polling

### Преимущества простой схемы:
- ✅ Без webhook - проще настроить
- ✅ Без сложных callback_query
- ✅ Работает везде (даже localhost)
- ✅ Легко тестировать
- ✅ Простая логика: ответил = прочитал

### Environment (.env):
```bash
TELEGRAM_BOT_TOKEN=123456:ABCdef...
TELEGRAM_OPERATOR_CHAT_ID=-1001234567890
```

---

## 🚀 Готово к реализации!

Это максимально простая схема с polling.
Начните с Backend → потом Frontend.
