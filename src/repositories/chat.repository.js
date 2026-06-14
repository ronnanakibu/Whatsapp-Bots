import prisma from '../config/database.js';

export class ChatRepository {
  async createMessage(userId, content) {
    return prisma.chatMessage.create({
      data: {
        userId,
        content,
      },
      include: {
        user: {
          select: {
            nickname: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async findRecentMessages(limit = 50) {
    return prisma.chatMessage.findMany({
      take: limit,
      orderBy: {
        timestamp: 'desc',
      },
      include: {
        user: {
          select: {
            nickname: true,
            avatarUrl: true,
          },
        },
        reactions: {
          select: {
            reactionType: true,
            userId: true,
          },
        },
      },
    });
  }

  async findById(id) {
    return prisma.chatMessage.findUnique({
      where: { id },
    });
  }

  async addReaction(messageId, userId, reactionType) {
    return prisma.chatReaction.upsert({
      where: {
        messageId_userId_reactionType: {
          messageId,
          userId,
          reactionType,
        },
      },
      update: {},
      create: {
        messageId,
        userId,
        reactionType,
      },
    });
  }

  async removeReaction(messageId, userId, reactionType) {
    try {
      return await prisma.chatReaction.delete({
        where: {
          messageId_userId_reactionType: {
            messageId,
            userId,
            reactionType,
          },
        },
      });
    } catch {
      return null;
    }
  }

  async getMessageReactionsGrouped(messageId) {
    return prisma.chatReaction.groupBy({
      by: ['reactionType'],
      where: { messageId },
      _count: {
        reactionType: true,
      },
    });
  }
}

export const chatRepository = new ChatRepository();
export default chatRepository;
