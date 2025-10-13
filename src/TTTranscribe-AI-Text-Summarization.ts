/**
 * Optional summarization module
 * Creates a brief summary of the transcribed text
 */

export async function summarize(text: string): Promise<string> {
  if (!text || text.trim().length === 0) {
    return 'No content to summarize';
  }
  
  try {
    // Simple summarization logic
    // In production, you might use an AI summarization service
    
    // Basic summarization: first sentence + key points
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length === 0) {
      return 'Content processed successfully';
    }
    
    // Take first sentence as main point
    let summary = sentences[0].trim();
    
    // Add key points if text is long
    if (text.length > 200) {
      const words = text.toLowerCase().split(/\s+/);
      const wordCounts = new Map<string, number>();
      
      // Count word frequency (excluding common words)
      const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them']);
      
      words.forEach(word => {
        if (word.length > 3 && !stopWords.has(word)) {
          wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
        }
      });
      
      // Get top keywords
      const topWords = Array.from(wordCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([word]) => word);
      
      if (topWords.length > 0) {
        summary += ` (Keywords: ${topWords.join(', ')})`;
      }
    }
    
    // Truncate if too long
    const maxLength = 200;
    if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength) + '...';
    }
    
    return summary;
    
  } catch (error) {
    return `Summary generation failed: ${error}`;
  }
}

/**
 * Advanced summarization using external API (placeholder)
 */
export async function summarizeWithAI(text: string): Promise<string> {
  // This would integrate with an AI summarization service
  // For now, fall back to basic summarization
  return await summarize(text);
}

/**
 * Extract key topics from text
 */
export function extractTopics(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const wordCounts = new Map<string, number>();
  
  // Count word frequency (excluding common words)
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them']);
  
  words.forEach(word => {
    if (word.length > 3 && !stopWords.has(word)) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  });
  
  // Get top topics
  return Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}
