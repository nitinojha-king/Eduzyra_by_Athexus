import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { submitFeedback, getFeedback, getFeedbackStats, deleteFeedback } from '../controllers/feedbackController.js'
import { protect, requireRole } from '../middleware/auth.js'
import { validate, submitFeedbackSchema } from '../validators/index.js'

const router = Router()

// Stricter limit for the public form only (mounted on the POST route so the
// admin GET/DELETE endpoints are unaffected — they sit behind auth anyway).
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many feedback submissions. Please try again later.' },
})

// Public — the /feedback page is open to students, instructors, and visitors
router.post('/', submitLimiter, validate(submitFeedbackSchema), submitFeedback)

// Admin dashboard — AdminFeedback panel
router.get('/', protect, requireRole('admin'), getFeedback)
router.get('/stats', protect, requireRole('admin'), getFeedbackStats)
router.delete('/:id', protect, requireRole('admin'), deleteFeedback)

export default router
