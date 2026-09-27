import crypto from 'node:crypto'
import Feedback from '../models/Feedback.js'
import Course from '../models/Course.js'
import User from '../models/User.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { createNotification } from '../utils/createNotification.js'

// Short human-readable display id, e.g. "FB-MZK3F9A1C2" — same "FB-" prefix
// the frontend mock generated, with a random suffix so concurrent submissions
// can never collide on Date.now() alone.
function generateFeedbackId() {
  return `FB-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`
}

// Notify every admin in-app about a new submission. Never throws — a
// notification failure must not fail the feedback submission.
async function notifyAdmins(feedback) {
  try {
    const admins = await User.find({ role: 'admin' }).select('_id')
    await Promise.all(
      admins.map((admin) =>
        createNotification(admin._id, {
          type: 'feedback',
          title: `New ${feedback.category} feedback — ${feedback.rating}/5`,
          body: `${feedback.name} (${feedback.email})${feedback.courseTitle ? ` on ${feedback.courseTitle}` : ''}: ${feedback.message.slice(0, 140)}`,
          link: '/admin',
        }),
      ),
    )
  } catch {
    // swallow — see createNotification: notifications never block the main operation
  }
}

// POST /api/feedback — public (the /feedback page is open to visitors)
export const submitFeedback = asyncHandler(async (req, res) => {
  const data = req.validatedBody || req.body

  // Best-effort course lookup — the client catalog may contain ids that
  // aren't in the database, and that must not reject the submission.
  let courseTitle = ''
  if (data.courseId) {
    const course = await Course.findBySlugOrId(data.courseId).catch(() => null)
    courseTitle = course?.title || ''
  }

  const feedback = await Feedback.create({
    ...data,
    feedbackId: generateFeedbackId(),
    courseTitle,
  })

  await notifyAdmins(feedback)

  res.status(201).json(feedback)
})

// GET /api/feedback — admin only (AdminFeedback panel)
export const getFeedback = asyncHandler(async (req, res) => {
  const feedback = await Feedback.find().sort({ createdAt: -1 })
  res.json(feedback)
})

// GET /api/feedback/stats — admin only
export const getFeedbackStats = asyncHandler(async (req, res) => {
  const [overall, byCategory] = await Promise.all([
    Feedback.aggregate([
      { $group: { _id: null, total: { $sum: 1 }, averageRating: { $avg: '$rating' } } },
    ]),
    Feedback.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          averageRating: { $avg: '$rating' },
        },
      },
      { $sort: { count: -1 } },
    ]),
  ])

  const round1 = (n) => Math.round(n * 10) / 10

  res.json({
    total: overall[0]?.total || 0,
    averageRating: overall[0] ? round1(overall[0].averageRating) : 0,
    byCategory: byCategory.map((c) => ({
      category: c._id,
      count: c.count,
      averageRating: round1(c.averageRating),
    })),
  })
})

// DELETE /api/feedback/:id — admin only (moderation: spam, abusive notes)
export const deleteFeedback = asyncHandler(async (req, res) => {
  const feedback = await Feedback.findByIdAndDelete(req.params.id)
  if (!feedback) throw new ApiError(404, 'Feedback not found')
  res.json({ message: 'Feedback deleted' })
})
