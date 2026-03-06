import os
import logging
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters
import handlers

# Setup logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

def main():
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN is not set. Please set it in .env file or environment variables.")
        return

    # Build the application
    application = Application.builder().token(token).build()

    # Add handlers
    application.add_handler(CommandHandler("start", handlers.start_handler))
    application.add_handler(CommandHandler("help", handlers.help_handler))
    application.add_handler(CommandHandler("razgovorni", handlers.razgovorni_handler))
    application.add_handler(CommandHandler("poslovno", handlers.poslovno_handler))
    application.add_handler(CommandHandler("slovinglish", handlers.slovinglish_handler))
    application.add_handler(CommandHandler("pojasni", handlers.pojasni_handler))
    application.add_handler(CommandHandler("kontekst", handlers.kontekst_handler))
    
    # Handle normal text messages (not commands)
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handlers.text_handler))

    # Run polling
    logger.info("Bot is starting polling...")
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
