const { execSync } = require('child_process');
try {
    console.log("Generating dummy WebP...");
    execSync('ffmpeg -y -f lavfi -i color=c=red:s=512x512:d=2 -vcodec libwebp -loop 0 scratch/dummy.webp');
    console.log("Generating dummy overlay PNG...");
    execSync('ffmpeg -y -f lavfi -i color=c=blue:s=512x512:d=2 -vframes 1 scratch/overlay.png');
    console.log("Testing filter...");
    execSync('ffmpeg -y -i scratch/dummy.webp -i scratch/overlay.png -filter_complex "[0:v]scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=25,format=rgba[bg]; [bg][1:v]overlay=0:0" -vcodec libwebp -lossless 0 -compression_level 6 -q:v 15 -loop 0 -preset default -an -vsync 0 -t 00:00:05 scratch/out.webp');
    console.log('success');
} catch (e) {
    console.error(e.stderr ? e.stderr.toString() : e);
}
