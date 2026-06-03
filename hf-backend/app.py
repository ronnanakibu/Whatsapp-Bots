from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import yt_dlp
import os
import uuid

app = FastAPI()

TEMP_DIR = "/tmp/downloads"
os.makedirs(TEMP_DIR, exist_ok=True)

class DownloadRequest(BaseModel):
    url: str
    format: str = "video"

def delete_file(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        print(f"Failed to delete {path}: {e}")

@app.get("/")
def read_root():
    return {"status": "ok", "message": "HF Downloader API is running"}

@app.post("/download")
def download_media(req: DownloadRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    
    ydl_opts = {
        'outtmpl': f'{TEMP_DIR}/{job_id}.%(ext)s',
        'quiet': True,
        'no_warnings': True,
        'max_filesize': 100 * 1024 * 1024, # 100MB limit
        'geo_bypass': True
    }
    
    if req.format == "audio":
        ydl_opts['format'] = 'bestaudio/best'
        ydl_opts['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '128',
        }]
    else:
        ydl_opts['format'] = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
        ydl_opts['merge_output_format'] = 'mp4'

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(req.url, download=True)
            ext = 'mp3' if req.format == 'audio' else 'mp4'
            
            # Search for downloaded file
            files = os.listdir(TEMP_DIR)
            downloaded_file = None
            for f in files:
                if f.startswith(job_id):
                    downloaded_file = os.path.join(TEMP_DIR, f)
                    break
                    
            if not downloaded_file:
                raise Exception("File not found after download")

            # Auto delete after streaming
            background_tasks.add_task(delete_file, downloaded_file)
            
            media_type = "audio/mpeg" if req.format == "audio" else "video/mp4"
            filename = f"download_{job_id}.{ext}"
            
            # We can pass metadata via headers
            title = info.get("title", "Media")
            safe_title = title.encode('utf-8').decode('latin-1', 'ignore')
            
            return FileResponse(
                path=downloaded_file, 
                media_type=media_type, 
                filename=filename,
                headers={"X-Title": safe_title}
            )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
