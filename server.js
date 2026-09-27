import 'dotenv/config'
import mongoose from 'mongoose'
import app from './src/app.js'
import { connectDB } from './src/config/db.js'
import logger from './src/utils/logger.js'

const PORT = process.env.PORT || 5000
let server = null

async function start() {
  try {
    await connectDB()
    server = app.listen(PORT, () => {
      logger.info(`Eduzyra API listening on http://localhost:${PORT}`)
    })
  } catch (err) {
    logger.error('Failed to start server:', { error: err.message, stack: err.stack })
    process.exit(1)
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────
// Stops accepting new connections, waits for in-flight requests, closes DB, exits.
async function gracefulShutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`)

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed')
      try {
        await mongoose.connection.close()
        logger.info('MongoDB connection closed')
      } catch (err) {
        logger.error('Error closing MongoDB:', { error: err.message })
      }
      process.exit(0)
    })

    // Force exit after 10 seconds if in-flight requests don't finish
    setTimeout(() => {
      logger.error('Forced shutdown — timed out waiting for connections to close')
      process.exit(1)
    }, 10000)
  } else {
    process.exit(0)
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// ── Global process handlers ───────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason: reason?.stack || String(reason) })
  process.exit(1)
})

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack })
  process.exit(1)
})

start()
