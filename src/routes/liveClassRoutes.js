import { Router } from 'express'
import {
  listLiveClasses,
  getLiveClass,
  createLiveClass,
  updateLiveClass,
  startLiveClass,
  endLiveClass,
  joinLiveClass,
  leaveLiveClass,
  getAttendees,
  deleteLiveClass,
} from '../controllers/liveClassController.js'
import { protect, requireRole } from '../middleware/auth.js'
import { validate, liveClassSchema, updateLiveClassSchema } from '../validators/index.js'

const router = Router()

// Public — list upcoming/scheduled live classes for a course (?course=slug)
router.get('/', listLiveClasses)

// Protected — single class (roster included)
router.get('/:id', protect, getLiveClass)

// Student actions (enrolled) — join/leave + attendance roster
router.post('/:id/join', protect, joinLiveClass)
router.post('/:id/leave', protect, leaveLiveClass)
router.get('/:id/attendees', protect, getAttendees)

// Instructor/admin — lifecycle
router.patch('/:id/start', protect, requireRole('instructor', 'admin'), startLiveClass)
router.patch('/:id/end', protect, requireRole('instructor', 'admin'), endLiveClass)

// Instructor/admin — CRUD
router.post('/', protect, requireRole('instructor', 'admin'), validate(liveClassSchema), createLiveClass)
router.put('/:id', protect, requireRole('instructor', 'admin'), validate(updateLiveClassSchema), updateLiveClass)

// Admin only — delete
router.delete('/:id', protect, requireRole('admin'), deleteLiveClass)

export default router
