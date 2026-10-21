"use strict";
const crypto = require("node:crypto");

// Shared HTTP Basic authentication for this single-user document workspace.
// Configure both secrets in the hosting platform; absent secrets must not mean public access.
function constantTimeMatch(actual, expected) {
  const a = crypto.createHash("sha256").update(actual).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  if (!username || !password) {
    return res.status(503).send("Service temporarily unavailable: access credentials not configured.");
  }

  const authorization = req.headers.authorization || "";
  if (authorization.startsWith("Basic ") && authorization.length < 4096) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon > -1 && constantTimeMatch(decoded.slice(0, colon), username) && constantTimeMatch(decoded.slice(colon + 1), password)) {
        return next();
      }
    } catch (_error) {
      // Treat malformed credentials as unauthenticated.
    }
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="Contractor Workspace", charset="UTF-8"');
  return res.status(401).send("Authentication required.");
}

module.exports = { requireAuth };
