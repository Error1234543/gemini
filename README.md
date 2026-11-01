# PrepGrid Gujarati PDF Translator Bot

Telegram bot powered by the upstream [PDF Linguist](https://github.com/NitinReddy-A/PDF_Linguist) package (MIT license).

## What it does
- Receives PDF documents in Telegram.
- Translates English PDF text to Gujarati using PDF Linguist's Google backend.
- Uses layout-aware PDF extraction and Indic-script rendering.
- Sends the translated PDF back to the sender.
- Removes temporary files after processing.

## Render deployment
This repository is configured as a Render **Web Service** using Telegram webhooks.

1. Create a new Render Web Service from this GitHub repository.
2. Choose the Free instance for initial testing.
3. Render reads `render.yaml`; build command is `pip install --no-cache-dir -r requirements.txt`.
4. Add environment variable `BOT_TOKEN` with your Telegram bot token in Render's Environment tab.
5. Deploy. The root URL should return a JSON health response.

Do not commit a real token to GitHub. If a token is exposed, revoke it with BotFather and generate a replacement.

## Current low-memory profile
- OCR disabled (`ocr="never"`): scanned/image-only pages are not translated in this configuration.
- Telegram file download limit configured to 19 MB.
- PDF page limit: 200.
- Google translation is online and may be rate-limited.
- Render Free has limited RAM/CPU and sleeps when idle. A cold start may delay Telegram webhook processing. Large PDFs may time out or run out of memory.
- For reliability, move to a paid always-on service and test with small PDFs first.

## Local development
Install requirements, set `BOT_TOKEN` in environment or `config.py`, then run:

```bash
uvicorn bot:app --host 0.0.0.0 --port 8000
```

For local webhook testing, expose the local server through a trusted HTTPS tunnel and set `RENDER_EXTERNAL_HOSTNAME` accordingly.

## NEET paper quality warning
No automated translator can guarantee zero errors. Compare every translated question, answer choice, formula, unit, scientific name and diagram label against the source PDF before sharing with students.

## Upstream source
This repository installs PDF Linguist from its original public GitHub repository via `requirements.txt`; it does not duplicate or claim ownership of the upstream source. See the upstream MIT license and attribution.
