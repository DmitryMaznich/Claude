from telegram import Update
from telegram.ext import ContextTypes
from api_client import call_api
import logging

logger = logging.getLogger(__name__)

async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    welcome_text = (
        "Živjo! 🇸🇮 Я бот, который поможет тебе писать на словенском как местный.\n\n"
        "Просто отправь мне текст, и я исправлю его в стандартном литературном стиле.\n\n"
        "Или используй команды:\n"
        "/razgovorni [текст] - Разговорный стиль\n"
        "/poslovno [текст] - Деловой стиль\n"
        "/slovinglish [текст] - Убрать англицизмы\n"
        "/kontekst [контекст] | [текст] - Задать свой контекст\n"
        "/pojasni [текст] - Исправить и объяснить на русском\n"
        "/help - Показать это сообщение снова"
    )
    await update.message.reply_text(welcome_text)

async def help_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await start_handler(update, context)

async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    if not text:
        return
        
    await update.message.chat.send_action(action="typing")
    corrected = await call_api(text, ctx="standard", explain=False)
    await update.message.reply_text(corrected)

async def process_command_with_context(update: Update, context: ContextTypes.DEFAULT_TYPE, ctx_key: str):
    text = " ".join(context.args)
    if not text:
        await update.message.reply_text("Пожалуйста, добавьте текст после команды.")
        return
        
    await update.message.chat.send_action(action="typing")
    corrected = await call_api(text, ctx=ctx_key, explain=False)
    await update.message.reply_text(corrected)

async def razgovorni_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await process_command_with_context(update, context, "razgovorni")

async def poslovno_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await process_command_with_context(update, context, "poslovno")

async def slovinglish_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await process_command_with_context(update, context, "slovinglish")

async def pojasni_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = " ".join(context.args)
    if not text:
        await update.message.reply_text("Dodaj besedilo: /pojasni [tvoje besedilo]")
        return
        
    await update.message.chat.send_action(action="typing")
    result = await call_api(text, ctx="standard", explain=True)
    await update.message.reply_text(result)

async def kontekst_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    raw = " ".join(context.args)
    if "|" not in raw:
        await update.message.reply_text("Format: /kontekst [kontekst] | [besedilo]\nНапример: /kontekst uradni email | Živjo, bi rad vprašal...")
        return
        
    ctx, text = raw.split("|", 1)
    text = text.strip()
    ctx = ctx.strip()
    
    if not text:
        await update.message.reply_text("Текст после | не может быть пустым.")
        return
        
    await update.message.chat.send_action(action="typing")
    result = await call_api(text, ctx=ctx, explain=False)
    await update.message.reply_text(result)
