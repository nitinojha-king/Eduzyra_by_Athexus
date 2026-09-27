import Certificate from '../models/Certificate.js'
import Course from '../models/Course.js'
import Enrollment from '../models/Enrollment.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { sendCertificateEmail } from '../services/emailService.js'
import { createNotification } from '../utils/createNotification.js'

// POST /api/certificates  { courseId }
// Mirrors services/certificateService.js -> issueCertificate(). Requires the
// student to have completed the course (progress 100) so certificates can't
// be minted for courses never finished.
export const issueCertificate = asyncHandler(async (req, res) => {
  const { courseId } = req.validatedBody || req.body
  if (!courseId) throw new ApiError(400, 'courseId is required')

  const course = await Course.findBySlugOrId(courseId)
  if (!course) throw new ApiError(404, 'Course not found')

  const enrollment = await Enrollment.findOne({ student: req.user._id, course: course._id })
  if (!enrollment || enrollment.progress < 100) {
    throw new ApiError(400, 'Course must be completed before a certificate can be issued')
  }

  const existing = await Certificate.findOne({ student: req.user._id, course: course._id })
  if (existing) return res.json(existing)

  // Generate certificate ID with retry on duplicate-key collision.
  // The countDocuments + 1 approach is racy under concurrent requests;
  // we catch the 11000 duplicate error and retry with an incremented sequence.
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
        student: req.user._id,
        studentName: req.user.name,
        course: course._id,
        courseTitle: course.title,
        issuedOn: new Date().toISOString().slice(0, 10),
      })
      break // success
    } catch (err) {
      // If duplicate key error and we have retries left, loop again
      if (err.code === 11000 && attempt < MAX_RETRIES - 1) {
        continue
      }
      throw err
    }
  }

  if (!certificate) {
    throw new ApiError(500, 'Failed to generate certificate ID after retries')
  }

  // Send certificate email — non-blocking. A failed email must not fail
  // the certificate issuance response.
  const certificateUrl = `${process.env.CLIENT_ORIGIN}/certificate/${certificate.certificateId}`
  const emailSent = await sendCertificateEmail({
    name: req.user.name,
    email: req.user.email,
    courseTitle: course.title,
    certificateUrl,
    certificateId: certificate.certificateId,
  })

  if (!emailSent) {
    console.warn('[issueCertificate] Certificate email delivery failed. Check SMTP configuration or review server logs for dev fallback information.')
  }

  // Create in-app notification (fire-and-forget)
  await createNotification(req.user._id, {
    type: 'certificate',
    title: 'Certificate issued',
    body: `Your certificate for "${course.title}" is ready to download.`,
    link: `/certificate/${certificate.certificateId}`,
  })

  res.status(201).json(certificate)
})

// GET /api/certificates/:id  (public — matches VerifyCertificate.jsx / Certificate.jsx)
export const verifyCertificate = asyncHandler(async (req, res) => {
  const certificate = await Certificate.findOne({
    certificateId: req.params.id.trim().toUpperCase(),
  })
  res.json(certificate || null)
})

// GET /api/certificates/me — protected, returns all certificates for the
// logged-in user. Used by the student dashboard to show "Get Certificate"
// links for completed courses.
export const getMyCertificates = asyncHandler(async (req, res) => {
  const certificates = await Certificate.find({ student: req.user._id })
    .sort({ createdAt: -1 })
    .populate('course')
  res.json(certificates)
})

// GET /api/certificates/admin/all — admin only, paginated list of all certificates
export const getAllCertificates = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
  const skip = (page - 1) * limit

  const [certificates, total] = await Promise.all([
    Certificate.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Certificate.countDocuments({}),
  ])

  res.json({
    certificates,
    total,
    page,
    pages: Math.ceil(total / limit),
  })
})
