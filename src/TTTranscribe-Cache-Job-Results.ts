/**
 * Job result caching with 48-hour TTL
 * Implements Redis-style in-memory cache for transcription results
 */

export interface CachedJobResult {
  url: string;
  result: {
    transcription: string;
    confidence: number;
    language: string;
    duration: number;
    wordCount: number;
    speakerCount: number;
    audioQuality: string;
    processingTime: number;
  };
  metadata: {
    title?: string;
    author?: string;
    description?: string;
    url: string;
  };
  cachedAt: string;
  expiresAt: string;
}

class JobResultCache {
  private cache = new Map<string, CachedJobResult>();
  private readonly TTL_HOURS = 48;
  private hitCount = 0;
  private missCount = 0;
  
  /**
   * Generate normalized cache key from URL
   */
  generateCacheKey(url: string): string {
    // Normalize URL by removing query parameters and fragments
    const normalizedUrl = url.split('?')[0].split('#')[0];
    
    // Create a simple hash (in production, use crypto.createHash)
    let hash = 0;
    for (let i = 0; i < normalizedUrl.length; i++) {
      const char = normalizedUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return `tiktok_${Math.abs(hash).toString(36)}`;
  }
  
  /**
   * Get cached result if available and not expired
   */
  get(url: string): CachedJobResult | null {
    const key = this.generateCacheKey(url);
    const cached = this.cache.get(key);
    
    if (!cached) {
      this.missCount++;
      return null;
    }
    
    // Check if expired
    const now = new Date();
    const expiresAt = new Date(cached.expiresAt);
    
    if (now > expiresAt) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }
    
    this.hitCount++;
    return cached;
  }
  
  /**
   * Store result in cache with 48-hour TTL
   */
  set(url: string, result: any, metadata: any): void {
    const key = this.generateCacheKey(url);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (this.TTL_HOURS * 60 * 60 * 1000));
    
    const cached: CachedJobResult = {
      url,
      result: {
        transcription: result.transcription || '',
        confidence: result.confidence || 0.95,
        language: result.language || 'en',
        duration: result.duration || 0,
        wordCount: result.wordCount || 0,
        speakerCount: result.speakerCount || 1,
        audioQuality: result.audioQuality || 'high',
        processingTime: result.processingTime || 0
      },
      metadata: {
        title: metadata.title,
        author: metadata.author,
        description: metadata.description,
        url: metadata.url
      },
      cachedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };
    
    this.cache.set(key, cached);
    console.log(`Cached result for ${url} (expires: ${expiresAt.toISOString()})`);
  }
  
  /**
   * Remove expired entries from cache
   */
  cleanup(): void {
    const now = new Date();
    let removedCount = 0;
    
    for (const [key, cached] of this.cache.entries()) {
      const expiresAt = new Date(cached.expiresAt);
      if (now > expiresAt) {
        this.cache.delete(key);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      console.log(`Cache cleanup: removed ${removedCount} expired entries`);
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    hitRate: number;
    hitCount: number;
    missCount: number;
    oldestEntry?: string;
  } {
    const totalRequests = this.hitCount + this.missCount;
    const hitRate = totalRequests > 0 ? (this.hitCount / totalRequests) : 0;
    
    let oldestEntry: string | undefined;
    if (this.cache.size > 0) {
      const oldest = Array.from(this.cache.values())
        .sort((a, b) => new Date(a.cachedAt).getTime() - new Date(b.cachedAt).getTime())[0];
      oldestEntry = oldest.cachedAt;
    }
    
    return {
      size: this.cache.size,
      hitRate: Math.round(hitRate * 100) / 100,
      hitCount: this.hitCount,
      missCount: this.missCount,
      oldestEntry
    };
  }
  
  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
    console.log('Cache cleared');
  }
  
  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
  
  /**
   * Get hit rate percentage
   */
  getHitRate(): number {
    const totalRequests = this.hitCount + this.missCount;
    return totalRequests > 0 ? Math.round((this.hitCount / totalRequests) * 100) : 0;
  }
  
  /**
   * Get age of oldest entry in hours
   */
  getOldestEntryAge(): number {
    if (this.cache.size === 0) return 0;
    
    const now = new Date();
    const oldest = Array.from(this.cache.values())
      .sort((a, b) => new Date(a.cachedAt).getTime() - new Date(b.cachedAt).getTime())[0];
    
    const ageMs = now.getTime() - new Date(oldest.cachedAt).getTime();
    return Math.round(ageMs / (1000 * 60 * 60) * 100) / 100; // Hours with 2 decimal places
  }
}

// Export singleton instance
export const jobResultCache = new JobResultCache();
