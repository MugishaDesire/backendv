// middleware/rateLimiter.js
const rateLimit = require("express-rate-limit");

// General limiter — for most public-facing routes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per IP per window
  standardHeaders: true, // sends RateLimit-* headers
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests, please try again later.",
  },
});

// Stricter limiter — for sensitive/expensive routes (e.g. checkout, payment, login)
const strictLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests to this endpoint. Slow down.",
  },
});

// Looser limiter — for read-heavy routes like product browsing
const readLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { generalLimiter, strictLimiter, readLimiter };