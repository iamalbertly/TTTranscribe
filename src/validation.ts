/**
 * Input validation and sanitization
 */

import { ValidationError } from './error-handler';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedValue?: string;
}

/**
 * Validate TikTok URL format
 */
export function validateTikTokUrl(url: string): ValidationResult {
  const errors: string[] = [];
  
  if (!url || typeof url !== 'string') {
    errors.push('URL is required and must be a string');
    return { isValid: false, errors };
  }
  
  // Basic URL format validation
  try {
    const urlObj = new URL(url);
    
    // Check protocol
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      errors.push('URL must use HTTP or HTTPS protocol');
    }
    
    // Check TikTok domain patterns
    const tiktokPatterns = [
      /^https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/,
      /^https?:\/\/vm\.tiktok\.com\/[\w]+/,
      /^https?:\/\/vt\.tiktok\.com\/[\w]+/
    ];
    
    const isValidTikTok = tiktokPatterns.some(pattern => pattern.test(url));
    if (!isValidTikTok) {
      errors.push('URL must be a valid TikTok video URL');
    }
    
    // Check URL length (prevent extremely long URLs)
    if (url.length > 2048) {
      errors.push('URL is too long (max 2048 characters)');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      sanitizedValue: url.trim()
    };
    
  } catch (error) {
    errors.push('Invalid URL format');
    return { isValid: false, errors };
  }
}

/**
 * Validate request ID format
 */
export function validateRequestId(id: string): ValidationResult {
  const errors: string[] = [];
  
  if (!id || typeof id !== 'string') {
    errors.push('Request ID is required and must be a string');
    return { isValid: false, errors };
  }
  
  // UUID format validation
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(id)) {
    errors.push('Request ID must be a valid UUID');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    sanitizedValue: id.trim().toLowerCase()
  };
}

/**
 * Sanitize text content
 */
export function sanitizeText(text: string, maxLength: number = 10000): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  // Remove potentially dangerous characters
  let sanitized = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .replace(/[<>]/g, '') // Remove angle brackets
    .trim();
  
  // Truncate if too long
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + '...';
  }
  
  return sanitized;
}

/**
 * Validate environment variables
 */
export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const required = [
    'ENGINE_SHARED_SECRET',
    'ASR_PROVIDER'
  ];
  
  for (const key of required) {
    if (!process.env[key]) {
      errors.push(`Missing required environment variable: ${key}`);
    }
  }
  
  // Validate ASR_PROVIDER value
  if (process.env.ASR_PROVIDER && !['hf', 'local'].includes(process.env.ASR_PROVIDER)) {
    errors.push('ASR_PROVIDER must be either "hf" or "local"');
  }
  
  // Validate HF_API_KEY if using HF provider
  if (process.env.ASR_PROVIDER === 'hf' && !process.env.HF_API_KEY) {
    errors.push('HF_API_KEY is required when ASR_PROVIDER is "hf"');
  }
  
  // Validate PORT
  if (process.env.PORT) {
    const port = parseInt(process.env.PORT);
    if (isNaN(port) || port < 1 || port > 65535) {
      errors.push('PORT must be a valid port number (1-65535)');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate and sanitize request body
 */
export function validateTranscribeRequest(body: any): { url: string } {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object');
  }
  
  if (!body.url) {
    throw new ValidationError('Missing required field: url');
  }
  
  const urlValidation = validateTikTokUrl(body.url);
  if (!urlValidation.isValid) {
    throw new ValidationError(`Invalid URL: ${urlValidation.errors.join(', ')}`);
  }
  
  return {
    url: urlValidation.sanitizedValue!
  };
}

/**
 * Rate limiting validation (basic)
 */
export function validateRateLimit(requestId: string, ip: string): boolean {
  // Simple in-memory rate limiting (replace with Redis in production)
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 10;
  
  // This is a simplified implementation
  // In production, use a proper rate limiting library
  return true; // For now, allow all requests
}
