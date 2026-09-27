import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  createLiveSession,
  listLiveSessions,
  getLiveSession,
  updateLiveSession,
  deleteLiveSession,
  joinLiveSession,
} from '../controllers/liveSessionController.js'
import { protect, requireRole } from '../middleware/auth.js'
import { validate, liveSessionSchema, updateLiveSessionSchema } from '../validators/index.js'

// Nested under /api/courses/:courseId/live-sessions
export const courseLiveSessionRouter = Router({ mergeParams: true })
courseLiveSessionRouter.post('/', protect, requireRole('instructor', 'admin'), validate(liveSessionSchema), createLiveSession)
courseLiveSessionRouter.get('/', protect, listLiveSessions)

// Flat /api/live-sessions/:id
export const liveSessionRouter = Router()

const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: 'Too many join attempts, please try again later.' },
})

liveSessionRouter.get('/:id', protect, getLiveSession)
liveSessionRouter.patch('/:id', protect, requireRole('instructor', 'admin'), validate(updateLiveSessionSchema), updateLiveSession)
liveSessionRouter.delete('/:id', protect, requireRole('instructor', 'admin'), deleteLiveSession)
liveSessionRouter.post('/:id/join', protect, joinLimiter, joinLiveSession)
