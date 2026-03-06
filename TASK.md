# Telegram Bot: Kot bi rekel Slovenec

## Описание
Бот корректирует текст на словенском языке — показывает как носитель языка сказал бы это в нужном контексте.

---

## Стек
- **Python 3.11+**
- **python-telegram-bot** v20+ (async)
- **Anthropic Python SDK** (claude-haiku-4-5)
- **Деплой:** Railway (один сервис, polling режим)

---

## Переменные окружения
```
TELEGRAM_BOT_TOKEN=...
ANTHROPIC_API_KEY=...
```

---

## Команды бота

| Команда | Поведение |
|---|---|
| Просто текст | Стандартная коррекция (правильный литературный словенский) |
| `/razgovorni [текст]` | Разговорный стиль |
| `/poslovno [текст]` | Деловой / официальный стиль |
| `/slovinglish [текст]` | Убрать английские вставки, заменить словенскими эквивалентами |
| `/kontekst [контекст] | [текст]` | Произвольный контекст, текст после `\|` |
| `/pojasni [текст]` | Стандартная коррекция + объяснение изменений на русском |
| `/start` | Приветствие и инструкция |
| `/help` | Список команд |

---

## Архитектура

**Stateless** — каждое сообщение обрабатывается независимо. История диалога не хранится и не передаётся в API. Это критично для минимизации расхода токенов.

Один запрос к API = системный промпт + текст пользователя. Никаких messages history.

---

## Системные промпты

### Базовый (все команды кроме /pojasni)
```
Ti si naravni govorec slovenskega jezika z odličnim jezikovnim čutom.
Uporabnik ti pošlje besedilo v slovenščini. Tvoja naloga:
1. Popravi besedilo tako, kot bi ga napisal/rekel pravi Slovenec v danem kontekstu.
2. Vrni SAMO popravljeno besedilo brez razlage.
3. Če je besedilo že pravilno, ga vrni nespremenjeno.
Kontekst: {context}
```

### С объяснением (/pojasni)
```
Ti si naravni govorec slovenskega jezika z odličnim jezikovnim čutom.
Uporabnik ti pošlje besedilo v slovenščini. Tvoja naloga:
1. Popravi besedilo tako, kot bi ga napisal/rekel pravi Slovenec.
2. Vrni popravljeno besedilo.
3. Nato v ruskem jeziku kratko pojasni, kaj si spremenil in zakaj. Če ni sprememb - povej to.
Format odgovora:
✅ [popravljeno besedilo]
📝 [razlaga v ruščini]
Kontekst: standardni slovenski jezik
```

### Значения {context} по командам
- Просто текст: `standardni knjižni slovenski jezik`
- `/razgovorni`: `pogovorni slog, sproščen, kot v vsakdanjem pogovoru`
- `/poslovno`: `uradni poslovni slog, formalno, za dopise in e-pošto`
- `/slovinglish`: `odstrani angleške besede in jih nadomesti s slovenskimi ustreznicami`
- `/kontekst`: берётся из аргумента команды (часть до `|`)

---

## Структура файлов
```
/
├── bot.py           # Основной файл, запуск polling
├── handlers.py      # Обработчики команд и сообщений
├── api_client.py    # Обёртка для вызова Anthropic API
├── prompts.py       # Все системные промпты и контексты
├── requirements.txt
├── Procfile         # Для Railway: worker: python bot.py
└── .env.example
```

---

## Логика обработки (handlers.py)

```python
# Псевдокод

async def handle_message(update, context):
    text = update.message.text
    corrected = await call_api(text, ctx="standardni knjižni slovenski jezik", explain=False)
    await update.message.reply_text(corrected)

async def handle_pojasni(update, context):
    text = " ".join(context.args)
    if not text:
        await update.message.reply_text("Dodaj besedilo: /pojasni [tvoje besedilo]")
        return
    result = await call_api(text, ctx="standardni knjižni slovenski jezik", explain=True)
    await update.message.reply_text(result)

# Аналогично для /razgovorni, /poslovno, /slovinglish

async def handle_kontekst(update, context):
    # Ожидаем формат: /kontekst poslovni email | Živjo, bi rad vprašal...
    raw = " ".join(context.args)
    if "|" not in raw:
        await update.message.reply_text("Format: /kontekst [kontekst] | [besedilo]")
        return
    ctx, text = raw.split("|", 1)
    result = await call_api(text.strip(), ctx=ctx.strip(), explain=False)
    await update.message.reply_text(result)
```

---

## api_client.py

```python
import anthropic

client = anthropic.Anthropic()  # читает ANTHROPIC_API_KEY из env

async def call_api(text: str, ctx: str, explain: bool) -> str:
    system = build_system_prompt(ctx, explain)  # из prompts.py
    message = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=512,
        system=system,
        messages=[{"role": "user", "content": text}]
    )
    return message.content[0].text
```

---

## requirements.txt
```
python-telegram-bot==20.7
anthropic>=0.25.0
python-dotenv
```

---

## Procfile (Railway)
```
worker: python bot.py
```

---

## Оценка расхода токенов
Один запрос без объяснений:
- Input: ~200 (system) + ~50 (текст) = ~250 токенов
- Output: ~80 токенов
- **Итого ~330 токенов / запрос**

С `/pojasni`:
- Input: ~250 токенов
- Output: ~200 токенов
- **Итого ~450 токенов / запрос**

Claude Haiku: $0.25/MTok input, $1.25/MTok output.
1000 запросов ≈ $0.15. Бюджет $5 покрывает ~30 000+ запросов/месяц.
