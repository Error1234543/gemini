"""PrepGrid Telegram PDF translator: FastAPI webhook + PDF Linguist."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import fitz
from fastapi import FastAPI, Header, HTTPException, Request
from pdf_linguist import TranslateOptions, translate_pdf
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

from config import BOT_NAME, BOT_TOKEN, MAX_DOWNLOAD_MB, MAX_PAGES, SOURCE_LANGUAGE, TARGET_LANGUAGE

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("prepgrid-translator")

if not BOT_TOKEN or BOT_TOKEN.startswith("PASTE_"):
    raise RuntimeError("Set BOT_TOKEN in Render environment variables or config.py.")

WEBHOOK_HOST = os.getenv("RENDER_EXTERNAL_HOSTNAME", "").strip()
WEBHOOK_PATH = f"/telegram/{BOT_TOKEN}"
WEBHOOK_SECRET = hashlib.sha256(BOT_TOKEN.encode()).hexdigest()[:32]
telegram_app = Application.builder().token(BOT_TOKEN).build()


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        f"Welcome to {BOT_NAME}!\n\n"
        "Send an English text-based PDF as a Telegram document. "
        "I will translate it into Gujarati using PDF Linguist.\n\n"
        "Commands: /start, /help"
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text(
        "Send an English PDF as a document. The bot returns a Gujarati PDF.\n\n"
        "This low-memory hosting setup has OCR disabled. Scanned/image-only pages "
        "may remain untranslated. Google translation can be rate-limited. "
        "Always proofread questions, answer options, formulas, units and diagrams."
    )


async def process_pdf(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = update.effective_message
    document = message.document
    if not document:
        return

    filename = document.file_name or "uploaded.pdf"
    if not filename.lower().endswith(".pdf"):
        await message.reply_text("Please send a PDF document.")
        return

    size_mb = (document.file_size or 0) / (1024 * 1024)
    if size_mb > MAX_DOWNLOAD_MB:
        await message.reply_text(f"File is {size_mb:.1f} MB; limit is {MAX_DOWNLOAD_MB} MB.")
        return

    status = await message.reply_text("PDF received. Checking pages...")
    workdir = Path(tempfile.mkdtemp(prefix="prepgrid_"))
    source_path = workdir / "source.pdf"
    output_path = workdir / "PrepGrid_Gujarati.pdf"

    try:
        tg_file = await context.bot.get_file(document.file_id)
        await tg_file.download_to_drive(custom_path=str(source_path))

        with fitz.open(source_path) as check:
            page_count = len(check)
            if not page_count:
                raise ValueError("The PDF is empty.")
            if page_count > MAX_PAGES:
                raise ValueError(f"PDF has {page_count} pages; current limit is {MAX_PAGES}.")
            selectable_chars = sum(len(check[i].get_text()) for i in range(min(page_count, 3)))

        if selectable_chars == 0:
            raise ValueError(
                "No selectable text found. OCR is disabled in this lightweight Render setup; "
                "scanned PDFs are not supported in this deployment."
            )

        await status.edit_text(f"Translating {page_count} pages into Gujarati. Please wait...")
        options = TranslateOptions(
            source=SOURCE_LANGUAGE,
            target=TARGET_LANGUAGE,
            translator="google",
            ocr="never",
        )
        pdf_bytes, report = await asyncio.to_thread(
            translate_pdf, str(source_path), options
        )
        output_path.write_bytes(pdf_bytes)
        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("PDF Linguist returned an empty output file.")

        warnings = getattr(report, "warnings", []) or []
        summary = (
            f"Translation finished.\nPages: {page_count}\n"
            f"Translated blocks: {getattr(report, 'translated', 'n/a')}\n"
            f"Failed blocks: {getattr(report, 'failed', 'n/a')}\n"
            f"Warnings: {len(warnings)}"
        )
        await status.edit_text(summary + "\nSending PDF...")
        with output_path.open("rb") as output:
            await message.reply_document(
                document=output,
                filename="PrepGrid_NEET_Gujarati.pdf",
                caption=(
                    "Gujarati PDF generated with PDF Linguist. Please verify every "
                    "question, option, formula, unit and diagram before using it."
                ),
                read_timeout=180,
                write_timeout=180,
                connect_timeout=30,
            )
        await status.delete()
    except Exception as exc:
        log.exception("PDF translation failed")
        await status.edit_text("Could not translate this PDF:\n" + str(exc)[:900])
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def unsupported_file(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text("Please upload a PDF as a document.")


telegram_app.add_handler(CommandHandler("start", start))
telegram_app.add_handler(CommandHandler("help", help_command))
telegram_app.add_handler(MessageHandler(filters.Document.PDF, process_pdf))
telegram_app.add_handler(MessageHandler(filters.Document.ALL, unsupported_file))


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
        log.info("Telegram webhook registered on Render host %s", WEBHOOK_HOST)
    else:
        log.warning("RENDER_EXTERNAL_HOSTNAME missing; webhook is not registered.")
    try:
        yield
    finally:
        if WEBHOOK_HOST:
            await telegram_app.bot.delete_webhook()
        await telegram_app.stop()
        await telegram_app.shutdown()


app = FastAPI(title=BOT_NAME, lifespan=lifespan)


@app.get("/")
async def health():
    return {"status": "ok", "service": BOT_NAME}


@app.post(WEBHOOK_PATH)
async def telegram_webhook(request: Request, x_telegram_bot_api_secret_token: str | None = Header(default=None)):
    if x_telegram_bot_api_secret_token != WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid webhook secret")
    data = await request.json()
    update = Update.de_json(data, telegram_app.bot)
    await telegram_app.update_queue.put(update)
    return {"ok": True}
