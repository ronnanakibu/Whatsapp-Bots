import { config } from 'dotenv'
config()

import { memoryService } from './src/services/memory.js'
import { aiService } from './src/services/ai.js'

async function run() {
    try {
        const chatId = "test-chat-456"
        
        console.log("=== TEST 1: Default Routing (Groq) ===")
        let res = await aiService.chat(chatId, "Hi!")
        console.log("Provider:", res.provider) // Should be groq
        
        console.log("\n=== TEST 2: Forced NVIDIA via param ===")
        // Simulating .q --nvidia
        memoryService.setAiProvider(chatId, "nvidia")
        res = await aiService.chat(chatId, "Hi!")
        console.log("Provider:", res.provider) // Should be nvidia
        
        console.log("\n=== TEST 3: Persistent Preference ===")
        res = await aiService.chat(chatId, "Hi!")
        console.log("Provider:", res.provider) // Should be nvidia

        console.log("\n=== TEST 4: Reset Param ===")
        memoryService.setAiProvider(chatId, null)
        res = await aiService.chat(chatId, "Hi!")
        console.log("Provider:", res.provider) // Should be groq again
        
        process.exit(0)
    } catch (e) {
        console.error("Error:", e)
        process.exit(1)
    }
}

run()
