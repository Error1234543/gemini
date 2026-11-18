"""PrepGrid Google Drive PDF uploader bot for Render."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("prepgrid-drive-bot")

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
OWNER_ID = os.getenv("OWNER_ID", "").strip()
DRIVE_SCRIPT_URL = os.getenv("DRIVE_SCRIPT_URL", "").strip()
DRIVE_UPLOAD_SECRET = os.getenv("DRIVE_UPLOAD_SECRET", "").strip()
MAX_FILE_MB = int(os.getenv("MAX_FILE_MB", "19"))

if not BOT_TOKEN:
    raise RuntimeError("Missing BOT_TOKEN environment variable.")

WEBHOOK_HOST = os.getenv("RENDER_EXTERNAL_HOSTNAME", "").strip()
WEBHOOK_PATH = "/telegram/" + hashlib.sha256(BOT_TOKEN.encode()).hexdigest()[:24]
WEBHOOK_SECRET = hashlib.sha256((BOT_TOKEN + ":prepgrid-drive-webhook").encode()).hexdigest()[:32]

telegram_app = Application.builder().token(BOT_TOKEN).build()


def is_owner(update: Update) -> bool:
    user = update.effective_user
    return bool(user and OWNER_ID and str(user.id) == OWNER_ID)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_owner(update):
        await update.effective_message.reply_text("Sorry, this is a private PrepGrid upload bot.")
        return
    await update.effective_message.reply_text(
        "PrepGrid Drive Uploader is ready.\nSend a PDF as a Telegram document. "
        "I will upload it to your Google Drive and return its link.\nCommands: /start /help"
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_owner(update):
        await update.effective_message.reply_text("This bot is private.")
        return
    await update.effective_message.reply_text(
        "Send a PDF using Telegram's Document option (not as a photo). "
        "Only the configured owner can upload files."
    )


async def upload_pdf(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = update.effective_message
    if not is_owner(update):
        await message.reply_text("You are not authorized to use this bot.")
        return
    if not DRIVE_SCRIPT_URL or not DRIVE_UPLOAD_SECRET:
        await message.reply_text("Drive setup incomplete. Ask the bot owner to configure Drive settings.")
        return

    doc = message.document
    if not doc or not (doc.file_name or "").lower().endswith(".pdf"):
        await message.reply_text("Please send a PDF document.")
        return

    size = doc.file_size or 0
    if size > MAX_FILE_MB * 1024 * 1024:
        await message.reply_text(f"PDF too large. Current limit: {MAX_FILE_MB} MB.")
        return

    status = await message.reply_text("📥 PDF received. Uploading to Google Drive...")
    temp_path = None
    try:
        tg_file = await context.bot.get_file(doc.file_id)
        with tempfile.NamedTemporaryFile(prefix="prepgrid_", suffix=".pdf", delete=False) as tmp:
            temp_path = Path(tmp.name)
        await tg_file.download_to_drive(custom_path=str(temp_path))
        raw = temp_path.read_bytes()
        payload = {
            "secret": DRIVE_UPLOAD_SECRET,
            "filename": Path(doc.file_name or "PrepGrid.pdf").name,
            "mimeType": "application/pdf",
            "data": base64.b64encode(raw).decode("ascii"),
        }
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=30.0), follow_redirects=True) as client:
            response = await client.post(DRIVE_SCRIPT_URL, json=payload)
            response.raise_for_status()
        result = response.json()
        if not result.get("ok") or not result.get("url"):
            raise RuntimeError(result.get("error", "Google Drive did not return a file link."))
        await status.edit_text(
            "✅ PDF uploaded to Google Drive!\n\n"
            f"📄 {doc.file_name or 'PDF'}\n"
            f"🔗 {result['url']}\n\n"
            "Copy this link into the relevant PrepGrid chapter page."
        )
    except Exception as exc:
        log.exception("Drive upload failed")
        await status.edit_text("❌ Upload failed: " + str(exc)[:700])
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)


telegram_app.add_handler(CommandHandler("start", start))
telegram_app.add_handler(CommandHandler("help", help_command))
telegram_app.add_handler(MessageHandler(filters.Document.ALL, upload_pdf))


@asynccontextmanager
async def lifespan(_: FastAPI):
    await telegram_app.initialize()
    await telegram_app.start()
    if WEBHOOK_HOST:
        await telegram_app.bot.set_webhook(
            url=f"https://{WEBHOOK_HOST}{WEBHOOK_PATH}",
            secret_token=WEBHOOK_SECRET,
            drop_pending_updates=True,
        )
        log.info("Webhook registered for Render host %s", WEBHOOK_HOST)
    else:
        log.warning("RENDER_EXTERNAL_HOSTNAME missing; webhook not registered.")
    try:
        yield
    finally:
        if WEBHOOK_HOST:
            await telegram_app.bot.delete_webhook()
        await telegram_app.stop()
        await telegram_app.shutdown()


app = FastAPI(title="PrepGrid Drive Uploader", lifespan=lifespan)


@app.get("/")
async def health():
    return {"status": "ok", "service": "PrepGrid Drive Uploader"}


@app.post(WEBHOOK_PATH)
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    if x_telegram_bot_api_secret_token != WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid webhook secret")
    data = await request.json()
    update = Update.de_json(data, telegram_app.bot)
    await telegram_app.update_queue.put(update)
    return {"ok": True}
