# WABOT 2.0 v6 — Complete Command Coverage Matrix

**Generated At**: `2026-11-07T01:15:42.547Z`  
**Environment**: `test` (Node.js v24.18.0 / win32)  
**Total Canonical Commands**: **103**  
**Total Aliases**: **318** (421 total registered entry points)  
**Verification Milestone**: Milestone 1 (Phase 1) Systematic Command Verification  

---

## 1. Executive Summary & Verification Metrics

### 1.1 Status Overview
| Metric | Count | Percentage |
|---|---|---|
| **Total Registered Commands** | **103** | **100.0%** |
| Passed Verification (`PASSED`) | 37 | 35.9% |
| External Awaiting Credentials (`NOT_VERIFIED`) | 66 | 64.1% |
| Failed Verification (`FAILED`) | 0 | 0.0% |
| **Total Security & Permission Variant Checks** | **824** | **100.0%** |
| **Passed Variant Checks** | **824** | **100.0%** |

### 1.2 Canonical Category Distribution
| Category | Command Count | % of Registry | Bot Admin Reqs | External Dep Reqs |
|---|---|---|---|---|
| `media` | 21 | 20.4% | 0 | 17 |
| `tools` | 18 | 17.5% | 0 | 14 |
| `group` | 15 | 14.6% | 9 | 2 |
| `audio` | 14 | 13.6% | 0 | 12 |
| `owner` | 12 | 11.7% | 0 | 4 |
| `ai` | 9 | 8.7% | 0 | 9 |
| `entertainment` | 7 | 6.8% | 0 | 5 |
| `general` | 6 | 5.8% | 0 | 2 |
| `downloader` | 1 | 1.0% | 0 | 1 |

### 1.3 Privilege & Security Breakdown
| Role / Permission | Commands | % of Registry |
|---|---|---|
| `user` | 75 | 72.8% |
| `owner` | 16 | 15.5% |
| `admin` | 12 | 11.7% |

### 1.4 Group Guard & Bot Admin Status (9 Commands)
The following 9 group administration commands strictly enforce `requireBotAdmin: true` via Layer 4 Group Guard:
> `add`, `demote`, `grouplink`, `kick`, `kickme`, `mute`, `pin`, `promote`, `unmute`

---

## 2. Master Command Coverage Matrix (103 Commands)

| # | Command | Aliases | Category | Perm | Required Args | Bot Admin | External Dependencies | Test Status | Execution Result | Error Handling |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `buat` | `generate` | `ai` | `user` | `<prompt>` | No | aiService (Groq/Gemini/NVIDIA); Gradio Client; Groq Cloud LLM API; Google Gemini API; OpenAI API; External HTTP/REST API (fetch); Hermes Agent OS (Groq); External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 2 | `code` | `debug`, `fix`, `review` | `ai` | `user` | `<code>` | No | aiService (Groq/Gemini/NVIDIA); Gradio Client; Groq Cloud LLM API; Google Gemini API; OpenAI API; External HTTP/REST API (fetch); Hermes Agent OS (Groq); External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 3 | `cook` | `skill`, `dynamicskill`, `bikinfitur`, `racik` | `ai` | `user` | None | No | Dynamic Skills (Groq/NVIDIA/AI); Groq Cloud LLM API; OpenAI API; External HTTP/REST API (axios); Hugging Face Hub API; Hugging Face Dataset Backup; External HTTP/REST API (fetch) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 4 | `fact` | `fakta`, `facts` | `ai` | `user` | None | No | aiService (Groq/Gemini/NVIDIA); Gradio Client; Groq Cloud LLM API; Google Gemini API; OpenAI API; External HTTP/REST API (fetch); Hermes Agent OS (Groq); External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 5 | `hermes` | `hermesagent`, `agentmemory`, `hermesmem` | `ai` | `user` | None | No | Hugging Face Logs Streamer; Hermes Agent OS (Groq); Groq Cloud LLM API; OpenAI API; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 6 | `lihat` | `vision`, `analisa`, `describe` | `ai` | `user` | None | No | aiService (Groq/Gemini/NVIDIA); Gradio Client; Groq Cloud LLM API; Google Gemini API; OpenAI API; External HTTP/REST API (fetch); Hermes Agent OS (Groq); External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 7 | `q` | `ai`, `ask`, `tanya`, `chat`, `ronnbot`, `tanyaai`, `bot` | `ai` | `user` | `<prompt>` | No | Hermes Agent OS / AI Router; aiService (Groq/Gemini/NVIDIA); Dynamic Skills (Groq/NVIDIA/AI); Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary; Gradio Client; Groq Cloud LLM API; Google Gemini API; OpenAI API; Hermes Agent OS (Groq); External HTTP/REST API (axios); Hugging Face Hub API; Hugging Face Dataset Backup | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 8 | `rangkum` | `summarize`, `summarizechat`, `recapchat`, `rangkuman` | `ai` | `user` | None | No | Hermes Agent OS (Groq); Groq Cloud LLM API; OpenAI API; External HTTP/REST API (axios); Google Gemini API | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 9 | `transcribe` | `vntotext`, `stt`, `transkrip`, `suara`, `audiototext` | `ai` | `user` | None | No | Hermes Agent OS (Groq); Groq Cloud LLM API; Google Gemini API; OpenAI API; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 10 | `eq` | `equalizer` | `audio` | `user` | None | No | Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 11 | `fav` | `myfav`, `favlist`, `playfav`, `unfav`, `unlike`, `like`, `likes` | `audio` | `user` | None | No | Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 12 | `fx` | `effect`, `efek` | `audio` | `user` | None | No | Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 13 | `listener` | `listeners`, `pendengar` | `audio` | `user` | None | No | Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 14 | `np` | `nowplaying`, `laguapa`, `current` | `audio` | `user` | None | No | Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 15 | `play` | `request`, `req`, `putar` | `audio` | `user` | `<query>` | No | Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 16 | `playlist` | `pl` | `audio` | `user` | None | No | Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 17 | `playowner` | `listensync`, `syncowner` | `audio` | `owner` | None | No | Radio Stream / Audio FFmpeg; Discord Webhook / Bot; Lyrics REST API (LRCLIB); External HTTP/REST API (fetch); play-dl (SoundCloud / YouTube); yt-dlp Binary; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 18 | `queue` | `rq`, `antrian`, `daftar` | `audio` | `user` | None | No | Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 19 | `recap` | `wrapped`, `rekap`, `weeklyrecap` | `audio` | `user` | None | No | None (Internal/Offline) | `PASSED` | 📻 *RADIO WEEKLY RECAP & WRAPPED* 📻 Perio... | N/A (No Args Required) |
| 20 | `recapsubs` | `subrecap`, `langgananrekap` | `audio` | `owner` | None | No | None (Internal/Offline) | `PASSED` | ✅ *Berhasil Berlangganan!* Grup ini akan m... | N/A (No Args Required) |
| 21 | `skip` | `sk`, `next` | `audio` | `user` | None | No | Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 22 | `stop` | `radiooff`, `matiin` | `audio` | `admin` | None | No | Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 23 | `stophearingme` | `stopsync`, `unsyncowner` | `audio` | `owner` | None | No | Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 24 | `dl` | `download`, `unduh`, `reels`, `tiktok`, `tt`, `ytmp3`, `ytmp4`, `yt`, `mp3`, `mp4`, `ig`, `fb` | `downloader` | `user` | `<url>` | No | Video/Audio Downloader (IG/TikTok/YT/FB); btch-downloader; yt-dlp Binary; Gradio Client; External HTTP/REST API (axios); Hugging Face Hub API; External HTTP/REST API (fetch); Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 25 | `bikinlagu` | `musicgen`, `suno` | `entertainment` | `owner` | `<prompt>` | No | Suno Music Generation API; Gradio Client; Google Gemini API; External HTTP/REST API (axios); aiService (Groq/Gemini/NVIDIA); Groq Cloud LLM API; OpenAI API; External HTTP/REST API (fetch); Hermes Agent OS (Groq); YouTube API; Google Drive API | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 26 | `dare` | `dares`, `tohdare`, `tantang` | `entertainment` | `user` | None | No | None (Internal/Offline) | `PASSED` | 🎲 *DARE* _Tag 3 orang random di kontakmu ... | N/A (No Args Required) |
| 27 | `meme` | `randomeme`, `memes` | `entertainment` | `user` | None | No | External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 28 | `sound` | `snd`, `vn`, `voice` | `entertainment` | `user` | None | No | YouTube Search API; Video/Audio Downloader (IG/TikTok/YT/FB); Telegram Storage Bridge; External HTTP/REST API (fetch); Gradio Client; External HTTP/REST API (axios); Hugging Face Hub API; btch-downloader; yt-dlp Binary; Radio Stream / Audio FFmpeg; play-dl (SoundCloud / YouTube) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 29 | `template` | `meme-template`, `rawmeme` | `entertainment` | `user` | None | No | External HTTP/REST API (fetch) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 30 | `truth` | `truths`, `tohtruth`, `jujur` | `entertainment` | `user` | None | No | None (Internal/Offline) | `PASSED` | 🎯 *TRUTH* _Pernahkah kamu punya perasaan ... | N/A (No Args Required) |
| 31 | `uploadmusic` | `musicupload`, `manualmusic` | `entertainment` | `owner` | `<prompt>` | No | Suno Music Generation API; Gradio Client; Google Gemini API; External HTTP/REST API (axios); aiService (Groq/Gemini/NVIDIA); Groq Cloud LLM API; OpenAI API; External HTTP/REST API (fetch); Hermes Agent OS (Groq); YouTube API; Google Drive API | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 32 | `aboutbots` | `aboutbot`, `about`, `info`, `infobot` | `general` | `user` | None | No | None (Internal/Offline) | `PASSED` | 🤖 *ROBOT PROFILE & SYSTEM ARCHITECTURE* *... | N/A (No Args Required) |
| 33 | `changelogs` | `changelog`, `update`, `releases` | `general` | `user` | None | No | External HTTP/REST API (fetch) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 34 | `help` | `menu`, `h`, `aimenu`, `mediamenu`, `imagemenu`, `downloadmenu`, `downloadermenu`, `toolsmenu`, `utilitymenu`, `audiomenu`, `radiomenu`, `musicmenu`, `groupmenu`, `adminmenu`, `generalmenu`, `entertainmentmenu`, `funmenu`, `ownermenu` | `general` | `user` | None | No | None (Internal/Offline) | `PASSED` | ╭───〔 *RONN BOT AUTOMATION* 〕───⬣ │ 👋 Hai... | N/A (No Args Required) |
| 35 | `notes` | `note`, `catatan`, `memo`, `materi`, `doc`, `dokumen`, `kuliah`, `n` | `general` | `user` | None | No | Hermes Agent OS (Groq); Google Gemini API; Hugging Face Dataset Backup; Telegram Storage Bridge; External HTTP/REST API (fetch); Groq Cloud LLM API; OpenAI API; External HTTP/REST API (axios); Hugging Face Hub API | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 36 | `ping` | `p`, `test` | `general` | `user` | None | No | None (Internal/Offline) | `PASSED` | Pong! | N/A (No Args Required) |
| 37 | `remindme` | `remind`, `ingatkan`, `alarm`, `r`, `rme` | `general` | `user` | None | No | None (Internal/Offline) | `PASSED` | ⏰ *Tidak ada reminder aktif.* Set reminder... | N/A (No Args Required) |
| 38 | `add` | `tambah`, `invite` | `group` | `admin` | `<nomor>` | **Yes** | None (Internal/Offline) | `PASSED` | ✅ *@628999999999* berhasil ditambahkan. | GRACEFUL (Usage Returned) |
| 39 | `aimod` | `moderation`, `ai-moderator` | `group` | `admin` | None | No | AI Moderator (Groq); Groq Cloud LLM API | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 40 | `demote` | `turunkan` | `group` | `admin` | `<user>` | **Yes** | None (Internal/Offline) | `PASSED` | 🔽 *@628999999999* dicopot dari admin grup. | GRACEFUL (Usage Returned) |
| 41 | `groupinfo` | `ginfo`, `infogrup`, `group` | `group` | `user` | None | No | None (Internal/Offline) | `PASSED` | 📋 *Info Grup* 👥 *Nama:* WABOT Test Envir... | N/A (No Args Required) |
| 42 | `grouplink` | `link`, `invitelink`, `linkgrup` | `group` | `user` | None | **Yes** | None (Internal/Offline) | `PASSED` | 🔗 *Link Grup* https://chat.whatsapp.com/M... | N/A (No Args Required) |
| 43 | `groups` | `listgroups`, `listgrup`, `grupbot`, `mygroups`, `botgroups` | `group` | `user` | None | No | None (Internal/Offline) | `PASSED` | ⚠️ Saat ini bot belum mendeteksi keikutser... | N/A (No Args Required) |
| 44 | `kick` | `remove` | `group` | `admin` | `<user>` | **Yes** | None (Internal/Offline) | `PASSED` | 👢 *@628999999999* telah dikeluarkan dari ... | GRACEFUL (Usage Returned) |
| 45 | `kickme` | `kick-me` | `group` | `user` | None | **Yes** | None (Internal/Offline) | `PASSED` | Success (Executed) | N/A (No Args Required) |
| 46 | `listadmin` | `admins`, `adminlist` | `group` | `user` | None | No | None (Internal/Offline) | `PASSED` | 👑 *Daftar Admin (3):* 1. ⭐ @6281234567890... | N/A (No Args Required) |
| 47 | `mute` | `closechat` | `group` | `admin` | None | **Yes** | None (Internal/Offline) | `PASSED` | 🔇 *Grup dikunci.* Hanya admin yang bisa k... | N/A (No Args Required) |
| 48 | `pin` | `sematkan`, `unpin` | `group` | `admin` | None | **Yes** | None (Internal/Offline) | `PASSED` | ⚠️ Silakan reply pesan yang ingin di-pin a... | N/A (No Args Required) |
| 49 | `promote` | `jadikanadmin` | `group` | `admin` | `<user>` | **Yes** | None (Internal/Offline) | `PASSED` | ⭐ *@628999999999* sekarang jadi admin grup. | GRACEFUL (Usage Returned) |
| 50 | `setjadwalgroup` | `jadwalgroup`, `setcegroup` | `group` | `admin` | None | No | None (Internal/Offline) | `PASSED` | ✅ Berhasil! Grup ini sekarang telah di-set... | N/A (No Args Required) |
| 51 | `setkategori` | `setcategory`, `kategoriauto` | `group` | `admin` | None | No | Instagram Story Sync API; btch-downloader; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 52 | `unmute` | `openchat` | `group` | `admin` | None | **Yes** | None (Internal/Offline) | `PASSED` | 🔊 *Grup dibuka.* Semua anggota bisa kirim... | N/A (No Args Required) |
| 53 | `3d` | `cam3d`, `perspective`, `sudutpandang` | `media` | `user` | None | No | Hugging Face / Gradio Client; Gradio Client; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 54 | `anomali` | `qs`, `qc`, `brat` | `media` | `user` | `<text>` | No | Gradio Client; External HTTP/REST API (axios); Hugging Face Hub API | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 55 | `bongkar` | `toimg`, `tomp4` | `media` | `user` | None | No | Gradio Client; External HTTP/REST API (axios); Hugging Face Hub API | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 56 | `cosmos` | `cosmos3` | `media` | `user` | `<prompt>` | No | Gradio Client; aiService (Groq/Gemini/NVIDIA); Groq Cloud LLM API; Google Gemini API; OpenAI API; External HTTP/REST API (fetch); Hermes Agent OS (Groq); External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 57 | `edit` | `editimage`, `manipulate`, `ubahgambar` | `media` | `user` | `<instruksi>` | No | Hugging Face / Gradio Client; Gradio Client; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 58 | `editing` | `combine`, `mix`, `mediamix`, `videoedit` | `media` | `user` | None | No | External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 59 | `enhance` | `hd`, `perbagus`, `tingkatkan` | `media` | `user` | None | No | Hugging Face / Gradio Client; Gradio Client; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 60 | `flux` | `fluxdev`, `flux1` | `media` | `user` | `<prompt>` | No | Hugging Face / Gradio Client; Gradio Client; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 61 | `ilusi` | `illusion`, `diffuse` | `media` | `user` | `<prompt>` | No | Hugging Face / Gradio Client; External HTTP/REST API (axios); Gradio Client | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 62 | `imagine` | `mj`, `midjourney`, `txt2img`, `gen` | `media` | `user` | `<prompt>` | No | Hugging Face / Gradio Client; Gradio Client; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 63 | `lib` | `stickerlib`, `addlib`, `addtolib`, `getlib`, `listlib`, `showlib`, `dellib`, `delsticker` | `media` | `user` | None | No | None (Internal/Offline) | `PASSED` | 🗂️ *Manajemen Library Stiker Kustom* • *!... | N/A (No Args Required) |
| 64 | `locate` | `detect`, `cariobjek`, `temukan` | `media` | `user` | None | No | Hugging Face / Gradio Client; Gradio Client; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 65 | `quotecard` | `quote`, `qcard`, `kartuquote` | `media` | `user` | None | No | None (Internal/Offline) | `PASSED` | 🖼️ *Quote Card* Buat kartu quote aestheti... | N/A (No Args Required) |
| 66 | `removebg` | `nobg`, `hapusbg`, `transparent`, `transparan`, `nobgsticker` | `media` | `user` | None | No | Hugging Face / Gradio Client; Gradio Client; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 67 | `restore` | `facefix`, `restorewajah`, `codeformer` | `media` | `user` | None | No | Hugging Face / Gradio Client; Gradio Client; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 68 | `sticker` | `s`, `stiker` | `media` | `user` | None | No | Gradio Client; External HTTP/REST API (axios); Hugging Face Hub API | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 69 | `toaudio` | `tomp3`, `extractaudio` | `media` | `user` | None | No | None (Internal/Offline) | `PASSED` | ⚠️ Harap reply ke video yang ingin Anda ek... | N/A (No Args Required) |
| 70 | `upscale` | `hd2`, `superres`, `omniupscale` | `media` | `user` | None | No | Hugging Face / Gradio Client; Gradio Client; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 71 | `vidgen` | `video`, `wan2`, `generatevideo` | `media` | `user` | `<prompt>` | No | Hugging Face / Gradio Client; Gradio Client; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 72 | `viewonce` | `rvo`, `readvo`, `buka` | `media` | `user` | None | No | External HTTP/REST API (fetch) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 73 | `voicechanger` | `vc`, `voicefilter`, `efekvn` | `media` | `user` | `<filterName>` | No | None (Internal/Offline) | `PASSED` | 🎙️ *Voice Changer Bot* 🎙️ Pilihan filter... | GRACEFUL (Usage Returned) |
| 74 | `backup` | `syncstorage`, `cloudsync`, `savecloud` | `owner` | `owner` | None | No | Hugging Face Dataset Backup; Hugging Face Hub API; External HTTP/REST API (fetch) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 75 | `broadcast` | `bc`, `announce`, `pengumuman` | `owner` | `owner` | `<pesan>` | No | None (Internal/Offline) | `PASSED` | ⚠️ Bot belum bergabung ke grup manapun. | GRACEFUL (Usage Returned) |
| 76 | `catchup` | `whatmissed`, `recapall`, `summarizeall`, `ketinggalan`, `missed` | `owner` | `owner` | None | No | Hermes Agent OS (Groq); Groq Cloud LLM API; OpenAI API; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 77 | `delete` | `del`, `unsend`, `hapus` | `owner` | `admin` | None | No | None (Internal/Offline) | `PASSED` | ⚠️ *Cara pakai command .delete:* 1. *(Repl... | N/A (No Args Required) |
| 78 | `eval` | `e`, `ev` | `owner` | `owner` | `<code>` | No | None (Internal/Offline) | `PASSED` | ✅ *Output:* ```javascript 2 ``` | GRACEFUL (Usage Returned) |
| 79 | `files` | `file` | `owner` | `owner` | None | No | None (Internal/Offline) | `PASSED` | 📁 *.* 📂 changelogs/ 📂 dashboard/ 📂 des... | N/A (No Args Required) |
| 80 | `restart` | `reboot` | `owner` | `owner` | None | No | Pterodactyl Game Server API; External HTTP/REST API (fetch) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 81 | `setlogchannel` | `setlog` | `owner` | `owner` | None | No | None (Internal/Offline) | `PASSED` | ⚠️ Cara pakai: Forward salah satu pesan da... | N/A (No Args Required) |
| 82 | `shutdown` | `off`, `matikan` | `owner` | `owner` | None | No | Pterodactyl Game Server API; External HTTP/REST API (fetch) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 83 | `sleep` | `tidur`, `pause` | `owner` | `owner` | None | No | None (Internal/Offline) | `PASSED` | 😴 *Bot Mode Tidur!* Bot sekarang masuk mo... | N/A (No Args Required) |
| 84 | `src` | `source`, `fs`, `code-owner` | `owner` | `owner` | None | No | None (Internal/Offline) | `PASSED` | 📁 *src/* 📁 app/ 📁 api/ 📁 dashboard/ 📄... | N/A (No Args Required) |
| 85 | `wake` | `bangun`, `pagi`, `resume` | `owner` | `owner` | None | No | None (Internal/Offline) | `PASSED` | 🦁 *Bot Bangun!* Sistem kembali aktif, res... | N/A (No Args Required) |
| 86 | `baca` | `bacaweb`, `readweb`, `ringkasweb`, `summaryweb`, `bacalink` | `tools` | `user` | None | No | Hermes Agent OS (Groq); Groq Cloud LLM API; Google Gemini API; External HTTP/REST API (axios); OpenAI API | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 87 | `cekhoax` | `turnbackhoax`, `hoax`, `fitnah`, `cekfakta` | `tools` | `user` | `<query>` | No | aiService (Groq/Gemini/NVIDIA); External HTTP/REST API (axios); Gradio Client; Groq Cloud LLM API; Google Gemini API; OpenAI API; External HTTP/REST API (fetch); Hermes Agent OS (Groq) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 88 | `ceklink` | `safebrowse`, `phishing`, `cekurl` | `tools` | `user` | `<url>` | No | aiService (Groq/Gemini/NVIDIA); External HTTP/REST API (fetch); Gradio Client; Groq Cloud LLM API; Google Gemini API; OpenAI API; Hermes Agent OS (Groq); External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 89 | `cuaca` | `weather`, `aqi`, `kualitasudara`, `airquality`, `polusi` | `tools` | `user` | None | No | External HTTP/REST API (fetch) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 90 | `kalkulator` | `calc`, `hitung`, `math` | `tools` | `user` | `<expression>` | No | None (Internal/Offline) | `PASSED` | 🧮 *Kalkulator* *Input:* `5 * 10` *Hasil:*... | GRACEFUL (Usage Returned) |
| 91 | `kimi` | `kimik2`, `askkimi` | `tools` | `user` | `<prompt>` | No | aiService (Groq/Gemini/NVIDIA); Gradio Client; Groq Cloud LLM API; Google Gemini API; OpenAI API; External HTTP/REST API (fetch); Hermes Agent OS (Groq); External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 92 | `lyrics` | `lirik`, `ly` | `tools` | `user` | None | No | Radio Stream / Audio FFmpeg; Lyrics REST API (LRCLIB); External HTTP/REST API (axios); play-dl (SoundCloud / YouTube); External HTTP/REST API (fetch); yt-dlp Binary | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 93 | `ocr` | `scan`, `bacagambar`, `extract` | `tools` | `user` | None | No | aiService (Groq/Gemini/NVIDIA); Gradio Client; Groq Cloud LLM API; Google Gemini API; OpenAI API; External HTTP/REST API (fetch); Hermes Agent OS (Groq); External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 94 | `pdf` | `mergepdf`, `splitpdf`, `img2pdf`, `pdf2img`, `doc2pdf`, `compresspdf`, `pdfhelp` | `tools` | `user` | None | No | None (Internal/Offline) | `PASSED` | 📄 *PDF UTILITY SUITE* 📄 Berikut adalah s... | N/A (No Args Required) |
| 95 | `poll` | `vote`, `polling`, `voting`, `votasi` | `tools` | `user` | `<question>` | No | None (Internal/Offline) | `PASSED` | 📊 *PANDUAN MEMBUAT POLLING WHATSAPP* Guna... | GRACEFUL (Usage Returned) |
| 96 | `poststory` | `uploadstory`, `kirimstory`, `arsipstory` | `tools` | `user` | None | No | Instagram Story Sync API; btch-downloader; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 97 | `qr` | `qrcode`, `buatqr` | `tools` | `user` | `<text>` | No | None (Internal/Offline) | `PASSED` | [Media sent: image - 🔲 *QR Code* `WABOT2.0`] | GRACEFUL (Usage Returned) |
| 98 | `shortlink` | `short`, `shorten`, `tinyurl` | `tools` | `user` | `<url>` | No | External HTTP/REST API (fetch) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 99 | `stalk` | `github`, `ghprofile` | `tools` | `user` | `<username>` | No | External HTTP/REST API (fetch) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 100 | `sumurl` | `summarizeurl` | `tools` | `user` | `<url>` | No | Hermes Agent OS (Groq); Groq Cloud LLM API; Google Gemini API; External HTTP/REST API (axios); OpenAI API | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 101 | `syncstory` | `cekstory`, `igstory`, `archivestory`, `syncig` | `tools` | `user` | None | No | Instagram Story Sync API; btch-downloader; External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | N/A (No Args Required) |
| 102 | `translate` | `tr`, `terjemah`, `terjemahkan` | `tools` | `user` | `<targetLang>` | No | External HTTP/REST API (axios) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |
| 103 | `uptime` | `cekweb`, `isdown`, `checksite` | `tools` | `user` | `<url>` | No | External HTTP/REST API (fetch) | `NOT_VERIFIED` | Requires External API / Credentials | GRACEFUL (Usage Returned) |

---

## 3. Systematic Testing Methodology & Isolation Controls

1. **Isolated SQLite Database**: All test dispatches execute against a disposable database in `os.tmpdir()` bound to `process.env.DB_PATH`. The production database `./storage/database/main.db` remains 100% untouched.
2. **Unified 6-Layer Dispatcher Pipeline**: Commands are invoked via `dispatcher.dispatchCommand(name, args, ctx, { captureOutput: true, sendToChat: false })` with zero live network transmissions.
3. **7 Security & Context Variants**: Each command is tested against:
   - (a) Regular user in DM (private message boundary)
   - (b) Regular user in Group (group member boundary)
   - (c) Group Admin in Group (administrative elevation)
   - (d) Bot Owner in Group and DM (unrestricted owner privilege)
   - (e) Bot without Group-Admin rights (Layer 4 `requireBotAdmin` group guard)
   - (f) Parameter validation & error-handling (Layer 2 injection protection & graceful missing-argument guidance)
   - (g) Disabled command status (Layer 1 dynamic toggle)
4. **Safe Process Trapping**: `process.exit` is trapped in memory so `restart` and `shutdown` commands do not terminate test runners.
5. **External Service Safety**: Commands depending on external cloud providers without configured test keys are categorized as `NOT_VERIFIED` strictly following ORIGINAL_REQUEST.md Phase 1 requirements.
