// Security middleware for request validation and protection against common attacks.
// This module provides additional security layers beyond Helmet and basic rate limiting.

import { config } from '../config.js';

// ── Request body size limiter (defense-in-depth) ──
// While Express already has a limit, this provides an additional layer
// for specific content types that might bypass the default limit.
export function bodySizeGuard(maxSizeMb = 8) {
  const maxBytes = maxSizeMb * 1024 * 1024;
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > maxBytes) {
      return res.status(413).json({ error: 'Request body too large' });
    }
    next();
  };
}

// ── SQL injection prevention middleware ──
// Additional layer beyond parameterized queries - scans for common SQL patterns
export function sqlInjectionGuard(req, res, next) {
  const suspiciousPatterns = [
    /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute|execmaster|xp_)[\s(])/i,
    /(--|;|\/\*|\*\/|xp_cmdshell|sp_executesql)/i,
    /(0x[0-9a-f]+|char\(|nchar\(|varchar\(|nvarchar\()/i,
    /(\b(or|and)\b\s+\d+\s*=\s*\d+)/i,
    /(';\s*(drop|alter|create|exec)\s)/i,
  ];

  // Check query parameters
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string') {
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(value)) {
          console.warn(`[security] Suspicious query parameter detected: ${key}=${value.substring(0, 50)}`);
          return res.status(400).json({ error: 'Invalid request parameters' });
        }
      }
    }
  }

  // Check URL path
  const path = req.originalUrl || req.url;
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(path)) {
      console.warn(`[security] Suspicious URL path detected: ${path.substring(0, 100)}`);
      return res.status(400).json({ error: 'Invalid request path' });
    }
  }

  next();
}

// ── Path traversal prevention ──
export function pathTraversalGuard(req, res, next) {
  const path = decodeURIComponent(req.originalUrl || req.url);
  const traversalPatterns = [
    /\.\.\//,           // ../
    /\.\.%2f/i,         // ../ (encoded)
    /\.\.\\/,           // ..\ (Windows)
    /\.\.%5c/i,         // ..\ (encoded)
    /%2e%2e/i,          // .. (encoded)
    /\.\./,             // Any double dot
  ];

  for (const pattern of traversalPatterns) {
    if (pattern.test(path)) {
      console.warn(`[security] Path traversal attempt detected: ${path.substring(0, 100)}`);
      return res.status(400).json({ error: 'Invalid path' });
    }
  }

  next();
}

// ── Request method validation ──
// Only allow standard HTTP methods
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

export function methodGuard(req, res, next) {
  if (!ALLOWED_METHODS.has(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  next();
}

// ── Request timeout middleware ──
// Prevent long-running requests from exhausting server resources
export function requestTimeout(timeoutMs = 30000) {
  return (req, res, next) => {
    // Set a timeout on the response
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({ error: 'Request timeout' });
      }
    }, timeoutMs);

    // Clear timeout when response finishes
    res.on('finish', () => clearTimeout(timeout));
    res.on('close', () => clearTimeout(timeout));

    next();
  };
}

// ── IP-based blocking (in-memory, for development) ──
// In production, use a proper firewall or WAF
const blockedIPs = new Map(); // ip -> { blockedUntil, reason }

export function ipBlockGuard(req, res, next) {
  const clientIP = req.ip || req.connection?.remoteAddress;
  if (!clientIP) return next();

  const blocked = blockedIPs.get(clientIP);
  if (blocked) {
    if (Date.now() < blocked.blockedUntil) {
      console.warn(`[security] Blocked IP ${clientIP} (until ${new Date(blocked.blockedUntil).toISOString()})`);
      return res.status(403).json({ error: 'Access denied' });
    }
    // Block expired, remove it
    blockedIPs.delete(clientIP);
  }

  next();
}

// ── Block an IP (used by brute-force protection) ──
export function blockIP(ip, durationMs = 15 * 60 * 1000, reason = 'Too many failed attempts') {
  blockedIPs.set(ip, {
    blockedUntil: Date.now() + durationMs,
    reason,
  });
  console.warn(`[security] Blocked IP ${ip} for ${durationMs / 1000}s: ${reason}`);
}

// ── Security audit logging ──
export function securityAuditLog(req, action, details = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection?.remoteAddress,
    method: req.method,
    path: req.originalUrl || req.url,
    userAgent: req.headers['user-agent']?.substring(0, 100),
    action,
    ...details,
  };

  // In production, send to SIEM/audit system
  if (config.isProd) {
    // TODO: Send to external audit system
    console.log('[security-audit]', JSON.stringify(logEntry));
  } else {
    console.log('[security-audit]', JSON.stringify(logEntry));
  }
}

// ── Combine all security middleware ──
export function securityMiddleware() {
  return [
    methodGuard,
    sqlInjectionGuard,
    pathTraversalGuard,
    ipBlockGuard,
    bodySizeGuard(8), // 8MB limit
    requestTimeout(30000), // 30 second timeout
  ];
}
