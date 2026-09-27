import { Router } from 'express'
import { signup, login, verifyOtp, resendOtp, getMe, forgotPassword, resetPassword, updateProfile, logout, getUsers, getStats, uploadAvatar, contactForm, getDevOtp } from '../controllers/authController.js'
import { protect, requireRole } from '../middleware/auth.js'
import { validate, signupSchema, loginSchema, verifyOtpSchema, resendOtpSchema, forgotPasswordSchema, resetPasswordSchema, updateProfileSchema, contactSchema } from '../validators/index.js'
import { profileUpload } from '../middleware/upload.js'

const router = Router()

router.post('/signup', validate(signupSchema), signup)
router.post('/login', validate(loginSchema), login)
router.post('/verify-otp', validate(verifyOtpSchema), verifyOtp)
router.post('/resend-otp', validate(resendOtpSchema), resendOtp)
if (process.env.NODE_ENV !== 'production') {
  router.get('/dev/otp', getDevOtp)
}
router.post('/logout', protect, logout)
router.get('/me', protect, getMe)
router.patch('/me', protect, validate(updateProfileSchema), updateProfile)
router.patch('/me/avatar', protect, profileUpload, uploadAvatar)
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword)
router.post('/reset-password', validate(resetPasswordSchema), resetPassword)
router.post('/contact', validate(contactSchema), contactForm)

router.get('/users', protect, requireRole('admin'), getUsers)
router.get('/stats', protect, requireRole('admin'), getStats)

export default router
