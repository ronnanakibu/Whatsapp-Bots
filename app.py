import os
import sys
import time
import shutil
import tarfile
import urllib.request
import subprocess
import asyncio
from pathlib import Path

# Set default timezone & environment
os.environ["TZ"] = os.environ.get("BOT_TIMEZONE", "Asia/Jakarta")
os.environ["NODE_ENV"] = "production"

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage"
BIN_DIR = STORAGE_DIR / "bin"
NODE_DIR = BIN_DIR / "node-v20"
LOGS_DIR = STORAGE_DIR / "logs"

# Ensure storage directories exist
for folder in ["sessions", "database", "logs", "media", "media/tmp", "bin", "stickers"]:
    (STORAGE_DIR / folder).mkdir(parents=True, exist_ok=True)

(BASE_DIR / "src" / "assets" / "fonts").mkdir(parents=True, exist_ok=True)

def log(msg: str):
    print(f"🚀 [HF-Bootstrap] {msg}", flush=True)

def ensure_node():
    """Ensure Node.js v20+ is available in the environment."""
    # Check existing system node
    node_bin = shutil.which("node")
    if node_bin:
        try:
            ver = subprocess.check_output([node_bin, "--version"], text=True).strip()
            major = int(ver.lstrip("v").split(".")[0])
            if major >= 20:
                log(f"System Node.js found: {ver}")
                return node_bin
        except Exception:
            pass

    # Check cached standalone node
    custom_node = NODE_DIR / "bin" / "node"
    if custom_node.exists():
        log(f"Cached Node.js v20 found at {custom_node}")
        os.environ["PATH"] = f"{NODE_DIR / 'bin'}:{BIN_DIR}:{os.environ.get('PATH', '')}"
        return str(custom_node)

    # Download Node.js v20.18.0 Linux x64 standalone binary
    log("Downloading official Node.js v20.18.0 Linux x64 binary...")
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    archive_url = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz"
    archive_path = BIN_DIR / "node-v20.tar.xz"

    try:
        urllib.request.urlretrieve(archive_url, archive_path)
        log("Extracting Node.js binary...")
        try:
            subprocess.run(["tar", "-xf", str(archive_path), "-C", str(BIN_DIR)], check=True)
        except Exception:
            with tarfile.open(archive_path, "r:xz") as tar:
                tar.extractall(BIN_DIR)

        extracted = list(BIN_DIR.glob("node-v20*linux-x64"))
        if extracted:
            if NODE_DIR.exists():
                shutil.rmtree(NODE_DIR)
            extracted[0].rename(NODE_DIR)

        if archive_path.exists():
            archive_path.unlink()

        os.environ["PATH"] = f"{NODE_DIR / 'bin'}:{BIN_DIR}:{os.environ.get('PATH', '')}"
        ver = subprocess.check_output(["node", "--version"], text=True).strip()
        log(f"Node.js ready: {ver}")
        return str(NODE_DIR / "bin" / "node")
    except Exception as e:
        log(f"Failed to setup Node.js v20: {e}")
        return shutil.which("node") or "node"

def ensure_dependencies():
    """Install npm dependencies and generate Prisma client if missing."""
    node_modules = BASE_DIR / "node_modules"
    if not node_modules.exists():
        log("Installing npm dependencies (npm ci --omit=dev)...")
        try:
            subprocess.run(["npm", "ci", "--omit=dev"], cwd=str(BASE_DIR), check=True)
        except Exception as e:
            log(f"npm ci failed: {e}. Trying npm install...")
            subprocess.run(["npm", "install", "--omit=dev"], cwd=str(BASE_DIR), check=True)

    log("Generating Prisma client database bindings...")
    try:
        subprocess.run(["npx", "prisma", "generate"], cwd=str(BASE_DIR), check=True)
    except Exception as e:
        log(f"Prisma generate warning: {e}")

# Prepare environment before launching server
NODE_EXEC = ensure_node()
ensure_dependencies()

# Node.js internal port
INTERNAL_NODE_PORT = 25637
os.environ["PORT"] = str(INTERNAL_NODE_PORT)
os.environ["RADIO_PORT"] = str(INTERNAL_NODE_PORT)
os.environ["RADIO_LISTEN_HOST"] = "127.0.0.1"

bot_process = None

def start_bot_process():
    global bot_process
    if bot_process is not None:
        try:
            bot_process.terminate()
            bot_process.wait(timeout=5)
        except Exception:
            pass

    log(f"Launching RonnBot (node start.js) on internal port {INTERNAL_NODE_PORT}...")
    log_file = open(LOGS_DIR / "console.log", "a", encoding="utf-8")
    bot_process = subprocess.Popen(
        [NODE_EXEC, "start.js"],
        cwd=str(BASE_DIR),
        stdout=log_file,
        stderr=subprocess.STDOUT,
        env=os.environ
    )
    log(f"RonnBot process started with PID {bot_process.pid}")

start_bot_process()

# === FASTAPI & GRADIO REVERSE PROXY LAYER ===
from fastapi import FastAPI, Request, Response, WebSocket
from fastapi.responses import StreamingResponse, HTMLResponse, RedirectResponse
import httpx
import websockets
import gradio as gr
import uvicorn

app = FastAPI(title="RonnBot Cloud Engine")
http_client = httpx.AsyncClient(base_url=f"http://127.0.0.1:{INTERNAL_NODE_PORT}", timeout=None)

# ── Reverse Proxy Routes ──
PROXY_PATHS = [
    "/dashboard",
    "/dashboard/{path:path}",
    "/radio",
    "/radio/{path:path}",
    "/api/{path:path}",
    "/qr",
    "/status",
    "/queue",
    "/history",
    "/events"
]

for p in PROXY_PATHS:
    @app.api_route(p, methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
    async def proxy_route(request: Request, path: str = ""):
        url = f"http://127.0.0.1:{INTERNAL_NODE_PORT}{request.url.path}"
        if request.url.query:
            url += f"?{request.url.query}"
        
        headers = dict(request.headers)
        headers.pop("host", None)
        body = await request.body()
        
        try:
            response = await http_client.request(
                method=request.method,
                url=url,
                headers=headers,
                content=body,
                timeout=60.0
            )
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers)
            )
        except Exception as e:
            return Response(content=f"Gateway Error: {str(e)}", status_code=502)

@app.get("/stream")
async def proxy_stream(request: Request):
    """Audio streaming reverse proxy for /stream."""
    url = f"http://127.0.0.1:{INTERNAL_NODE_PORT}/stream"
    if request.url.query:
        url += f"?{request.url.query}"
    
    headers = dict(request.headers)
    headers.pop("host", None)
    
    try:
        req = http_client.build_request("GET", url, headers=headers)
        r = await http_client.send(req, stream=True)
        return StreamingResponse(
            r.aiter_raw(),
            status_code=r.status_code,
            headers=dict(r.headers)
        )
    except Exception as e:
        return Response(content=f"Audio Stream Error: {str(e)}", status_code=502)

@app.websocket("/socket.io/{path:path}")
async def proxy_socket_io(ws: WebSocket, path: str = ""):
    """WebSocket reverse proxy for live dashboard Socket.IO updates."""
    await ws.accept()
    query = ws.scope.get("query_string", b"").decode("utf-8")
    target_url = f"ws://127.0.0.1:{INTERNAL_NODE_PORT}/socket.io/{path}"
    if query:
        target_url += f"?{query}"
        
    try:
        async with websockets.connect(target_url) as target_ws:
            async def forward_to_client():
                try:
                    async for msg in target_ws:
                        if isinstance(msg, str):
                            await ws.send_text(msg)
                        else:
                            await ws.send_bytes(msg)
                except Exception:
                    pass

            async def forward_to_target():
                try:
                    while True:
                        msg = await ws.receive()
                        if "text" in msg:
                            await target_ws.send(msg["text"])
                        elif "bytes" in msg:
                            await target_ws.send(msg["bytes"])
                except Exception:
                    pass

            await asyncio.gather(forward_to_client(), forward_to_target())
    except Exception:
        pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass

# Health check endpoint for Hugging Face
@app.get("/api/system/ping")
async def health_ping():
    return {"status": "ok", "service": "RonnBot WABOT 2.0 Cloud Engine", "port": 7860}

# ── Gradio Control Dashboard ──
def get_bot_status():
    global bot_process
    is_running = bot_process is not None and bot_process.poll() is None
    status_text = "🟢 **Bot Engine: ONLINE**" if is_running else "🔴 **Bot Engine: OFFLINE**"
    
    # Try fetching status from local node server
    try:
        res = httpx.get(f"http://127.0.0.1:{INTERNAL_NODE_PORT}/api/system/ping", timeout=1.5)
        if res.status_code == 200:
            status_text += " | ⚡ **Web Server: ACTIVE**"
    except Exception:
        status_text += " | ⏳ **Web Server: Initializing...**"

    return status_text

def get_qr_html():
    try:
        res = httpx.get(f"http://127.0.0.1:{INTERNAL_NODE_PORT}/qr", timeout=2.0)
        if res.status_code == 200 and "Scan with WhatsApp" in res.text:
            return res.text
        return "<div style='text-align:center;padding:20px;color:#aaa;'><h3>✅ Bot Sudah Terhubung ke WhatsApp</h3><p>Tidak ada QR Code yang perlu di-scan.</p></div>"
    except Exception as e:
        return f"<div style='text-align:center;padding:20px;color:#888;'>Sedang menginisialisasi bot... ({e})</div>"

def get_logs():
    console_log = LOGS_DIR / "console.log"
    if console_log.exists():
        try:
            with open(console_log, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
                return "".join(lines[-200:])
        except Exception as e:
            return f"Error reading logs: {e}"
    return "Log file belum tersedia."

def restart_bot_action():
    start_bot_process()
    time.sleep(2)
    return "✅ Bot proses berhasil di-restart!"

def trigger_cloud_backup():
    try:
        # Jalankan script session backup secara manual
        cmd = [NODE_EXEC, "-e", "import('./src/services/sessionSync.js').then(m => m.sessionSync.backupSession()).then(() => console.log('OK'))"]
        out = subprocess.check_output(cmd, cwd=str(BASE_DIR), timeout=30, text=True)
        return "☁️ Kredensial sesi WhatsApp berhasil di-backup ke Hugging Face Dataset!"
    except Exception as e:
        return f"❌ Gagal backup sesi: {str(e)}"

# Gradio Blocks UI
with gr.Blocks(title="RonnBot (WABOT 2.0) - Cloud Control Center", theme=gr.themes.Soft()) as demo:
    gr.Markdown("""
    # 🤖 RonnBot (WABOT 2.0) - Cloud Container Edition
    *WhatsApp Bot Modular Automation & Live Radio Dashboard berjalan 24/7 di Hugging Face.*
    """)
    
    status_bar = gr.Markdown(value=get_bot_status)

    with gr.Tabs():
        with gr.Tab("📱 WhatsApp Login / QR Code"):
            gr.Markdown("Jika bot baru pertama kali login atau butuh pairing ulang, scan QR code di bawah ini:")
            qr_view = gr.HTML(value=get_qr_html)
            refresh_qr_btn = gr.Button("🔄 Refresh QR / Cek Koneksi", variant="primary")
            refresh_qr_btn.click(fn=get_qr_html, outputs=qr_view)

        with gr.Tab("📻 BotOS & Radio Dashboards"):
            gr.Markdown("""
            ### 🌐 Akses Panel Web Langsung:
            - 🖥️ **[Buka BotOS Web Dashboard](/dashboard)** — Panel kontrol web lengkap, chat feed, dan statistik.
            - 📻 **[Buka Radio Station](/radio)** — Pemutar musik live radio lo-fi & request lagu.
            - 🎵 **[Direct Audio Stream URL](/stream)** — Stream audio langsung untuk VLC, Winamp, atau Android App.
            """)
            gr.HTML("""
            <div style="margin-top:20px;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.15);">
                <iframe src="/dashboard" style="width:100%;height:650px;border:none;"></iframe>
            </div>
            """)

        with gr.Tab("📜 Live Terminal Logs"):
            gr.Markdown("Real-time bootstrap & bot runtime console output:")
            logs_view = gr.Code(value=get_logs, language="shell", label="Console Output (Last 200 lines)")
            refresh_logs_btn = gr.Button("🔄 Refresh Logs")
            refresh_logs_btn.click(fn=get_logs, outputs=logs_view)

        with gr.Tab("⚡ Cloud Sync & Maintenance"):
            gr.Markdown("""
            ### ☁️ Automated Cloud Session Sync
            Sesi WhatsApp kamu secara otomatis di-backup ke Hugging Face Dataset (`ronnlbtrn/wabot-storage`).
            Kamu juga bisa melakukan sinkronisasi manual kapan saja di bawah ini:
            """)
            backup_btn = gr.Button("☁️ Backup Sesi WhatsApp ke Dataset Sekarang", variant="secondary")
            backup_msg = gr.Markdown("")
            backup_btn.click(fn=trigger_cloud_backup, outputs=backup_msg)

            gr.Markdown("---")
            restart_btn = gr.Button("🔄 Restart Bot Process", variant="stop")
            restart_msg = gr.Markdown("")
            restart_btn.click(fn=restart_bot_action, outputs=restart_msg)

# Mount Gradio onto FastAPI root
app = gr.mount_gradio_app(app, demo, path="/")

if __name__ == "__main__":
    port = int(os.environ.get("PORT_HF", 7860))
    log(f"Starting FastAPI & Gradio Server on 0.0.0.0:{port}...")
    uvicorn.run(app, host="0.0.0.0", port=port, proxy_headers=True, forwarded_allow_ips="*")
