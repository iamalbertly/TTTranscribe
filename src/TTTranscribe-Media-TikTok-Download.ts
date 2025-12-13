import 'dotenv/config';
import * as fs from 'fs-extra';
import * as path from 'path';
import fetch from 'node-fetch';

// Get TMP_DIR from environment with proper fallback
// Check for Hugging Face Spaces environment variables
const isHuggingFace = !!(
  process.env.SPACE_ID ||
  process.env.SPACE_HOST ||
  process.env.HF_SPACE_ID ||
  process.env.HF_SPACE_URL ||
  process.env.HUGGINGFACE_SPACE_ID ||
  process.env.HUGGINGFACE_SPACE_URL
);
const isWindows = process.platform === 'win32';

let TMP_DIR: string;
if (isHuggingFace) {
  TMP_DIR = '/tmp';
} else if (isWindows) {
  TMP_DIR = process.env.TMP_DIR || path.join(__dirname, '..', 'tmp');
} else {
  TMP_DIR = process.env.TMP_DIR || '/tmp/ttt';
}

// Allow placeholders only when explicitly permitted (default: false on Spaces)
const allowPlaceholderDownload = (process.env.ALLOW_PLACEHOLDER_DOWNLOAD || (isHuggingFace ? 'false' : 'true')).toLowerCase() === 'true';

// Reusable user-agent and referer for TikTok requests to reduce blocking
const DEFAULT_UA = process.env.YTDLP_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const DEFAULT_REFERER = process.env.YTDLP_REFERER || 'https://www.tiktok.com/';

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

    // Validate the downloaded audio before returning
    await ensureValidAudio(outputPath);
    
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
    
    // Determine yt-dlp command based on environment
    // Check for Hugging Face Spaces environment variables
    const isHuggingFace = !!(
      process.env.SPACE_ID ||
      process.env.SPACE_HOST ||
      process.env.HF_SPACE_ID ||
      process.env.HF_SPACE_URL ||
      process.env.HUGGINGFACE_SPACE_ID ||
      process.env.HUGGINGFACE_SPACE_URL
    );
    const isWindows = process.platform === 'win32';
    
    // Try multiple yt-dlp paths for robustness in Spaces
    let ytdlpPaths = [];
    if (isHuggingFace) {
      ytdlpPaths = [
        '/opt/venv/bin/yt-dlp',
        '/usr/local/bin/yt-dlp',
        '/usr/bin/yt-dlp',
        'yt-dlp'  // last resort - hope it's in PATH
      ];
    } else if (isWindows) {
      ytdlpPaths = ['yt-dlp'];
    } else {
      ytdlpPaths = ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', 'yt-dlp'];
    }

    // Build common yt-dlp arguments
    const baseArgs = [
      '-x',
      '--audio-format wav',
      `--user-agent "${DEFAULT_UA}"`,
      `--referer "${DEFAULT_REFERER}"`,
    ];

    const impersonate = process.env.YTDLP_IMPERSONATE;
    if (impersonate) {
      baseArgs.push(`--impersonate ${impersonate}`);
    }

    const proxy = process.env.YTDLP_PROXY;
    if (proxy) {
      baseArgs.push(`--proxy ${proxy}`);
    }

    const cookies = process.env.YTDLP_COOKIES;
    if (cookies) {
      baseArgs.push(`--cookies "${cookies}"`);
    }
    
    // For local development on Windows, skip yt-dlp and use placeholder
    if (isWindows && !isHuggingFace) {
      console.log(`Skipping yt-dlp on Windows local development, using placeholder for ${url}...`);
      const placeholderContent = `# Placeholder audio file for ${url}\n# Downloaded at ${new Date().toISOString()}\n# Local development mode - yt-dlp not available on Windows`;
      await fs.writeFile(outputPath, placeholderContent);
      console.log(`Created placeholder audio file at ${outputPath}`);
      return;
    }
    
    // Try downloading with each yt-dlp path until one succeeds
    let lastError: Error | null = null;
    for (const ytdlpCommand of ytdlpPaths) {
      try {
        const command = `${ytdlpCommand} ${baseArgs.join(' ')} --output "${outputPath}" "${url}"`;
        console.log(`[download] Attempting yt-dlp download with: ${ytdlpCommand}`);
        const { stdout, stderr } = await execAsync(command);
        if (stderr && !stderr.includes('WARNING')) {
          console.warn('[download] yt-dlp stderr:', stderr.substring(0, 200));
        }
        // Success - verify file and return
        const stats = await fs.promises.stat(outputPath);
        if (stats.size === 0) {
          throw new Error('Downloaded file is empty');
        }
        console.log(`[download] Successfully downloaded to ${outputPath} (${stats.size} bytes)`);
        return; // Success, exit function
      } catch (error: any) {
        lastError = error;
        console.warn(`[download] yt-dlp path "${ytdlpCommand}" failed: ${error.message}`);
        // Continue to next path
      }
    }
    
    // All yt-dlp paths failed
    throw lastError || new Error('yt-dlp not found in any standard location');
    
  } catch (error) {
    // Fallback to placeholder if yt-dlp fails
    console.warn(`[download] yt-dlp failed: ${error}`);

    if (!allowPlaceholderDownload) {
      throw error;
    }

    try {
      const placeholderContent = `# Placeholder audio file for ${url}\n# Downloaded at ${new Date().toISOString()}\n# yt-dlp failed: ${error}`;
      await fs.writeFile(outputPath, placeholderContent);
      console.log(`[download] Created fallback placeholder file at ${outputPath}`);
    } catch (writeError) {
      console.warn(`[download] Cannot write to filesystem: ${writeError}`);
    }
  }
}

/**
 * Ensure the downloaded file is a real WAV (not placeholder or blocked response)
 */
async function ensureValidAudio(filePath: string): Promise<void> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size < 2048) {
      throw new Error(`Downloaded audio too small (${stats.size} bytes)`);
    }

    const buffer = await fs.readFile(filePath);
    const header = buffer.slice(0, 4).toString('ascii');
    const firstText = buffer.slice(0, 64).toString('utf8');

    if (header !== 'RIFF') {
      throw new Error(`Invalid WAV header (${header || 'unknown'})`);
    }

    if (firstText.includes('Placeholder') || firstText.includes('# Placeholder')) {
      throw new Error('Placeholder audio detected');
    }
  } catch (err: any) {
    // In production (HF), fail fast. In dev, allow if placeholders are enabled.
    if (!allowPlaceholderDownload || isHuggingFace) {
      throw err;
    }

    console.warn(`[download] Non-fatal audio validation issue tolerated in dev: ${err.message}`);
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
