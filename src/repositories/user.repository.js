import prisma from '../config/database.js';

export class UserRepository {
  async findById(id) {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  async findByNickname(nickname) {
    return prisma.user.findUnique({
      where: { nickname },
    });
  }

  async createAnonymousUser(nickname) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          nickname,
        },
      });

      // Initialize default stats and presence models
      await tx.userStats.create({
        data: {
          userId: user.id,
        },
      });

      await tx.userPresence.create({
        data: {
          userId: user.id,
          status: 'online',
        },
      });

      return user;
    });
  }

  async updateProfile(id, data) {
    return prisma.user.update({
      where: { id },
      data,
    });
  }

  async findAccountByProvider(provider, providerUserId) {
    return prisma.userAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
    });
  }

  async linkAccount(userId, accountData) {
    return prisma.userAccount.create({
      data: {
        userId,
        provider: accountData.provider,
        providerUserId: accountData.providerUserId,
        passwordHash: accountData.passwordHash,
      },
    });
  }

  async getUserStats(userId) {
    return prisma.userStats.findUnique({
      where: { userId },
    });
  }

  async updateUserStats(userId, data) {
    return prisma.userStats.update({
      where: { userId },
      data: {
        listeningTimeMs: data.listeningTimeMsIncrement
          ? { increment: data.listeningTimeMsIncrement }
          : undefined,
        songsRequested: data.songsRequestedIncrement
          ? { increment: data.songsRequestedIncrement }
          : undefined,
        lastActiveAt: new Date(),
      },
    });
  }

  async getUserPresence(userId) {
    return prisma.userPresence.findUnique({
      where: { userId },
    });
  }

  async updateUserPresence(userId, status) {
    return prisma.userPresence.upsert({
      where: { userId },
      update: {
        status,
        lastActiveAt: new Date(),
      },
      create: {
        userId,
        status,
        lastActiveAt: new Date(),
      },
    });
  }
}

export const userRepository = new UserRepository();
export default userRepository;
