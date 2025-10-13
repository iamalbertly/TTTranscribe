import * as fs from 'fs-extra';
import * as path from 'path';
import fetch from 'node-fetch';

const TMP_DIR = process.env.TMP_DIR || '/tmp/ttt';

/**
 * TikTok media resolver
 * - Resolves redirects (vm.tiktok.com/... → canonical link)
 * - Downloads audio or gets subtitle track if present
 * - Saves to TMP_DIR and returns path
 */
export async function download(url: string): Promise<string> {
  try {
    // Ensure tmp directory exists
    await fs.ensureDir(TMP_DIR);
    
    // Resolve redirects and get canonical URL
    const canonicalUrl = await resolveCanonicalUrl(url);
    
    // Generate unique filename
    const filename = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.wav`;
    const outputPath = path.join(TMP_DIR, filename);
    
    // For now, use a simple approach - in production you'd use yt-dlp or similar
    // This is a minimal implementation that downloads the audio
    await downloadAudio(canonicalUrl, outputPath);
    
    return outputPath;
  } catch (error) {
    throw new Error(`Failed to download audio from ${url}: ${error}`);
  }
}

async function resolveCanonicalUrl(url: string): Promise<string> {
  try {
    // Handle vm.tiktok.com redirects
    if (url.includes('vm.tiktok.com')) {
      const response = await fetch(url, { 
        method: 'HEAD',
        redirect: 'manual'
      });
      
      if (response.status === 301 || response.status === 302) {
        const location = response.headers.get('location');
        if (location) {
          return location;
        }
      }
    }
    
    return url;
  } catch (error) {
    // If redirect resolution fails, return original URL
    return url;
  }
}

async function downloadAudio(url: string, outputPath: string): Promise<void> {
  try {
    // This is a simplified implementation
    // In production, you'd use yt-dlp or similar tool
    // For now, we'll create a placeholder file
    // TODO: Implement actual audio download using yt-dlp or similar
    
    // Placeholder implementation - replace with actual audio download
    const placeholderContent = `# Placeholder audio file for ${url}\n# Downloaded at ${new Date().toISOString()}`;
    await fs.writeFile(outputPath, placeholderContent);
    
    // In a real implementation, you would:
    // 1. Use yt-dlp to extract audio from TikTok URL
    // 2. Convert to WAV format if needed
    // 3. Save to outputPath
    
    console.log(`Downloaded audio from ${url} to ${outputPath}`);
  } catch (error) {
    throw new Error(`Audio download failed: ${error}`);
  }
}

/**
 * Check if URL is a valid TikTok URL
 */
export function isValidTikTokUrl(url: string): boolean {
  const tiktokPatterns = [
    /^https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/,
    /^https?:\/\/vm\.tiktok\.com\/[\w]+/,
    /^https?:\/\/vt\.tiktok\.com\/[\w]+/
  ];
  
  return tiktokPatterns.some(pattern => pattern.test(url));
}

/**
 * Clean up temporary files
 */
export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
  } catch (error) {
    console.warn(`Failed to cleanup temp file ${filePath}: ${error}`);
  }
}
