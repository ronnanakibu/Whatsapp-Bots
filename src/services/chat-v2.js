import chatRepository from '../repositories/chat.repository.js';
import userRepository from '../repositories/user.repository.js';
import eventBus from '../events/bus.js';
import path from 'path';
import fs from 'fs';
import prisma from '../config/database.js';

export class ChatService {
  /**
   * Publishes message to database and fires event on the internal event bus.
   */
  async sendMessage(userId, content) {
    const message = await chatRepository.createMessage(userId, content);

    // Fetch sender info if user was valid
    let nickname = 'System';
    if (userId) {
      const user = await userRepository.findById(userId);
      if (user) {
        nickname = user.nickname;
      }
    }

    // Publish to local event bus to decouple from Socket.IO and Activity Feed
    eventBus.emitEvent('chat.message', {
      messageId: message.id,
      userId: userId || 'system',
      nickname,
      content,
      timestamp: message.timestamp,
    });

    return message;
  }

  /**
   * Add a reaction to a chat message.
   */
  async addReaction(messageId, userId, reactionType) {
    const reaction = await chatRepository.addReaction(messageId, userId, reactionType);
    return reaction;
  }

  /**
   * Get recent messages.
   */
  async getRecentHistory(limit = 50) {
    return chatRepository.findRecentMessages(limit);
  }

  /**
   * Archives a specific day's chat logs to a markdown file in chatlogs/YYYY-MM-DD.md.
   */
  async archiveDailyLogs(date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const messages = await prisma.chatMessage.findMany({
      where: {
        timestamp: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: {
        timestamp: 'asc',
      },
      include: {
        user: {
          select: {
            nickname: true,
          },
        },
      },
    });

    const dateStr = startOfDay.toISOString().split('T')[0];
    const logDir = path.resolve(process.cwd(), 'chatlogs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, `${dateStr}.md`);
    let mdContent = `# Chat Logs - ${dateStr}\n\n`;

    if (messages.length === 0) {
      mdContent += '_Tidak ada percakapan pada hari ini._\n';
    } else {
      for (const msg of messages) {
        const time = msg.timestamp.toTimeString().split(' ')[0];
        const sender = msg.user ? msg.user.nickname : 'System';
        mdContent += `[${time}] **${sender}**: ${msg.content}\n`;
      }
    }

    fs.writeFileSync(logFile, mdContent);
    return logFile;
  }
}

export const chatService = new ChatService();
export default chatService;
