import winston from 'winston'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Winston logger — centralised logging for the Eduzyra backend.
 *
 * Transports:
 *   - Console (colorized, development)
 *   - logs/error.log (errors only)
 *   - logs/combined.log (all levels)
 *
 * Format: timestamp + level + message + metadata (JSON in prod, pretty in dev)
 *
 * Exports:
 *   - default: logger (the Winston instance)
 *   - stream: { write } — for Morgan to pipe HTTP logs into
 */

// Ensure logs/ directory exists
const logsDir = path.resolve(process.cwd(), 'logs')
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
  } catch {
    // Ignore — logging is best-effort, not critical
  }
}

const isProd = process.env.NODE_ENV === 'production'

const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: 'eduzyra-api' },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
})

// In non-production, also log to the console with colorized pretty output
if (!isProd) {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length && meta.service
            ? ''
            : ' ' + JSON.stringify(meta)
          return `${timestamp} ${level}: ${message}${metaStr}`
        }),
      ),
    }),
  )
}

// Stream for Morgan — pipes HTTP request logs into Winston
logger.stream = {
  write: (message) => {
    // Morgan messages end with a newline — trim it
    logger.info(message.trim())
  },
}

export default logger
export const stream = logger.stream
