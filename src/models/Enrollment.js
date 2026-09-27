import mongoose from 'mongoose'

const enrollmentSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    progress: { type: Number, default: 0 }, // percent complete, 0-100
    completedAt: { type: Date },
  },
  { timestamps: true },
)

enrollmentSchema.index({ student: 1, course: 1 }, { unique: true })

// ── Phase 11: Performance indexes ─────────────────────────────────────────
// Speed up queries that filter by student + completion status (dashboard)
enrollmentSchema.index({ student: 1, completedAt: 1 })
// Speed up queries that filter by course (admin / instructor analytics)
enrollmentSchema.index({ course: 1 })

enrollmentSchema.virtual('id').get(function () {
  return String(this._id)
})

enrollmentSchema.set('toJSON', { virtuals: true })
enrollmentSchema.set('toObject', { virtuals: true })

export default mongoose.model('Enrollment', enrollmentSchema)
