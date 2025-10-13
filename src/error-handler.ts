/**
 * Comprehensive error handling and retry logic
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2
};

export class TTTranscribeError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'TTTranscribeError';
  }
}

export class NetworkError extends TTTranscribeError {
  constructor(message: string, public originalError?: Error) {
    super(message, 'NETWORK_ERROR', 503, true);
  }
}

export class ValidationError extends TTTranscribeError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400, false);
  }
}

export class AuthenticationError extends TTTranscribeError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'AUTH_ERROR', 401, false);
  }
}

export class RateLimitError extends TTTranscribeError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 'RATE_LIMIT', 429, true);
  }
}

/**
 * Retry function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error;
  
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on non-retryable errors
      if (error instanceof TTTranscribeError && !error.retryable) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === opts.maxRetries) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelay
      );
      
      console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error instanceof Error ? error.message : String(error));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

/**
 * Safe async execution with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string = 'Operation timed out'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Error sanitization for logging
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    // Remove sensitive information from error messages
    return error.message
      .replace(/Bearer\s+[^\s]+/g, 'Bearer [REDACTED]')
      .replace(/key[=:]\s*[^\s]+/gi, 'key=[REDACTED]')
      .replace(/token[=:]\s*[^\s]+/gi, 'token=[REDACTED]');
  }
  
  return String(error);
}

/**
 * Global error handler for unhandled promises
 */
export function setupGlobalErrorHandling(): void {
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', sanitizeError(reason));
  });
  
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', sanitizeError(error));
    process.exit(1);
  });
}
