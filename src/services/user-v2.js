import jwt from 'jsonwebtoken';
import userRepository from '../repositories/user.repository.js';
import { generateNickname } from '../utils/nickname-generator.js';
import { appConfig } from '../config/index.js';

export class UserService {
  /**
   * Retrieves profile details and accompanying statistics.
   */
  async getProfile(userId) {
    const user = await userRepository.findById(userId);
    if (!user) return null;

    const stats = await userRepository.getUserStats(userId);
    return {
      ...user,
      stats,
    };
  }

  /**
   * Generates a JWT token for a given user.
   */
  generateToken(user) {
    return jwt.sign(
      {
        jid: user.id, // Map id to jid to support legacy WABOT2.0 auth checks
        name: user.nickname,
        role: 'user', // Default role for anonymous sessions
      },
      appConfig.jwtSecret,
      { expiresIn: '30d' } // Long session duration for frictionless guests
    );
  }

  /**
   * Fast onboarding flow: creates an anonymous guest user profile and returns a JWT.
   */
  async registerAnonymous() {
    let nickname = generateNickname();
    let attempts = 0;

    // Check nickname uniqueness
    while (attempts < 5) {
      const existing = await userRepository.findByNickname(nickname);
      if (!existing) break;
      nickname = generateNickname();
      attempts++;
    }

    // Fallback if nickname collisions occur repeatedly
    if (attempts >= 5) {
      nickname = `${nickname.split('#')[0]}#${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const user = await userRepository.createAnonymousUser(nickname);
    const token = this.generateToken(user);

    return {
      token,
      user,
    };
  }

  /**
   * Updates profile information (nickname, bio, avatar, banner).
   */
  async updateProfile(userId, data) {
    if (data.nickname) {
      const existing = await userRepository.findByNickname(data.nickname);
      if (existing && existing.id !== userId) {
        throw new Error('Nama panggilan (nickname) sudah digunakan oleh pengguna lain.');
      }
    }

    return userRepository.updateProfile(userId, data);
  }

  /**
   * Registers a permanent local account credentials link.
   */
  async claimAccount(userId, username, passwordHash) {
    const existing = await userRepository.findAccountByProvider('local', username);
    if (existing) {
      throw new Error('Username sudah terdaftar.');
    }

    await userRepository.linkAccount(userId, {
      provider: 'local',
      providerUserId: username,
      passwordHash,
    });
  }
}

export const userService = new UserService();
export default userService;
