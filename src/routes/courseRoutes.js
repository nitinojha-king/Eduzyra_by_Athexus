import { Router } from 'express'
import {
  getCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  uploadThumbnail,
  getAllCoursesAdmin,
  getInstructorCourses,
} from '../controllers/courseController.js'
import { protect, requireRole } from '../middleware/auth.js'
import { validate, createCourseSchema, updateCourseSchema } from '../validators/index.js'
import { thumbnailUpload } from '../middleware/upload.js'

const router = Router()

router.get('/', getCourses)
router.get('/admin/all', protect, requireRole('admin'), getAllCoursesAdmin)
router.get('/mine', protect, requireRole('instructor', 'admin'), getInstructorCourses)
router.get('/:id', getCourseById)
router.post('/', protect, requireRole('instructor', 'admin'), validate(createCourseSchema), createCourse)
router.put('/:id', protect, requireRole('instructor', 'admin'), validate(updateCourseSchema), updateCourse)
router.post('/:id/thumbnail', protect, requireRole('instructor', 'admin'), thumbnailUpload, uploadThumbnail)
router.delete('/:id', protect, requireRole('instructor', 'admin'), deleteCourse)

export default router
