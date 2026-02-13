# 🔧 Требования к Backend для статусов сообщений

## ✅ Что уже реализовано на Frontend:

1. ✅ Функция `updateMessageStatus(messageId, status)` - обновляет галочки
2. ✅ Обработка `statusUpdates` в polling
3. ✅ Отображение статусов: ✓ (sent) → ✓✓ (delivered) → ✓✓ синие (read)
4. ✅ CSS стили для анимации статусов

---

## 🎯 Что нужно добавить на Backend:

### 1. POST /api/chat - Добавить messageId в ответ

**Текущий ответ:**
```json
{
  "response": "Ответ бота",
  "operatorMode": false
}
```

**Нужно добавить:**
```json
{
  "messageId": "uuid-v4-generated-id",  // ← НОВОЕ
  "response": "Ответ бота",
  "operatorMode": false
}
```

### 2. GET /api/messages/:sessionId - Добавить statusUpdates

**Текущий ответ:**
```json
{
  "messages": [...],
  "operatorMode": true
}
```

**Нужно добавить:**
```json
{
  "messages": [...],
  "operatorMode": true,
  "statusUpdates": [  // ← НОВОЕ
    {
      "messageId": "uuid-123",
      "status": "delivered"  // или "read"
    },
    {
      "messageId": "uuid-456",
      "status": "read"
    }
  ]
}
```

### 3. База данных - Добавить поля к Message

```javascript
{
  messageId: "uuid",              // Уникальный ID (генерировать при создании)
  sessionId: "session-uuid",
  content: "Текст",
  sender: "user" | "operator",
  timestamp: "2024-02-13T10:30:00Z",

  // НОВЫЕ ПОЛЯ:
  status: "sent" | "delivered" | "read",        // ← Добавить
  telegramMessageId: 12345,                      // ← Добавить (ID из Telegram)
  updatedAt: "2024-02-13T10:30:05Z"             // ← Добавить (для отслеживания изменений)
}
```

---

## 📱 Telegram Bot Integration (простая схема)

### Шаг 1: Отправка в Telegram

Когда приходит сообщение от пользователя:

```javascript
// 1. Сохраняем сообщение в БД со статусом "sent"
const messageId = uuidv4();
await db.createMessage({
  messageId,
  sessionId,
  content: message,
  sender: 'user',
  status: 'sent',
  timestamp: new Date()
});

// 2. Отправляем в Telegram
const telegramResponse = await fetch(
  `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_OPERATOR_CHAT_ID,
      text: `[${sessionId}]\n\n${message}`
    })
  }
);

const telegramData = await telegramResponse.json();

// 3. Обновляем статус на "delivered"
await db.updateMessage(messageId, {
  status: 'delivered',
  telegramMessageId: telegramData.result.message_id,
  updatedAt: new Date()
});
```

### Шаг 2: Telegram Polling (каждые 3 сек)

```javascript
let lastTelegramUpdateId = 0;

setInterval(async () => {
  // Опрашиваем Telegram
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastTelegramUpdateId + 1}`
  );
  const data = await response.json();

  if (!data.ok || !data.result.length) return;

  for (const update of data.result) {
    lastTelegramUpdateId = update.update_id;

    // Если оператор ответил
    if (update.message && update.message.text) {
      const text = update.message.text;

      // Извлекаем sessionId
      const match = text.match(/\[([\w-]+)\]/);
      if (match) {
        const sessionId = match[1];

        // Сохраняем ответ оператора
        await db.createMessage({
          messageId: uuidv4(),
          sessionId,
          content: text,
          sender: 'operator',
          status: 'sent',
          timestamp: new Date()
        });

        // Помечаем последнее сообщение пользователя как "read"
        await db.updateMany(
          {
            sessionId,
            sender: 'user',
            status: { $ne: 'read' }
          },
          {
            status: 'read',
            updatedAt: new Date()
          }
        );
      }
    }
  }
}, 3000);
```

### Шаг 3: Возвращаем statusUpdates

В endpoint `/api/messages/:sessionId`:

```javascript
app.get('/api/messages/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { lastMessageTime } = req.query;

  // Получаем новые сообщения (как обычно)
  const messages = await db.find({
    sessionId,
    timestamp: { $gt: new Date(lastMessageTime) }
  });

  // НОВОЕ: Получаем обновления статусов
  const statusUpdates = await db.find({
    sessionId,
    sender: 'user',
    updatedAt: { $gt: new Date(lastMessageTime) },
    status: { $in: ['delivered', 'read'] }
  }).select('messageId status');

  res.json({
    messages,
    statusUpdates: statusUpdates.map(msg => ({
      messageId: msg.messageId,
      status: msg.status
    })),
    operatorMode: isOperatorMode
  });
});
```

---

## 🔑 Environment Variables

Добавить в `.env`:

```bash
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_OPERATOR_CHAT_ID=-1001234567890
```

### Как получить:

1. **TELEGRAM_BOT_TOKEN:**
   - Написать @BotFather в Telegram
   - `/newbot`
   - Скопировать токен

2. **TELEGRAM_OPERATOR_CHAT_ID:**
   - Создать группу в Telegram
   - Добавить бота в группу
   - Отправить сообщение в группу
   - Зайти на: `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Найти `"chat":{"id":-1001234567890}`

---

## 📊 Логика статусов (простая)

```
1. User отправляет сообщение
   → Backend создаёт запись со status: "sent" ✓
   → Возвращает messageId фронтенду

2. Backend отправляет в Telegram
   → Получает telegramMessageId от Telegram
   → Обновляет status: "delivered" ✓✓

3. Оператор отвечает в Telegram
   → Backend видит ответ через polling
   → Обновляет все непрочитанные сообщения: status: "read" ✓✓ (синие)

4. Frontend polling каждые 2 сек
   → Получает statusUpdates
   → Обновляет галочки в UI
```

---

## ✅ Минимальный MVP

Если Telegram интеграция сложная, можно начать с упрощённой версии:

### Вариант без Telegram (для теста):

```javascript
// В POST /api/chat:
setTimeout(() => {
  // Через 2 секунды автоматически "доставлено"
  db.updateMessage(messageId, {
    status: 'delivered',
    updatedAt: new Date()
  });
}, 2000);

setTimeout(() => {
  // Через 5 секунд автоматически "прочитано"
  db.updateMessage(messageId, {
    status: 'read',
    updatedAt: new Date()
  });
}, 5000);
```

Это позволит протестировать работу статусов на фронтенде без настройки Telegram.

---

## 🧪 Тестирование

1. Отправить сообщение с фронтенда
2. Проверить что вернулся `messageId`
3. Проверить что через 2 сек появилась ✓
4. Проверить что через полинг пришёл `statusUpdate` с "delivered"
5. Проверить что галочка изменилась на ✓✓

---

## 📝 Резюме изменений Backend

### Файлы для изменения:

1. **Message Schema** - добавить поля: `messageId`, `status`, `telegramMessageId`, `updatedAt`
2. **POST /api/chat** - генерировать `messageId`, возвращать в ответе
3. **GET /api/messages** - добавить `statusUpdates` в ответ
4. **Telegram Integration** - добавить отправку и polling (опционально для MVP)

### Оценка времени:
- MVP без Telegram: **30 минут**
- С Telegram интеграцией: **2-3 часа**
