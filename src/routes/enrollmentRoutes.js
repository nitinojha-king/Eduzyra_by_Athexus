import { Router } from 'express'
import { getMyEnrollments, enrollInCourse, updateProgress } from '../controllers/enrollmentController.js'
import { protect } from '../middleware/auth.js'
import { validate, enrollInCourseSchema, updateProgressSchema } from '../validators/index.js'

const router = Router()

router.use(protect)
router.get('/me', getMyEnrollments)
router.post('/', validate(enrollInCourseSchema), enrollInCourse)
router.patch('/:id/progress', validate(updateProgressSchema), updateProgress)

export default router
