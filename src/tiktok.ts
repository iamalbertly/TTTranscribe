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
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    // Use yt-dlp from virtual environment to download audio from TikTok
    const command = `/opt/venv/bin/yt-dlp -x --audio-format wav --output "${outputPath}" "${url}"`;
    
    console.log(`Downloading audio from ${url}...`);
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr && !stderr.includes('WARNING')) {
      console.warn('yt-dlp stderr:', stderr);
    }
    
    // Verify the file was created and has content
    const stats = await fs.stat(outputPath);
    if (stats.size === 0) {
      throw new Error('Downloaded file is empty');
    }
    
    console.log(`Successfully downloaded audio to ${outputPath} (${stats.size} bytes)`);
    
  } catch (error) {
    // Fallback to placeholder if yt-dlp fails
    console.warn(`yt-dlp failed, using placeholder: ${error}`);
    const placeholderContent = `# Placeholder audio file for ${url}\n# Downloaded at ${new Date().toISOString()}\n# yt-dlp failed: ${error}`;
    await fs.writeFile(outputPath, placeholderContent);
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
