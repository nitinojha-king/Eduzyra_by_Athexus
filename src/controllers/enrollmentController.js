import mongoose from 'mongoose'
import Course from '../models/Course.js'
import Enrollment from '../models/Enrollment.js'
import Order from '../models/Order.js'
import Certificate from '../models/Certificate.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { sendCertificateEmail } from '../services/emailService.js'
import { createNotification } from '../utils/createNotification.js'
import User from '../models/User.js'

// GET /api/enrollments/me
export const getMyEnrollments = asyncHandler(async (req, res) => {
  const enrollments = await Enrollment.find({ student: req.user._id }).populate('course')
  res.json(enrollments)
})

// POST /api/enrollments  { courseId, orderId? }
// Requires a paid order ID for paid courses — prevents free enrollment without payment.
// For FREE courses (price === 0), orderId is skipped and enrollment is direct.
// (The verifyPayment endpoint also auto-enrolls, so this is a fallback for edge cases
// and the primary path for free courses.)
export const enrollInCourse = asyncHandler(async (req, res) => {
  const { courseId, orderId } = req.validatedBody || req.body
  if (!courseId) throw new ApiError(400, 'courseId is required')

  const course = await Course.findBySlugOrId(courseId)
  if (!course) throw new ApiError(404, 'Course not found')

  // ── FREE COURSE PATH ──────────────────────────────────────────────────
  if (course.price === 0) {
    const existingFree = await Enrollment.findOne({ student: req.user._id, course: course._id }).populate('course')
    if (existingFree) return res.status(200).json(existingFree)

    // Use a transaction so all 3 writes are atomic
    const session = await mongoose.startSession()
    let freeEnrollment
    try {
      await session.withTransaction(async () => {
        const created = await Enrollment.create(
          [{ student: req.user._id, course: course._id }],
          { session },
        )
        freeEnrollment = created[0]
        await User.findByIdAndUpdate(
          req.user._id,
          { $addToSet: { enrolledCourses: course._id } },
          { session },
        )
        await Course.findByIdAndUpdate(
          course._id,
          { $inc: { students: 1 } },
          { session },
        )
      })
    } finally {
      session.endSession()
    }

    const populatedFree = await Enrollment.populate(freeEnrollment, { path: 'course' })
    return res.status(201).json(populatedFree)
  }

  // ── PAID COURSE PATH ──────────────────────────────────────────────────
  if (!orderId) throw new ApiError(400, 'orderId is required — enrollment requires a verified payment')

  const order = await Order.findOne({ _id: orderId, student: req.user._id, status: 'paid' })
  if (!order) throw new ApiError(403, 'Valid paid order is required to enroll')

  if (!order.course.equals(course._id)) throw new ApiError(400, 'Order does not match this course')

  const existing = await Enrollment.findOne({ student: req.user._id, course: course._id }).populate('course')
  if (existing) return res.status(200).json(existing)

  // Use a transaction for the paid path too
  const session = await mongoose.startSession()
  let enrollment
  try {
    await session.withTransaction(async () => {
      const created = await Enrollment.create(
        [{ student: req.user._id, course: course._id, order: order._id }],
        { session },
      )
      enrollment = created[0]
      await User.findByIdAndUpdate(
        req.user._id,
        { $addToSet: { enrolledCourses: course._id } },
        { session },
      )
      await Course.findByIdAndUpdate(
        course._id,
        { $inc: { students: 1 } },
        { session },
      )
    })
  } finally {
    session.endSession()
  }

  const populated = await Enrollment.populate(enrollment, { path: 'course' })
  res.status(201).json(populated)
})

// PATCH /api/enrollments/:id/progress  { progress }
// Automatically issues a certificate when progress reaches 100% for the first time.
// Returns enrollment data + certificate (if generated) for immediate UI display.
export const updateProgress = asyncHandler(async (req, res) => {
  const { progress } = req.validatedBody || req.body
  if (typeof progress !== 'number' || progress < 0 || progress > 100) {
    throw new ApiError(400, 'progress must be a number between 0 and 100')
  }

  const enrollment = await Enrollment.findOne({ _id: req.params.id, student: req.user._id })
  if (!enrollment) throw new ApiError(404, 'Enrollment not found')

  enrollment.progress = progress
  const isCompletion = progress >= 100 && !enrollment.completedAt
  if (isCompletion) {
    enrollment.completedAt = new Date()
  }
  await enrollment.save()

  let generatedCertificate = null

  // Auto-issue certificate on course completion
  if (isCompletion) {
    const course = await Course.findById(enrollment.course)
    const student = await User.findById(enrollment.student)

    console.log('[updateProgress] Course completion detected for student:', student?.email, 'course:', course?.title)

    if (course && student) {
      try {
        // Generate certificate ID with retry on duplicate-key collision
        const year = new Date().getFullYear()
        let certificate = null
        const MAX_RETRIES = 3

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          const countThisYear = await Certificate.countDocuments({
            certificateId: new RegExp(`^EDU-${year}-`),
          })
          const sequence = String(countThisYear + 1 + attempt).padStart(5, '0')

          try {
            certificate = await Certificate.create({
              certificateId: `EDU-${year}-${sequence}`,
              student: student._id,
              studentName: student.name,
              course: course._id,
              courseTitle: course.title,
              issuedOn: new Date().toISOString().slice(0, 10),
            })
            console.log('[updateProgress] Certificate created:', certificate.certificateId)
            generatedCertificate = certificate
            break // success
          } catch (err) {
            console.log('[updateProgress] Attempt', attempt + 1, 'to create certificate failed:', err.code)
            // If duplicate key error and we have retries left, loop again
            if (err.code === 11000 && attempt < MAX_RETRIES - 1) {
              continue
            }
            throw err
          }
        }

        if (certificate) {
          // Send certificate email (non-blocking)
          const certificateUrl = `${process.env.CLIENT_ORIGIN}/certificate/${certificate.certificateId}`
          console.log('[updateProgress] Sending certificate email to:', student.email)
          const emailSent = await sendCertificateEmail({
            name: student.name,
            email: student.email,
            courseTitle: course.title,
            certificateUrl,
            certificateId: certificate.certificateId,
          })

          if (!emailSent) {
            console.warn('[updateProgress] Certificate email delivery failed. Check SMTP configuration.')
          } else {
            console.log('[updateProgress] Certificate email sent successfully')
          }

          // Create in-app notification
          await createNotification(student._id, {
            type: 'certificate',
            title: 'Certificate issued',
            body: `Your certificate for "${course.title}" is ready to download.`,
            link: `/certificate/${certificate.certificateId}`,
          })
          console.log('[updateProgress] In-app notification created')
        }
      } catch (err) {
        // Log certificate issuance error but don't fail the progress update
        console.error('[updateProgress] Failed to auto-issue certificate:', err.message, err.stack)
      }
    }
  }

  // Return enrollment + certificate data for immediate frontend display
  const response = { ...enrollment.toJSON() }
  if (generatedCertificate) {
    response.certificate = generatedCertificate
  }
  res.json(response)
})
