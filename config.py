"""Local configuration. Never put a real bot token in a public repository."""
import os

# Prefer Render environment variable BOT_TOKEN.
# For local/private testing only, you may replace the placeholder below.
BOT_TOKEN = os.getenv("BOT_TOKEN", "PASTE_YOUR_TELEGRAM_BOT_TOKEN_HERE")

BOT_NAME = "PrepGrid Gujarati PDF Translator"
MAX_DOWNLOAD_MB = 19  # Telegram Bot API getFile download limit is 20 MB.
MAX_PAGES = 200
TARGET_LANGUAGE = "gu"
SOURCE_LANGUAGE = "en"
