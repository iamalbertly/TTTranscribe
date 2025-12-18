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
  } catch (error: any) {
    // If error is already user-friendly, pass it through
    // Otherwise wrap it
    if (error.message && (
      error.message.includes('video requires authentication') ||
      error.message.includes('bypass TikTok') ||
      error.message.includes('Network error') ||
      error.message.includes('Video not found') ||
      error.message.includes('Failed to download video')
    )) {
      throw error;
    }
    throw new Error(`Failed to download audio from ${url}: ${error}`);
  }
}

async function resolveCanonicalUrl(url: string): Promise<string> {
  try {
    // Try HEAD manual first to capture redirect location quickly
    try {
      const headResp = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': DEFAULT_UA, 'Referer': DEFAULT_REFERER }
      });
      const location = headResp.headers.get('location');
      if (location) {
        return location.split('#')[0].split('?')[0];
      }
    } catch {
      // Ignore and fall back to GET
    }

    // Follow redirects to get canonical URL (vm.tiktok.com -> long form)
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': DEFAULT_UA,
        'Referer': DEFAULT_REFERER
      }
    });
    const finalUrl = response.url || url;
    // Strip query params for cache consistency
    const withoutHash = finalUrl.split('#')[0];
    const canonical = withoutHash.split('?')[0];
    return canonical;
  } catch (error) {
    // If redirect resolution fails, return original URL
    return url;
  }
}

/**
 * Parse yt-dlp error and extract user-friendly message
 */
type DownloadErrorCode = 'download_blocked' | 'download_not_found' | 'download_network' | 'download_unknown' | 'download_auth';

function parseYtDlpError(errorMessage: string): { message: string; isAuthError: boolean; isBlockedError: boolean; code: DownloadErrorCode } {
  const errorText = errorMessage.toLowerCase();

  // Check for authentication/permission errors
  if (errorText.includes('you do not have permission') ||
      errorText.includes('log into an account') ||
      errorText.includes('use --cookies')) {
    return {
      message: 'This video requires authentication or is private. The video may be age-restricted, region-locked, or require login.',
      isAuthError: true,
      isBlockedError: false,
      code: 'download_auth'
    };
  }

  // Check for impersonation/blocking errors
  if (errorText.includes('impersonation') || errorText.includes('impersonate target')) {
    return {
      message: 'Unable to bypass TikTok\'s bot protection. The service needs additional configuration.',
      isAuthError: false,
      isBlockedError: true,
      code: 'download_blocked'
    };
  }

  // Check for network errors
  if (errorText.includes('network') || errorText.includes('connection') || errorText.includes('timeout')) {
    return {
      message: 'Network error while downloading video. Please try again.',
      isAuthError: false,
      isBlockedError: false,
      code: 'download_network'
    };
  }

  // Check for video not found
  if (errorText.includes('not found') || errorText.includes('404') || errorText.includes('video unavailable')) {
    return {
      message: 'Video not found. It may have been deleted or the URL is incorrect.',
      isAuthError: false,
      isBlockedError: false,
      code: 'download_not_found'
    };
  }

  // Generic error
  return {
    message: 'Failed to download video. Please check the URL and try again.',
    isAuthError: false,
    isBlockedError: false,
    code: 'download_unknown'
  };
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
      '--no-playlist',
      '--geo-bypass',
      `--user-agent "${DEFAULT_UA}"`,
      `--referer "${DEFAULT_REFERER}"`,
    ];

    // Prefer explicit impersonation if provided, otherwise default to chrome on HF
    const impersonate = process.env.YTDLP_IMPERSONATE || (isHuggingFace ? 'chrome' : '');
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

    // Try downloading with each yt-dlp path and argument variant until one succeeds
    let lastError: Error | null = null;
    const argVariants: string[][] = [
      baseArgs,
      [...baseArgs, '--force-ipv4'],
      [...baseArgs, '--extractor-args "tiktok:app_version=34.1.2;device_platform=android"']
    ];
    for (const ytdlpCommand of ytdlpPaths) {
      for (const args of argVariants) {
        try {
          const command = `${ytdlpCommand} ${args.join(' ')} --output "${outputPath}" "${url}"`;
          console.log(`[download] Attempting with: ${ytdlpCommand} args=${args.join(' ')}`);
          await execAsync(command);

          // Success - verify file and return
          const stats = await fs.promises.stat(outputPath);
          if (stats.size === 0) {
            throw new Error('Downloaded file is empty');
          }
          console.log(`[download] Success: ${outputPath} (${stats.size} bytes)`);
          return; // Success, exit function
        } catch (error: any) {
          lastError = error;
          console.log(`[download] Failed with ${ytdlpCommand} args=${args.join(' ')}`);
          // Continue to next arg variant
        }
      }
    }

    // All yt-dlp paths failed - parse error for user-friendly message
    const parsedError = parseYtDlpError(lastError?.message || '');
    console.warn(`[download] yt-dlp failed for ${url}, trying TikWM fallback... (${parsedError.message})`);

    // Fallback: attempt download via TikWM API (no-auth public endpoint)
    const fallbackSucceeded = await downloadViaTikwmApi(url, outputPath).catch(() => false);
    if (!fallbackSucceeded) {
      const err: any = new Error(parsedError.message);
      err.code = parsedError.code;
      throw err;
    }

  } catch (error: any) {
    // Parse the error for user-friendly message
    const parsedError = parseYtDlpError(error.message || String(error));

    // Log detailed error for debugging
    console.error(`[download] Failed: ${parsedError.message}`);

    if (!allowPlaceholderDownload) {
      // Throw user-friendly error
      const err: any = new Error(parsedError.message);
      err.code = parsedError.code;
      throw err;
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
 * Fallback downloader via public TikWM API -> MP4 -> WAV (ffmpeg).
 * This helps when yt-dlp is blocked by TikTok anti-bot protections.
 */
async function downloadViaTikwmApi(url: string, wavOutputPath: string): Promise<boolean> {
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': DEFAULT_UA, 'Referer': DEFAULT_REFERER }
    });
    if (!resp.ok) {
      console.warn(`[tikwm] API returned ${resp.status}`);
      return false;
    }
    const data: any = await resp.json();
    const videoUrl = data?.data?.play;
    if (!videoUrl) {
      console.warn('[tikwm] Missing play URL in response');
      return false;
    }

    // Download video to temp MP4
    const mp4Path = wavOutputPath.replace(/\.wav$/i, '.mp4');
    const videoResp = await fetch(videoUrl, { headers: { 'User-Agent': DEFAULT_UA } });
    if (!videoResp.ok) {
      console.warn(`[tikwm] Failed to download video asset: ${videoResp.status}`);
      return false;
    }
    const fileStream = fs.createWriteStream(mp4Path);
    await new Promise((resolve, reject) => {
      videoResp.body?.pipe(fileStream);
      videoResp.body?.on('error', (err: any) => reject(err));
      fileStream.on('finish', () => resolve(true));
    });

    // Convert to WAV using ffmpeg
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const cmd = `ffmpeg -y -i "${mp4Path}" -vn -acodec pcm_s16le -ar 44100 -ac 1 "${wavOutputPath}"`;
    await execAsync(cmd);

    // Cleanup mp4
    try { await fs.remove(mp4Path); } catch {}

    // Validate resulting WAV
    await ensureValidAudio(wavOutputPath);
    console.log('[tikwm] Fallback download + convert succeeded');
    return true;
  } catch (err: any) {
    console.warn(`[tikwm] Fallback failed: ${err.message}`);
    return false;
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
