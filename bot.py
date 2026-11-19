import os
import io
import json
import asyncio
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

from telegram import Update
from telegram.ext import Application, MessageHandler, CommandHandler, filters, ContextTypes
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

BOT_TOKEN = os.environ["BOT_TOKEN"]
FOLDER_ID = os.environ["DRIVE_FOLDER_ID"]
PORT = int(os.environ.get("PORT", 10000))
SCOPES = ["https://www.googleapis.com/auth/drive"]

if os.environ.get("GOOGLE_CREDENTIALS_JSON"):
    info = json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"])
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
else:
    creds = service_account.Credentials.from_service_account_file("service_account.json", scopes=SCOPES)

drive = build("drive", "v3", credentials=creds, cache_discovery=False)


# ---------- Health check server (UptimeRobot isko ping karega) ----------
class Ping(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Bot is alive")

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


def run_server():
    HTTPServer(("0.0.0.0", PORT), Ping).serve_forever()


# ---------- Drive upload ----------
def upload_to_drive(data: bytes, filename: str) -> dict:
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype="application/pdf", resumable=False)
    meta = {"name": filename, "parents": [FOLDER_ID]}
    file = drive.files().create(
        body=meta,
        media_body=media,
        fields="id, name, webViewLink",
        supportsAllDrives=True,
    ).execute()

    drive.permissions().create(
        fileId=file["id"],
        body={"type": "anyone", "role": "reader"},
        supportsAllDrives=True,
    ).execute()
    return file


# ---------- Telegram handlers ----------
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🚀 PREPGRID PDF UPLOAD CENTER\n"
        "━━━━━━━━━━━━━━━━━━━━\n\n"
        "Welcome! Your personal Google Drive upload assistant is ready.\n\n"
        "📄 HOW TO UPLOAD\n"
        "1️⃣ Select your PDF file in Telegram.\n"
        "2️⃣ Send it here as a Document (not as a Photo).\n"
        "3️⃣ Wait while the file is securely uploaded to Google Drive.\n"
        "4️⃣ Get your shareable download link instantly.\n\n"
        "✨ FEATURES\n"
        "• Direct Google Drive upload\n"
        "• Automatic shareable link\n"
        "• Original PDF filename preserved\n\n"
        "📌 READY TO BEGIN?\n"
        "Send your PDF document now.\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "Your files. One simple upload."
    )


async def handle_document(update: Update, context: ContextTypes.DEFAULT_TYPE):
    doc = update.message.document
    if not doc or doc.mime_type != "application/pdf":
        await update.message.reply_text("Sirf PDF file bhejo.")
        return

    status = await update.message.reply_text("Upload ho raha hai...")
    try:
        tg_file = await doc.get_file()
        data = bytes(await tg_file.download_as_bytearray())
        file = await asyncio.to_thread(upload_to_drive, data, doc.file_name or "file.pdf")
        await status.edit_text(f"✅ Upload ho gaya!\\n\\n📄 {file['name']}\\n🔗 {file['webViewLink']}")
    except Exception as e:
        await status.edit_text(f"❌ Error: {e}")


def main():
    threading.Thread(target=run_server, daemon=True).start()

    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.Document.PDF, handle_document))
    print("Bot chal raha hai...")
    app.run_polling()


if __name__ == "__main__":
    main()
