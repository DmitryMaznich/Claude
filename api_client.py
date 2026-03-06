import os
import logging
from anthropic import AsyncAnthropic
from prompts import get_system_prompt
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Verify API key exists
api_key = os.getenv("ANTHROPIC_API_KEY")
if not api_key:
    logger.warning("ANTHROPIC_API_KEY is not set. API calls will fail until it is configured.")

client = AsyncAnthropic(api_key=api_key)

async def call_api(text: str, ctx: str, explain: bool = False) -> str:
    try:
        system = get_system_prompt(ctx, explain)
        # Using the latest Claude Haiku model (as indicated in the requirements)
        message = await client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=512,
            system=system,
            messages=[{"role": "user", "content": text}]
        )
        return message.content[0].text
    except Exception as e:
        logger.error(f"Error calling Anthropic API: {e}")
        return "Prišlo je do napake pri obdelavi vašega sporočila (Ошибка при обработке сообщения). Пожалуйста, проверьте API ключи."
