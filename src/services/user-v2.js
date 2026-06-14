import crypto from 'crypto';
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
   * Generates a JWT token for a given user using native crypto.
   */
  generateToken(user) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      jid: user.id, // Map id to jid to support legacy WABOT2.0 auth checks
      name: user.nickname,
      role: 'user', // Default role for anonymous sessions
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days expiration
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    const hmac = crypto.createHmac('sha256', appConfig.jwtSecret);
    hmac.update(`${headerB64}.${payloadB64}`);
    const signatureB64 = hmac.digest('base64url');
    
    return `${headerB64}.${payloadB64}.${signatureB64}`;
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
