'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Diagnostic Logging Service (src/main/services/logger.js)
 * - Writes structured, timestamped logs to %APPDATA%/WiFiLabGuardian/logs/guardian.log
 * - Strictly sanitizes any XML <keyMaterial> or Wi-Fi passphrase fields so plain-text
 *   passwords are NEVER written to disk or returned to the UI.
 */
class LoggerService {
  constructor(userDataDir) {
    this.logDir = path.join(userDataDir, 'logs');
    this.logFile = path.join(this.logDir, 'guardian.log');
    this.memoryBuffer = [];
    this.maxMemoryEntries = 300;
    this._ensureDirectory();
  }

  _ensureDirectory() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (_) {
      // Fallback to in-memory buffer if directory is temporarily inaccessible
    }
  }

  /**
   * Redacts <keyMaterial>...</keyMaterial>, password fields, and passphrases.
   */
  sanitize(input) {
    if (input === null || input === undefined) return '';
    const raw = typeof input === 'string' ? input : JSON.stringify(input);
    return raw
      .replace(/<keyMaterial>[\s\S]*?<\/keyMaterial>/gi, '<keyMaterial>[REDACTED]</keyMaterial>')
      .replace(/"(password|passphrase|keyMaterial|sharedKey)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"');
  }

  _write(level, code, messageFr, messageEn, details = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      code,
      messageFr: this.sanitize(messageFr),
      messageEn: this.sanitize(messageEn),
      details: details ? this.sanitize(details) : null
    };

    this.memoryBuffer.unshift(entry);
    if (this.memoryBuffer.length > this.maxMemoryEntries) {
      this.memoryBuffer.length = this.maxMemoryEntries;
    }

    const line = `[${entry.timestamp}] [${entry.level}] [${entry.code}] FR="${entry.messageFr}" | EN="${entry.messageEn}"${entry.details ? ' | DETAILS=' + entry.details : ''}\n`;
    try {
      fs.appendFileSync(this.logFile, line, { encoding: 'utf8' });
    } catch (_) {
      // Ignore file I/O errors during shutdown
    }
    return entry;
  }

  info(code, messageFr, messageEn, details = null) {
    return this._write('INFO', code, messageFr, messageEn, details);
  }

  warn(code, messageFr, messageEn, details = null) {
    return this._write('WARN', code, messageFr, messageEn, details);
  }

  error(code, messageFr, messageEn, details = null) {
    return this._write('ERROR', code, messageFr, messageEn, details);
  }

  getRecentLogs(limit = 100) {
    return this.memoryBuffer.slice(0, Math.min(limit, this.maxMemoryEntries));
  }

  getLogFilePath() {
    return this.logFile;
  }
}

module.exports = { LoggerService };
