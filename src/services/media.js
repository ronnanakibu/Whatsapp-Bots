import path from 'path';
import fs from 'fs';

export class MediaService {
  constructor() {
    this.allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    this.maxSizeBytes = 5 * 1024 * 1024; // 5 MB
    this.storageDir = path.resolve(process.cwd(), 'storage', 'uploads');
    this.ensureStorageDirExists();
  }

  ensureStorageDirExists() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Validate image input parameters.
   */
  validateImage(metadata) {
    if (!this.allowedMimeTypes.includes(metadata.mimeType)) {
      return {
        isValid: false,
        reason: `Format gambar tidak didukung. Format yang diizinkan: ${this.allowedMimeTypes.join(', ')}`,
      };
    }

    if (metadata.sizeBytes > this.maxSizeBytes) {
      return {
        isValid: false,
        reason: `Ukuran berkas melebihi batas maksimum 5MB.`,
      };
    }

    return { isValid: true };
  }

  /**
   * Compresses image to optimize resource utilization (placeholder logic for future dependency plugins).
   */
  async compressImage(buffer) {
    return buffer;
  }

  /**
   * Saves image buffer and returns the accessible asset path/url.
   */
  async saveAvatar(userId, buffer, filename) {
    const ext = path.extname(filename) || '.png';
    const relativePath = path.join('avatars', `${userId}_${Date.now()}${ext}`);
    const absolutePath = path.join(this.storageDir, relativePath);

    // Ensure avatars subdirectory exists
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

    const processedBuffer = await this.compressImage(buffer);
    fs.writeFileSync(absolutePath, processedBuffer);

    return `/uploads/${relativePath.replace(/\\/g, '/')}`;
  }

  /**
   * Saves banner buffer and returns the accessible asset path/url.
   */
  async saveBanner(userId, buffer, filename) {
    const ext = path.extname(filename) || '.png';
    const relativePath = path.join('banners', `${userId}_${Date.now()}${ext}`);
    const absolutePath = path.join(this.storageDir, relativePath);

    // Ensure banners subdirectory exists
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

    const processedBuffer = await this.compressImage(buffer);
    fs.writeFileSync(absolutePath, processedBuffer);

    return `/uploads/${relativePath.replace(/\\/g, '/')}`;
  }

  /**
   * Deletes a local media asset file.
   */
  deleteMedia(relativeUrlPath) {
    if (!relativeUrlPath.startsWith('/uploads/')) return false;

    const relativePath = relativeUrlPath.replace('/uploads/', '');
    const absolutePath = path.join(this.storageDir, relativePath);

    try {
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
        return true;
      }
    } catch {
      // failed to delete, ignore
    }
    return false;
  }
}

export const mediaService = new MediaService();
export default mediaService;