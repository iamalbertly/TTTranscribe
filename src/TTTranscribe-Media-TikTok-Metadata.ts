/**
 * TTTranscribe-Media-TikTok-Metadata - Extract rich metadata from TikTok videos
 *
 * This module uses yt-dlp to extract comprehensive metadata including:
 * - Video title, description, author
 * - Thumbnail URL and download
 * - View count, like count, comment count
 * - Upload date, duration
 * - Creator info (username, display name, follower count)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';

const execAsync = promisify(exec);

/**
 * Comprehensive TikTok video metadata
 */
export interface TikTokMetadata {
  // Video information
  title: string;
  description: string;
  duration: number; // seconds
  uploadDate: string; // YYYYMMDD format
  timestamp: number; // Unix timestamp

  // Creator information
  author: string; // Username (e.g., "@thesunnahguy")
  authorDisplayName: string; // Display name (e.g., "The Sunnah Guy")
  authorId: string;
  authorFollowerCount?: number;
  authorVerified?: boolean;

  // Video stats
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  playCount?: number;

  // Thumbnail
  thumbnail: string; // URL to thumbnail
  thumbnailPath?: string; // Local path if downloaded
  thumbnailBase64?: string; // Base64 for embedding

  // URLs
  url: string; // Original URL
  webpageUrl: string; // Canonical URL
  videoId: string; // TikTok video ID

  // Technical
  format: string;
  width?: number;
  height?: number;
  fps?: number;

  // Additional metadata
  hashtags?: string[];
  mentions?: string[];
  music?: {
    title?: string;
    author?: string;
    album?: string;
  };
}

/**
 * Extract metadata using yt-dlp's --dump-json option
 */
export async function extractTikTokMetadata(url: string): Promise<TikTokMetadata> {
  const isHuggingFace = !!process.env.SPACE_ID || !!process.env.SPACE_AUTHOR_NAME;
  const isWindows = process.platform === 'win32';

  // Determine yt-dlp command based on environment
  let ytdlpPaths = [];
  if (isHuggingFace) {
    ytdlpPaths = [
      '/opt/venv/bin/yt-dlp',
      '/usr/local/bin/yt-dlp',
      '/usr/bin/yt-dlp',
      'yt-dlp'
    ];
  } else if (isWindows) {
    ytdlpPaths = ['yt-dlp'];
  } else {
    ytdlpPaths = ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', 'yt-dlp'];
  }

  const baseArgs = [
    '--dump-json', // Extract metadata as JSON
    '--no-playlist',
    '--geo-bypass',
    '--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
  ];

  const impersonate = process.env.YTDLP_IMPERSONATE || (isHuggingFace ? 'chrome' : '');
  if (impersonate) {
    baseArgs.push(`--impersonate ${impersonate}`);
  }

  const proxy = process.env.YTDLP_PROXY;
  if (proxy) {
    baseArgs.push(`--proxy ${proxy}`);
  }

  // Try each yt-dlp path until one works
  let lastError: Error | null = null;
  for (const ytdlpCommand of ytdlpPaths) {
    try {
      const command = `${ytdlpCommand} ${baseArgs.join(' ')} "${url}"`;
      console.log(`[metadata] Extracting with: ${ytdlpCommand}`);

      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for JSON
      });

      if (stderr) {
        console.warn(`[metadata] stderr: ${stderr.substring(0, 500)}`);
      }

      // Parse JSON output
      const metadata = JSON.parse(stdout);

      // Extract hashtags from description
      const fullDescription = metadata.description || metadata.title || metadata.fulltitle || '';
      const hashtags = extractHashtags(fullDescription);
      const mentions = extractMentions(fullDescription);

      // Normalize metadata to our format
      const normalized: TikTokMetadata = {
        title: extractShortTitle(metadata.title || metadata.fulltitle || fullDescription),
        description: fullDescription,
        duration: metadata.duration || 0,
        uploadDate: metadata.upload_date || '',
        timestamp: metadata.timestamp || Date.now() / 1000,

        author: metadata.uploader || metadata.creator || metadata.channel || 'Unknown',
        authorDisplayName: metadata.uploader_id || metadata.uploader || 'Unknown User',
        authorId: metadata.uploader_id || metadata.channel_id || '',
        authorFollowerCount: metadata.channel_follower_count,
        authorVerified: metadata.channel_is_verified,

        viewCount: metadata.view_count,
        likeCount: metadata.like_count,
        commentCount: metadata.comment_count,
        shareCount: metadata.repost_count || metadata.share_count,
        playCount: metadata.play_count,

        thumbnail: metadata.thumbnail || '',

        url: url,
        webpageUrl: metadata.webpage_url || url,
        videoId: metadata.id || extractVideoId(url),

        format: metadata.format || 'unknown',
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,

        hashtags,
        mentions,
        music: {
          title: metadata.track || metadata.music?.title,
          author: metadata.artist || metadata.music?.author,
          album: metadata.album || metadata.music?.album
        }
      };

      console.log(`[metadata] Extracted successfully:`, {
        title: normalized.title,
        author: normalized.author,
        duration: normalized.duration,
        viewCount: normalized.viewCount,
        likeCount: normalized.likeCount,
        thumbnail: normalized.thumbnail ? 'YES' : 'NO'
      });

      return normalized;

    } catch (error: any) {
      lastError = error;
      console.log(`[metadata] Failed with ${ytdlpCommand}: ${error.message}`);
      // Continue to next yt-dlp path
    }
  }

  // All yt-dlp paths failed - try fallback API
  console.warn(`[metadata] yt-dlp extraction failed, trying API fallback...`);
  return await extractMetadataViaAPI(url);
}

/**
 * Download thumbnail image to local file
 */
export async function downloadThumbnail(
  thumbnailUrl: string,
  outputDir: string,
  videoId: string
): Promise<string> {
  try {
    const response = await fetch(thumbnailUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.buffer();
    const ext = thumbnailUrl.includes('.webp') ? 'webp' : 'jpg';
    const filename = `thumb_${videoId}.${ext}`;
    const outputPath = path.join(outputDir, filename);

    await fs.writeFile(outputPath, buffer);
    console.log(`[metadata] Downloaded thumbnail: ${outputPath} (${buffer.length} bytes)`);

    return outputPath;
  } catch (error: any) {
    console.error(`[metadata] Failed to download thumbnail: ${error.message}`);
    throw error;
  }
}

/**
 * Convert thumbnail to base64 for embedding in responses
 */
export async function thumbnailToBase64(imagePath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error: any) {
    console.error(`[metadata] Failed to convert thumbnail to base64: ${error.message}`);
    throw error;
  }
}

/**
 * Fallback: Extract metadata using TikWM API
 */
async function extractMetadataViaAPI(url: string): Promise<TikTokMetadata> {
  try {
    const videoId = extractVideoId(url);
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data: any = await response.json();

    if (data.code !== 0 || !data.data) {
      throw new Error('API returned error or no data');
    }

    const video = data.data;

    // Extract hashtags from title (full description)
    const fullDescription = video.title || '';
    const hashtags = extractHashtags(fullDescription);
    const mentions = extractMentions(fullDescription);

    return {
      title: extractShortTitle(fullDescription),
      description: fullDescription,
      duration: video.duration || 0,
      uploadDate: video.create_time ? formatTimestampToDate(video.create_time) : '',
      timestamp: video.create_time || Date.now() / 1000,

      author: `@${video.author?.unique_id || 'unknown'}`,
      authorDisplayName: video.author?.nickname || 'Unknown User',
      authorId: video.author?.unique_id || '',
      authorFollowerCount: video.author?.follower_count,
      authorVerified: video.author?.verified,

      viewCount: video.play_count,
      likeCount: video.digg_count,
      commentCount: video.comment_count,
      shareCount: video.share_count,
      playCount: video.play_count,

      thumbnail: video.cover || video.origin_cover || '',

      url: url,
      webpageUrl: url,
      videoId: videoId,

      format: 'mp4',
      width: video.width,
      height: video.height,

      hashtags,
      mentions,
      music: {
        title: video.music_info?.title || video.music,
        author: video.music_info?.author || video.music_author,
        album: video.music_info?.album
      }
    };
  } catch (error: any) {
    console.error(`[metadata] API fallback failed: ${error.message}`);

    // Last resort: return minimal metadata
    return {
      title: 'TikTok Video',
      description: '',
      duration: 0,
      uploadDate: '',
      timestamp: Date.now() / 1000,

      author: 'TikTok User',
      authorDisplayName: 'TikTok User',
      authorId: '',

      thumbnail: '',

      url: url,
      webpageUrl: url,
      videoId: extractVideoId(url),

      format: 'unknown'
    };
  }
}

/**
 * Extract video ID from TikTok URL
 */
function extractVideoId(url: string): string {
  const match = url.match(/\/video\/(\d+)/);
  return match ? match[1] : url.split('/').pop() || 'unknown';
}

/**
 * Extract a short, usable title from description (first sentence/line, max 80 chars)
 */
function extractShortTitle(description: string): string {
  if (!description || description.length === 0) {
    return 'TikTok Video';
  }

  // Remove common TikTok markdown/formatting
  let cleaned = description.trim();

  // Try to get first sentence (up to period, exclamation, or question mark)
  const sentenceMatch = cleaned.match(/^([^.!?]+[.!?])/);
  if (sentenceMatch) {
    cleaned = sentenceMatch[1].trim();
  } else {
    // Try to get first line
    const firstLine = cleaned.split('\n')[0].trim();
    cleaned = firstLine;
  }

  // Limit to reasonable length (80 chars max)
  if (cleaned.length > 80) {
    cleaned = cleaned.substring(0, 77) + '...';
  }

  return cleaned || 'TikTok Video';
}

/**
 * Extract hashtags from text
 */
function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w\u4e00-\u9fa5]+/g);
  return matches ? matches.map(tag => tag.substring(1)) : [];
}

/**
 * Extract @mentions from text
 */
function extractMentions(text: string): string[] {
  const matches = text.match(/@[\w.]+/g);
  return matches ? matches.map(mention => mention.substring(1)) : [];
}

/**
 * Format Unix timestamp to YYYYMMDD
 */
function formatTimestampToDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Get user-friendly relative time (e.g., "2 days ago", "3 weeks ago")
 */
export function getRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)} months ago`;
  return `${Math.floor(diff / 31536000)} years ago`;
}

/**
 * Format view/like/follower counts for display
 */
export function formatCount(count: number | undefined): string {
  if (!count) return '0';
  if (count < 1000) return String(count);
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
  if (count < 1000000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${(count / 1000000000).toFixed(1)}B`;
}
