import OpenAI from 'openai';
import fs from 'fs';

const nvidiaClient = new OpenAI({
    apiKey: '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',
    baseURL: 'https://integrate.api.nvidia.com/v1',
});

async function run() {
    try {
        console.log("Testing NVIDIA Vision API...");
        // 1 pixel base64 jpeg
        const base64Image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        const res = await nvidiaClient.chat.completions.create({
            model: 'meta/llama-3.2-90b-vision-instruct',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'What is this image? Reply briefly.' },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
                    ]
                }
            ],
            max_tokens: 50
        });
        console.log(res.choices[0].message.content);
    } catch (e) {
        console.error(e);
    }
}
run();
