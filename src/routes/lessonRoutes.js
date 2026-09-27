import { Router } from 'express'
import {
  getLessonsByCourse,
  getLessonById,
  checkAnswer,
  createLesson,
  updateLesson,
  deleteLesson,
  uploadAttachment,
  submitAssignment,
} from '../controllers/lessonController.js'
import { protect, requireRole } from '../middleware/auth.js'
import { validate, lessonSchema } from '../validators/index.js'
import { pdfUpload } from '../middleware/upload.js'

const router = Router()

// Public — list lesson metadata for a course (title, type, module only — no content)
router.get('/', getLessonsByCourse)

// Protected — single lesson + answer check (enrolled students only)
router.get('/:id', protect, getLessonById)
router.get('/:id/answer', protect, checkAnswer)

// Student — submit assignment (enrolled only, uses pdfUpload)
router.post('/:id/submit', protect, pdfUpload, submitAssignment)

// Instructor/admin — CRUD
router.post('/', protect, requireRole('instructor', 'admin'), validate(lessonSchema), createLesson)
router.put('/:id', protect, requireRole('instructor', 'admin'), validate(lessonSchema.partial()), updateLesson)
router.post('/:id/attachment', protect, requireRole('instructor', 'admin'), pdfUpload, uploadAttachment)

// Admin only — delete
router.delete('/:id', protect, requireRole('admin'), deleteLesson)

export default router
