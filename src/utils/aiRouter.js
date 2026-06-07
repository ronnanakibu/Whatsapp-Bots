import { commands } from '../core/loader.js'
import { botLogger } from './logger.js'

/**
 * Parses the AI response and determines whether to execute a command or reply with text.
 * @param {object} ctx - The message context.
 * @param {object} aiResponseResult - The result returned from aiService.chat.
 */
export async function processAiResponse(ctx, aiResponseResult) {
    const { reply } = ctx
    const text = aiResponseResult.text?.trim()
    
    if (!text) return

    // Check if the response contains JSON
    if (text.includes('{') && text.includes('}')) {
        let cleanText = text
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/, '')
            .replace(/```\s*$/, '')
            .trim()
        
        try {
            // Find start of JSON object '{' and end of JSON object '}' to extract valid JSON
            const startIdx = cleanText.indexOf('{')
            const endIdx = cleanText.lastIndexOf('}')
            
            if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const jsonStr = cleanText.substring(startIdx, endIdx + 1)
                const parsed = JSON.parse(jsonStr)
                
                if (parsed.executeCommand && parsed.command) {
                    const cmdName = parsed.command.toLowerCase()
                    const command = commands.get(cmdName)
                    
                    if (command) {
                        botLogger.info('agent', `Agent executing command "${cmdName}" with args: ${JSON.stringify(parsed.args)}`)
                        
                        let targetArgs = []
                        if (Array.isArray(parsed.args)) {
                            targetArgs = parsed.args.map(arg => String(arg))
                        } else if (parsed.args !== undefined && parsed.args !== null) {
                            targetArgs = [String(parsed.args)]
                        }
                        
                        const newCtx = {
                            ...ctx,
                            args: targetArgs,
                            commandName: cmdName
                        }
                        
                        await command.execute(newCtx)
                        return true
                    } else {
                        botLogger.warn('agent', `Agent tried to execute unknown command: "${cmdName}"`)
                    }
                }
            }
        } catch (e) {
            botLogger.warn('agent', `Failed to parse or execute Agent JSON command: ${e.message}`)
        }
    }
    
    // Fallback: Reply as normal text
    const sent = await reply(text)
    if (sent?.key?.id) {
        const { seamlessTracker } = await import('../services/seamless.js')
        seamlessTracker.track(sent.key.id)
    }
    return false
}
