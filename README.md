# PrepGrid Gujarati PDF Translator Bot

Telegram bot integration using the upstream **PDF Linguist** Python package.

Upstream engine: https://github.com/NitinReddy-A/PDF_Linguist  
Upstream license: MIT (see the upstream repository).

## Features

- Receive PDF documents in Telegram.
- Translate English PDF text to Gujarati (Google engine).
- Use PDF Linguist for layout-aware extraction and Gujarati shaping.
- Return a translated PDF to the sender.
- Temporary working files are removed after each request.

## Important current deployment profile

This starter is deliberately configured for low-memory hosting:
- OCR is disabled (`ocr="never"`). Scanned/image-only PDFs are not translated.
- The bot rejects files larger than 19 MB.
- The bot limits PDFs to 200 pages.
- Translation uses Google's online translation backend and may be rate-limited.
- Formula accuracy, option alignment and page layout must be manually checked.
- Render Free has limited RAM/CPU and ephemeral storage. Large PDFs can fail or time out.

## Install

Python 3.10+ is required.

```bash
pip install --no-cache-dir -r requirements.txt
```

## Configure token

Preferred: set the Render environment variable `BOT_TOKEN`.

For local-only testing, replace the placeholder in `config.py`. Never commit a real token to a public repository. If a token is exposed, revoke it with BotFather and create a new one.

## Run locally

```bash
python bot.py
```

## Render

This repository currently uses long-polling mode in `render.yaml`. Render Free web services can sleep when idle; the bot may be unavailable until the service wakes, and polling may be interrupted. For reliable always-on bot operation, use an always-on worker/paid instance or convert the deployment to a webhook service.

Build command:
```bash
pip install --no-cache-dir -r requirements.txt
```

Start command:
```bash
python bot.py
```

Set `BOT_TOKEN` in Render Environment.

## NEET exam-paper warning

Do not assume a translated PDF is error-free. Before distributing it, compare every question, answer option, unit, scientific term, formula, diagram label and question number against the English source. The bot reports engine failures but cannot certify translation correctness.

## Project note

This repository contains the Telegram integration and installs PDF Linguist from its public GitHub repository through `requirements.txt`; it does not copy or vendor the upstream engine source. This keeps upstream updates and licensing clearer.
