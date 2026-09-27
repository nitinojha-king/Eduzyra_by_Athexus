import Coupon from '../models/Coupon.js'
import Course from '../models/Course.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'

// POST /api/coupons/apply  { code, courseId }
export const applyCoupon = asyncHandler(async (req, res) => {
  const { code, courseId } = req.validatedBody || req.body

  const course = await Course.findBySlugOrId(courseId)
  if (!course) throw new ApiError(404, 'Course not found')

  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase() })

  if (!coupon || !coupon.active || (coupon.expiresAt && coupon.expiresAt < new Date())) {
    return res.json({ valid: false, discount: 0, finalPrice: course.price })
  }

  const discount =
    coupon.type === 'percentage' ? Math.round((course.price * coupon.value) / 100) : coupon.value
  const finalPrice = Math.max(course.price - discount, 0)

  res.json({ valid: true, coupon, discount, finalPrice })
})

// GET /api/coupons  (admin only)
export const getCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 })
  res.json(coupons)
})

// POST /api/coupons  (admin only)
export const createCoupon = asyncHandler(async (req, res) => {
  const data = req.validatedBody || req.body
  const coupon = await Coupon.create(data)
  res.status(201).json(coupon)
})

// DELETE /api/coupons/:id  (admin only)
export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id)
  if (!coupon) throw new ApiError(404, 'Coupon not found')
  res.json({ message: 'Coupon deleted' })
})
