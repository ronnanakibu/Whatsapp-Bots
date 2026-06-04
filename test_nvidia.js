import { config } from 'dotenv'
config()

import { aiService } from './src/services/ai.js'

async function run() {
    try {
        console.log("Testing nvidiaChat() directly...");
        const res = await aiService.nvidiaChat("test-123", "Siapa kamu?");
        console.log("Response:", res.text);
    } catch (e) {
        console.error("Error:", e);
    }
}

run();
