---
title: WABOT 2.0
emoji: 🤖
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# 🤖 WABOT 2.0 (RonnBot) - Cloud Container Edition

WhatsApp Bot Modular Automation based on Baileys, integrated with BotOS Web Dashboard, 24/7 Live Radio Streaming, and AI capabilities.

## 🚀 Fitur Utama

- **WhatsApp Engine**: Baileys multi-device pairing & QR login via web UI (`/qr`).
- **BotOS Dashboard**: Panel kontrol web interaktif di port 7860 (`/dashboard`).
- **Live Radio Station**: Audio streaming real-time (`/radio` & `/stream`).
- **Automated Cloud Session Sync**: Kredensial sesi WhatsApp secara otomatis di-backup & di-restore melalui Hugging Face Dataset (`ronnlbtrn/wabot-storage`), sehingga bot tidak perlu pairing ulang saat container restart/rebuild.
- **Serverless PostgreSQL**: Terintegrasi penuh dengan Prisma ORM via Neon.tech.

## ⚙️ Konfigurasi Environment (HF Space Secrets)

Tambahkan variabel berikut pada **Space Settings → Variables and secrets**:

| Key | Tipe | Deskripsi |
| --- | --- | --- |
| `DATABASE_URL` | Secret | Connection string Neon.tech PostgreSQL (contoh: `postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require`) |
| `HF_TOKEN` | Secret | Hugging Face Access Token dengan izin *write* ke dataset |
| `HF_DATASET_REPO` | Variable / Secret | Nama repo dataset untuk storage (default: `ronnlbtrn/wabot-storage`) |
| `HF_API_URL` | Variable / Secret | Backend downloader Hugging Face (contoh: `https://ronnlbtrn-downloader.hf.space`) |
| `OWNER_NUMBER` | Variable / Secret | Nomor WhatsApp pemilik bot (contoh: `6285172013920`) |
| `BOT_NUMBER` | Variable / Secret | Nomor bot untuk direct pairing code jika ada |
| `BOT_PREFIX` | Variable / Secret | Prefix perintah bot (default: `!`) |
| `GEMINI_API_KEY` | Secret | API key Google Gemini AI |
| `GROQ_API_KEY` | Secret | API key Groq Cloud AI |
| `NVIDIA_API_KEY` | Secret | API key NVIDIA NIM (Kimi K2.6) |
| `WEATHER_API_KEY` | Secret | API key Cuaca (WeatherAPI) |
| `DISCORD_TOKEN` | Secret | Token bot Discord (opsional) |

*Jalankan `node scripts/hf_env_export.js` di lokal untuk mengekstrak seluruh daftar variabel dari `.env`.*

## 🌐 Endpoints Publik

- `/dashboard` — BotOS Web Dashboard
- `/radio` — Radio Station & Music Player
- `/qr` — Tampilan QR Code WhatsApp untuk scan langsung di browser
- `/api/system/ping` — Container Health Check (Port 7860)

## 🔄 Keep-Alive (Agar Space Tidak Tidur)

Hugging Face Spaces gratis akan *sleep* setelah 48 jam jika tidak menerima traffic HTTP. Disarankan memasang monitor gratis (seperti [cron-job.org](https://cron-job.org) atau UptimeRobot) untuk melakukan ping ke:
`https://<username>-<space-name>.hf.space/api/system/ping` setiap 10–15 menit.
