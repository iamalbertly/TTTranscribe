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
}

/**
 * Detect if running on Hugging Face Spaces
 */
function isHuggingFaceSpaces(): boolean {
  return !!(
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
  if (isHuggingFaceSpaces()) {
    // On Hugging Face Spaces, use the space URL
    const spaceUrl = process.env.HF_SPACE_URL || 
                    process.env.HUGGINGFACE_SPACE_URL ||
                    `https://${process.env.HF_SPACE_ID || process.env.HUGGINGFACE_SPACE_ID}.hf.space`;
    return spaceUrl;
  } else {
    // Local development
    const port = process.env.PORT || '8788';
    return `http://localhost:${port}`;
  }
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
    engineSharedSecret: process.env.ENGINE_SHARED_SECRET || 'super-long-random',
    hfApiKey: process.env.HF_API_KEY,
    asrProvider: process.env.ASR_PROVIDER || 'hf',
    tmpDir: resolvedTmpDir,
    keepTextMax: parseInt(process.env.KEEP_TEXT_MAX || '10000'),
    isHuggingFace,
    isLocal,
    baseUrl: getBaseUrl()
  };
  
  // Log environment information
  console.log(`🌍 Environment: ${isLocal ? 'local development' : 'production'}`);
  console.log(`🚀 Platform: ${isHuggingFace ? 'Hugging Face Spaces' : 'local'}`);
  console.log(`🔗 Base URL: ${config.baseUrl}`);
  
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
