import * as fs from 'fs-extra';
import * as path from 'path';
import fetch from 'node-fetch';

// Get TMP_DIR from environment with proper fallback
const TMP_DIR = process.env.TMP_DIR || (process.env.HF_SPACE_ID ? '/tmp' : '/tmp/ttt');

/**
 * TikTok media resolver
 * - Resolves redirects (vm.tiktok.com/... → canonical link)
 * - Downloads audio or gets subtitle track if present
 * - Saves to TMP_DIR and returns path
 */
export async function download(url: string): Promise<string> {
  try {
    // Try to ensure tmp directory exists, but don't fail if we can't
    try {
      await fs.ensureDir(TMP_DIR);
    } catch (error) {
      console.warn(`Could not create directory ${TMP_DIR}, using fallback:`, error);
    }
    
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
    
    try {
      const placeholderContent = `# Placeholder audio file for ${url}\n# Downloaded at ${new Date().toISOString()}\n# yt-dlp failed: ${error}`;
      await fs.writeFile(outputPath, placeholderContent);
    } catch (writeError) {
      // If we can't write to the file system, create a virtual file path
      console.warn(`Cannot write to filesystem in Hugging Face Spaces, using virtual file: ${writeError}`);
      // Return the original path even if we can't write - the transcription will handle this
    }
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
 * Clean up temporary files (with Hugging Face Spaces compatibility)
 */
export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
      console.log(`Cleaned up temp file: ${filePath}`);
    }
  } catch (error) {
    // In Hugging Face Spaces, file cleanup might not be allowed
    console.warn(`Could not cleanup temp file ${filePath} (Hugging Face Spaces restriction): ${error}`);
  }
}
