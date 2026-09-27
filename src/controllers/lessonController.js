import Lesson from '../models/Lesson.js'
import Course from '../models/Course.js'
import Enrollment from '../models/Enrollment.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'

// Rate limiter for the /answer endpoint — prevents brute-forcing correct answers
const answerLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { message: 'Too many answer checks. Please slow down.' },
})

/**
 * Strip correctIndex from quizQuestions for client-facing responses.
 * The correct answer must never be sent to the browser on list or single-lesson fetches.
 */
function stripCorrectAnswers(lesson) {
  if (!lesson) return lesson
  const obj = lesson.toObject ? lesson.toObject() : lesson
  if (obj.quizQuestions) {
    obj.quizQuestions = obj.quizQuestions.map((q) => ({
      question: q.question,
      options: q.options,
    }))
  }
  return obj
}

// GET /api/lessons?courseId=:slugOrId — public list returns ONLY metadata (title, type, moduleTitle, moduleIndex, order)
// Full content (videoUrl, notes, attachmentUrl, quizQuestions) requires enrollment via GET /:id
export const getLessonsByCourse = asyncHandler(async (req, res) => {
  const { courseId } = req.query
  if (!courseId) throw new ApiError(400, 'courseId query param is required')

  const course = await Course.findBySlugOrId(courseId)
  if (!course) throw new ApiError(404, 'Course not found')

  // Check optional authorization to see if the user is the instructor or an admin
  const header = req.headers.authorization
  let isInstructorOrAdmin = false
  if (header?.startsWith('Bearer ')) {
    const token = header.split(' ')[1]
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const user = await User.findById(decoded.id)
      if (user && (user.role === 'admin' || course.instructor?.equals(user._id))) {
        isInstructorOrAdmin = true
      }
    } catch (e) {
      // Ignore token errors and treat as public/student user
    }
  }

  let lessons
  if (isInstructorOrAdmin) {
    // Instructor/admin sees draft/unpublished lessons and full content
    lessons = await Lesson.find({ course: course._id })
      .sort({ moduleIndex: 1, order: 1 })
      .lean()
  } else {
    // Public/student sees only published metadata
    lessons = await Lesson.find({ course: course._id, published: true })
      .sort({ moduleIndex: 1, order: 1 })
      .select('title moduleTitle moduleIndex order type') // ONLY metadata — no videoUrl, notes, attachmentUrl, quizQuestions
      .lean()
  }

  res.json(lessons)
})

// GET /api/lessons/:id — protected (enrolled students only)
// Returns single lesson including quizQuestions without correctIndex.
export const getLessonById = asyncHandler(async (req, res) => {
  const lesson = await Lesson.findById(req.params.id)
  if (!lesson) throw new ApiError(404, 'Lesson not found')
  if (!lesson.published) throw new ApiError(404, 'Lesson not found')

  // Verify the requesting user is enrolled in the lesson's course
  const enrollment = await Enrollment.findOne({ student: req.user._id, course: lesson.course })
  if (!enrollment) {
    // Allow instructors/admins to preview
    const course = await Course.findById(lesson.course)
    const isOwner = course?.instructor?.equals(req.user._id)
    if (req.user.role !== 'admin' && !isOwner) {
      throw new ApiError(403, 'You must be enrolled in this course to view lessons')
    }
  }

  res.json(stripCorrectAnswers(lesson))
})

// GET /api/lessons/:id/answer?questionIndex=N — protected (enrolled only)
// Returns { correctIndex } for a single quiz question.
// Rate-limited to prevent brute-forcing.
export const checkAnswer = [
  answerLimiter,
  asyncHandler(async (req, res) => {
    const lesson = await Lesson.findById(req.params.id)
    if (!lesson) throw new ApiError(404, 'Lesson not found')

    // Verify enrollment
    const enrollment = await Enrollment.findOne({ student: req.user._id, course: lesson.course })
    if (!enrollment) {
      throw new ApiError(403, 'You must be enrolled to check answers')
    }

    const { questionIndex } = req.query
    const idx = parseInt(questionIndex, 10)
    if (Number.isNaN(idx) || idx < 0 || idx >= lesson.quizQuestions.length) {
      throw new ApiError(400, 'Invalid questionIndex')
    }

    res.json({ correctIndex: lesson.quizQuestions[idx].correctIndex })
  }),
]

// POST /api/lessons — protected, instructor/admin only
export const createLesson = asyncHandler(async (req, res) => {
  const data = req.validatedBody || req.body

  // Resolve course from slug or ObjectId → ObjectId
  const course = await Course.findBySlugOrId(data.course)
  if (!course) throw new ApiError(404, 'Course not found')

  // Ownership check
  const isOwner = course.instructor?.equals(req.user._id)
  if (req.user.role !== 'admin' && !isOwner) {
    throw new ApiError(403, 'You do not have permission to add lessons to this course')
  }

  const lesson = await Lesson.create({
    ...data,
    course: course._id,
  })

  res.status(201).json(lesson)
})

// PUT /api/lessons/:id — protected, instructor who owns the course or admin only
export const updateLesson = asyncHandler(async (req, res) => {
  const lesson = await Lesson.findById(req.params.id)
  if (!lesson) throw new ApiError(404, 'Lesson not found')

  const course = await Course.findById(lesson.course)
  const isOwner = course?.instructor?.equals(req.user._id)
  if (req.user.role !== 'admin' && !isOwner) {
    throw new ApiError(403, 'You do not have permission to edit this lesson')
  }

  const data = req.validatedBody || req.body
  const safeFields = ['title', 'moduleTitle', 'moduleIndex', 'order', 'type', 'videoUrl', 'notes', 'quizQuestions', 'published']
  for (const field of safeFields) {
    if (data[field] !== undefined) lesson[field] = data[field]
  }
  await lesson.save()
  res.json(lesson)
})

// DELETE /api/lessons/:id — protected, admin only
export const deleteLesson = asyncHandler(async (req, res) => {
  const lesson = await Lesson.findByIdAndDelete(req.params.id)
  if (!lesson) throw new ApiError(404, 'Lesson not found')

  // Delete attachment from Cloudinary if it exists
  if (lesson.attachmentPublicId) {
    try {
      const { deleteFromCloudinary } = await import('../config/cloudinary.js')
      await deleteFromCloudinary(lesson.attachmentPublicId)
    } catch (err) {
      console.error('[deleteLesson] Failed to delete attachment:', err?.message || err)
    }
  }

  res.json({ message: 'Lesson deleted' })
})

// POST /api/lessons/:id/attachment — protected, instructor/admin
// Uses pdfUpload middleware, uploads to Cloudinary folder eduzyra/attachments
export const uploadAttachment = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'No file uploaded. Field name must be "file".')
  }

  const lesson = await Lesson.findById(req.params.id)
  if (!lesson) throw new ApiError(404, 'Lesson not found')

  // Ownership check
  const course = await Course.findById(lesson.course)
  const isOwner = course?.instructor?.equals(req.user._id)
  if (req.user.role !== 'admin' && !isOwner) {
    throw new ApiError(403, 'You do not have permission to edit this lesson')
  }

  const { uploadToCloudinary, deleteFromCloudinary } = await import('../config/cloudinary.js')

  // Delete old attachment if it exists
  if (lesson.attachmentPublicId) {
    await deleteFromCloudinary(lesson.attachmentPublicId)
  }

  const result = await uploadToCloudinary(req.file.buffer, {
    folder: 'eduzyra/attachments',
    resource_type: 'raw', // PDFs use 'raw' in Cloudinary
  })

  lesson.attachmentUrl = result.secure_url
  lesson.attachmentPublicId = result.public_id
  await lesson.save()

  res.json({ attachmentUrl: lesson.attachmentUrl })
})

// POST /api/lessons/:id/submit — protected (enrolled students only)
// Student submits a file for an assignment-type lesson. Uploads to Cloudinary
// folder eduzyra/submissions. Does NOT modify the lesson — the submission is
// a standalone upload that returns a URL the student can reference.
export const submitAssignment = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'No file uploaded. Field name must be "file".')
  }

  const lesson = await Lesson.findById(req.params.id)
  if (!lesson) throw new ApiError(404, 'Lesson not found')

  // Verify enrollment
  const enrollment = await Enrollment.findOne({ student: req.user._id, course: lesson.course })
  if (!enrollment) {
    throw new ApiError(403, 'You must be enrolled in this course to submit assignments')
  }

  const { uploadToCloudinary } = await import('../config/cloudinary.js')

  const result = await uploadToCloudinary(req.file.buffer, {
    folder: 'eduzyra/submissions',
    resource_type: 'raw',
  })

  res.json({ submissionUrl: result.secure_url })
})
