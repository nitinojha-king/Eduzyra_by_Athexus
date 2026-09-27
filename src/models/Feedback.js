import mongoose from 'mongoose'

/**
 * Feedback — submissions from the public /feedback page.
 *
 * Shape mirrors the frontend contract in
 * eduzyra-althexus/src/services/feedbackService.js:
 *   { name, email, role, courseId, rating, category, message }
 * plus `feedbackId`, a short human-readable display id ("FB-…") shown in the
 * admin panel. JSON responses expose `id` (the feedbackId) and `submittedAt`
 * (createdAt) so the frontend can swap its mock service for real API calls
 * without changing a single component.
 *
 * courseId is stored exactly as the client sends it (course slug or ObjectId
 * string) — it is NOT a ref, because the feedback form is open to visitors
 * and the client catalog may contain ids that aren't in the database.
 * courseTitle is denormalized at submit time (best effort) so admin lists
 * don't need a join.
 */
const FEEDBACK_ROLES = ['Student', 'Instructor', 'Visitor']
const FEEDBACK_CATEGORIES = ['General', 'Course Feedback', 'Suggestion', 'Bug Report', 'Mentor / Support']

const feedbackSchema = new mongoose.Schema(
  {
    feedbackId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: FEEDBACK_ROLES, default: 'Student' },
    courseId: { type: String, default: null },
    courseTitle: { type: String, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    category: { type: String, enum: FEEDBACK_CATEGORIES, default: 'General' },
    message: { type: String, required: true, trim: true },
  },
  { timestamps: true },
)

feedbackSchema.index({ createdAt: -1 })
feedbackSchema.index({ category: 1, createdAt: -1 })

feedbackSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret.feedbackId
    ret.submittedAt = ret.createdAt
    return ret
  },
})

export default mongoose.model('Feedback', feedbackSchema)
