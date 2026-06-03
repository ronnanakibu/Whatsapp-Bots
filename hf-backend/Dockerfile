FROM python:3.10-slim

WORKDIR /app

# Install ffmpeg for yt-dlp
RUN apt-get update && apt-get install -y ffmpeg curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run uvicorn on port 7860 (Hugging Face default)
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
