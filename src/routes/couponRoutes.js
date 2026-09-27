import { Router } from 'express'
import { applyCoupon, getCoupons, createCoupon, deleteCoupon } from '../controllers/couponController.js'
import { protect, requireRole } from '../middleware/auth.js'
import { validate, applyCouponSchema, createCouponSchema } from '../validators/index.js'

const router = Router()

router.post('/apply', protect, validate(applyCouponSchema), applyCoupon)
router.get('/', protect, requireRole('admin'), getCoupons)
router.post('/', protect, requireRole('admin'), validate(createCouponSchema), createCoupon)
router.delete('/:id', protect, requireRole('admin'), deleteCoupon)

export default router
