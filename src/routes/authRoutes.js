import { Router } from 'express'
import { login, googleAuth, getMe, updateProfile, logout, getUsers, getStats, uploadAvatar, contactForm } from '../controllers/authController.js'
import { protect, requireRole } from '../middleware/auth.js'
import { validate, loginSchema, googleAuthSchema, updateProfileSchema, contactSchema } from '../validators/index.js'
import { profileUpload } from '../middleware/upload.js'

const router = Router()

router.post('/login', validate(loginSchema), login)
router.post('/google', validate(googleAuthSchema), googleAuth)
router.post('/logout', protect, logout)
router.get('/me', protect, getMe)
router.patch('/me', protect, validate(updateProfileSchema), updateProfile)
router.patch('/me/avatar', protect, profileUpload, uploadAvatar)
router.post('/contact', validate(contactSchema), contactForm)

router.get('/users', protect, requireRole('admin'), getUsers)
router.get('/stats', protect, requireRole('admin'), getStats)

export default router
