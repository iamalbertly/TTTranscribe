/**
 * Environment-aware configuration for TTTranscribe
 * Handles local development vs Hugging Face Spaces deployment
 */

import * as fs from 'fs-extra';
import * as path from 'path';

export interface TTTranscribeConfig {
  port: number;
  engineSharedSecret: string;
  hfApiKey?: string;
  asrProvider: string;
  tmpDir: string;
  keepTextMax: number;
  isHuggingFace: boolean;
  isLocal: boolean;
  baseUrl: string;
  allowPlaceholderTranscription: boolean;
  rateLimitCapacity: number;
  rateLimitRefillPerMin: number;
  webhookUrl: string;
  webhookSecret: string;
  apiVersion: string;
}

/**
 * Detect if running on Hugging Face Spaces
 */
function isHuggingFaceSpaces(): boolean {
  return !!(
    process.env.SPACE_ID ||
    process.env.SPACE_HOST ||
    process.env.HF_SPACE_ID ||
    process.env.HF_SPACE_URL ||
    process.env.HUGGINGFACE_SPACE_ID ||
    process.env.HUGGINGFACE_SPACE_URL
  );
}

/**
 * Detect if running locally
 */
function isLocalEnvironment(): boolean {
  return process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'local' ||
    (!isHuggingFaceSpaces() && !process.env.PRODUCTION);
}

/**
 * Load environment variables from .env.local for local development
 */
async function loadLocalEnv(): Promise<void> {
  if (isLocalEnvironment()) {
    try {
      const envPath = path.join(process.cwd(), '.env.local');
      if (await fs.pathExists(envPath)) {
        const envContent = await fs.readFile(envPath, 'utf-8');
        const envLines = envContent.split('\n');

        for (const line of envLines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=');
            if (key && value && !process.env[key]) {
              process.env[key] = value;
            }
          }
        }
        console.log('📁 Loaded local environment variables from .env.local');
      }
    } catch (error) {
      console.warn('⚠️  Could not load .env.local:', error);
    }
  }
}

/**
 * Get the appropriate base URL for the environment
 */
function getBaseUrl(): string {
  // Explicit override takes precedence everywhere
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }

  if (isHuggingFaceSpaces()) {
    // On Hugging Face Spaces, prefer provided URLs
    if (process.env.SPACE_HOST) {
      // SPACE_HOST is the full hostname (e.g., username-spacename.hf.space)
      return `https://${process.env.SPACE_HOST}`;
    }
    if (process.env.HF_SPACE_URL) return process.env.HF_SPACE_URL;
    if (process.env.HUGGINGFACE_SPACE_URL) return process.env.HUGGINGFACE_SPACE_URL as string;

    // Derive from SPACE_ID or HF_SPACE_ID if present (e.g., iamromeoly/TTTranscibe -> iamromeoly-tttranscibe.hf.space)
    const rawId = process.env.SPACE_ID || process.env.HF_SPACE_ID || process.env.HUGGINGFACE_SPACE_ID;
    if (rawId) {
      const slug = rawId.replace(/[\/_]+/g, '-').toLowerCase();
      return `https://${slug}.hf.space`;
    }

    // Last resort: use container port (internal only)
    const port = process.env.PORT || '8788';
    return `http://0.0.0.0:${port}`;
  }

  // Local development
  const port = process.env.PORT || '8788';
  return `http://localhost:${port}`;
}

/**
 * Initialize configuration based on environment
 */
export async function initializeConfig(): Promise<TTTranscribeConfig> {
  // Load local environment variables if in local development
  await loadLocalEnv();

  const isHuggingFace = isHuggingFaceSpaces();
  const isLocal = isLocalEnvironment();

  // Get configuration with environment-specific defaults
  // Compute tmpDir cross-platform
  const resolvedTmpDir = (() => {
    if (process.env.TMP_DIR) return process.env.TMP_DIR;
    if (isHuggingFace) return '/tmp';
    // On Windows, prefer project local tmp directory to avoid permission issues
    if (process.platform === 'win32') {
      return path.join(process.cwd(), 'tmp');
    }
    return '/tmp/ttt';
  })();

  const config: TTTranscribeConfig = {
    port: parseInt(process.env.PORT || '8788'),
    engineSharedSecret: process.env.ENGINE_SHARED_SECRET || process.env.TTT_SHARED_SECRET || '',
    hfApiKey: process.env.HF_API_KEY,
    asrProvider: process.env.ASR_PROVIDER || 'hf',
    tmpDir: resolvedTmpDir,
    keepTextMax: parseInt(process.env.KEEP_TEXT_MAX || '10000'),
    isHuggingFace,
    isLocal,
    baseUrl: getBaseUrl(),
    allowPlaceholderTranscription: (process.env.ALLOW_PLACEHOLDER_TRANSCRIPTION ||
      (isHuggingFace ? 'false' : 'true')).toLowerCase() === 'true',
    rateLimitCapacity: parseInt(process.env.RATE_LIMIT_CAPACITY || '10'),
    rateLimitRefillPerMin: parseInt(process.env.RATE_LIMIT_REFILL_PER_MIN || '10'),
    webhookUrl: process.env.BUSINESS_ENGINE_WEBHOOK_URL || 'https://pluct-business-engine.romeo-lya2.workers.dev/webhooks/tttranscribe',
    webhookSecret: process.env.BUSINESS_ENGINE_WEBHOOK_SECRET
      || process.env.SHARED_SECRET
      || process.env.ENGINE_SHARED_SECRET
      || process.env.TTT_SHARED_SECRET
      || '',
    apiVersion: process.env.API_VERSION || '1.0.0'
  };

  // Log environment information
  console.log(`🌍 Environment: ${isLocal ? 'local development' : 'production'}`);
  console.log(`🚀 Platform: ${isHuggingFace ? 'Hugging Face Spaces' : 'local'}`);
  console.log(`🔗 Base URL: ${config.baseUrl}`);
  console.log(`📡 Webhook URL: ${config.webhookUrl}`);
  console.log(`🔢 API Version: ${config.apiVersion}`);

  // Critical security check: Ensure auth secret is set in production
  if (isHuggingFace && !config.engineSharedSecret) {
    console.error('❌ CRITICAL: ENGINE_SHARED_SECRET not set in Hugging Face Spaces!');
    console.error('   Please configure this secret in your Space settings.');
    process.exit(1);
  }

  if (isLocal && !config.engineSharedSecret) {
    console.warn('⚠️  ENGINE_SHARED_SECRET not set in local environment.');
    console.warn('   Authentication will fail unless you set this variable in .env.local');
  }

  if (isLocal && !config.hfApiKey) {
    console.warn('⚠️  HF_API_KEY not set - transcription will fail without API key');
  }

  if (isHuggingFace && !config.hfApiKey) {
    console.warn('⚠️  HF_API_KEY not configured in Hugging Face Spaces secrets');
  }

  return config;
}

/**
 * Get environment-specific logging configuration
 */
export function getLoggingConfig() {
  return {
    enableStructuredLogging: true,
    logLevel: process.env.LOG_LEVEL || 'info',
    includeTimestamp: true,
    includeEnvironment: true
  };
}

/**
 * Get environment-specific error handling configuration
 */
export function getErrorHandlingConfig() {
  return {
    enableDetailedErrors: process.env.NODE_ENV === 'development',
    enableStackTrace: process.env.NODE_ENV === 'development',
    enableRetryLogic: true,
    maxRetries: 3
  };
}
