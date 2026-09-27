import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import mongoSanitize from 'express-mongo-sanitize'
import cookieParser from 'cookie-parser'
import mongoose from 'mongoose'

import authRoutes from './routes/authRoutes.js'
import courseRoutes from './routes/courseRoutes.js'
import enrollmentRoutes from './routes/enrollmentRoutes.js'
import paymentRoutes from './routes/paymentRoutes.js'
import certificateRoutes from './routes/certificateRoutes.js'
import couponRoutes from './routes/couponRoutes.js'
import notificationRoutes from './routes/notificationRoutes.js'
import lessonRoutes from './routes/lessonRoutes.js'
import feedbackRoutes from './routes/feedbackRoutes.js'
import liveClassRoutes from './routes/liveClassRoutes.js'
import { courseLiveSessionRouter, liveSessionRouter } from './routes/liveSessionRoutes.js'
import { notFound, errorHandler } from './middleware/errorHandler.js'
import logger from './utils/logger.js'

const app = express()

// Security headers
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}))

// Rate limiting
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { message: 'Too many auth attempts, please try again later.' } })
const apiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 100, message: { message: 'Too many requests, please try again later.' } })
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/signup', authLimiter)
app.use('/api/auth/forgot-password', authLimiter)
app.use('/api/auth/verify-otp', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: 'Too many verification attempts, please try again later.' },
}))
app.use('/api/auth/resend-otp', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many code requests, please try again later.' },
}))
app.use('/api/auth/contact', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many contact form submissions. Please try again later.' },
}))
app.use('/api', apiLimiter)

// ── Secure CORS ───────────────────────────────────────────────────────────
// Replace the insecure `origin: '*'` fallback with an explicit allowlist.
// CLIENT_ORIGIN is a comma-separated list of allowed origins. In production,
// set it to the frontend domain (e.g., https://eduzyra.example.com). For
// multiple origins, comma-separate them: https://a.com,https://b.com
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no Origin header (curl, Postman, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))

// Cookie parser (added in Phase 7 — required if we ever switch to cookie-based auth)
app.use(cookieParser())

// ⚠─ Razorpay webhook raw body capture ────────────────────────────────────
// MUST be mounted BEFORE the global express.json() so the webhook route
// receives the raw request body (as a Buffer) for HMAC-SHA256 signature
// verification. If express.json() parses the body first, the signature
// will never match because the bytes have been re-serialized.
//
// express.raw() populates req.body with a Buffer — the controller handles
// HMAC verification directly against this buffer, then JSON.parse()s it
// locally to read event fields. No companion middleware required.
//
// This middleware ONLY applies to POST /api/payments/webhook — all other
// routes continue to use the global express.json() below.
app.use(
  '/api/payments/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
)

// Global JSON body parser for all other routes
app.use(express.json({ limit: '1mb' }))

// ── NoSQL injection prevention ────────────────────────────────────────────
// Strips $ and . characters from req.body, req.query, and req.params so
// attackers can't send operators like { "$ne": null } to bypass queries.
// MUST come after express.json() so the body is parsed first.
app.use(mongoSanitize())

if (process.env.NODE_ENV !== 'test') {
  // In production, use Morgan 'combined' format piped through Winston.
  // In development, use Morgan 'dev' format to the console directly.
  if (process.env.NODE_ENV === 'production') {
    app.use(morgan('combined', { stream: logger.stream }))
  } else {
    app.use(morgan('dev'))
  }
}

app.get('/', (req, res) => {
  res.json({
    name: 'Eduzyra API',
    version: '0.2.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      courses: '/api/courses',
      enrollments: '/api/enrollments',
      payments: '/api/payments',
      certificates: '/api/certificates',
      coupons: '/api/coupons',
      feedback: '/api/feedback',
      liveClasses: '/api/live-classes',
      liveSessions: '/api/live-sessions + /api/courses/:courseId/live-sessions',
    },
  })
})

// ── Health check (extended in Phase 8) ────────────────────────────────────
// Returns DB connection state, uptime, and timestamp for monitoring.
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState // 1 = connected
  res.json({
    status: dbState === 1 ? 'ok' : 'degraded',
    db: dbState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/courses', courseRoutes)
app.use('/api/enrollments', enrollmentRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/certificates', certificateRoutes)
app.use('/api/coupons', couponRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/lessons', lessonRoutes)
app.use('/api/feedback', feedbackRoutes)
app.use('/api/live-classes', liveClassRoutes)
app.use('/api/courses/:courseId/live-sessions', courseLiveSessionRouter)
app.use('/api/live-sessions', liveSessionRouter)

app.use(notFound)
app.use(errorHandler)

export default app
