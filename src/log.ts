/**
 * Unified logging for TTTranscribe
 * Format: ttt:phase req=<id> phase=<PHASE> pct=<n> note=<short-string>
 * Format: ttt:error req=<id> where=<component> msg=<error>
 * Format: ttt:accepted req=<id> url=<short-id>
 */

export type LogLevel = 'phase' | 'error' | 'accepted';

export interface LogEntry {
  level: LogLevel;
  requestId: string;
  phase?: string;
  percent?: number;
  note?: string;
  where?: string;
  msg?: string;
  url?: string;
}

export function logPhase(requestId: string, phase: string, percent: number, note: string): void {
  console.log(`ttt:phase req=${requestId} phase=${phase} pct=${percent} note=${note}`);
}

export function logError(requestId: string, where: string, msg: string): void {
  console.log(`ttt:error req=${requestId} where=${where} msg=${msg}`);
}

export function logAccepted(requestId: string, url: string): void {
  // Truncate URL to last 12 characters for logging
  const shortUrl = url.slice(-12);
  console.log(`ttt:accepted req=${requestId} url=${shortUrl}`);
}

export function logGeneric(level: LogLevel, requestId: string, data: Partial<LogEntry>): void {
  const parts = [`ttt:${level}`, `req=${requestId}`];
  
  if (data.phase) parts.push(`phase=${data.phase}`);
  if (data.percent !== undefined) parts.push(`pct=${data.percent}`);
  if (data.note) parts.push(`note=${data.note}`);
  if (data.where) parts.push(`where=${data.where}`);
  if (data.msg) parts.push(`msg=${data.msg}`);
  if (data.url) parts.push(`url=${data.url.slice(-12)}`);
  
  console.log(parts.join(' '));
}
