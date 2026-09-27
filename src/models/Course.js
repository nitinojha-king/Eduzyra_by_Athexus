import mongoose from 'mongoose'

const syllabusItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    lessons: { type: Number, required: true },
  },
  { _id: false },
)

const courseSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true }, // matches frontend course.id (e.g. "react-professional")
    code: { type: String, required: true, unique: true }, // e.g. "EDU-104"
    title: { type: String, required: true },
    category: { type: String, required: true },
    level: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], required: true },
    instructor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    instructorName: { type: String, required: true }, // denormalized for quick reads / seed data without a linked user
    duration: { type: String, required: true },
    lessons: { type: Number, required: true },
    rating: { type: Number, default: 0 },
    students: { type: Number, default: 0 },
    price: { type: Number, required: true },
    originalPrice: { type: Number },
    summary: { type: String, required: true },
    outcomes: [{ type: String }],
    syllabus: [syllabusItemSchema],
    // ── Status (Phase 3) ───────────────────────────────────────────────────
    // Replaces the old `published: Boolean` field. Existing code that reads
    // `course.published` continues to work via the virtual below.
    status: {
      type: String,
      enum: {
        values: ['draft', 'published', 'archived'],
        message: 'Status must be one of: draft, published, archived',
      },
      default: 'published',
      index: true,
    },
    // ── Cloudinary thumbnail ───────────────────────────────────────────────
    thumbnail: { type: String, default: '' },           // Cloudinary secure URL
    thumbnailPublicId: { type: String, default: '' },   // For deletion on replace
  },
  { timestamps: true },
)

courseSchema.index({ title: 'text', instructorName: 'text', category: 'text' })

// ── Virtuals ──────────────────────────────────────────────────────────────
// `id` returns the slug (preferred canonical identifier), falling back to
// the hex `_id` string for courses inserted without a slug field.
courseSchema.virtual('id').get(function () {
  return this.slug || this._id?.toString?.() || this._id
})

// Backward-compatibility virtual: `course.published` returns true when
// status === 'published'. This keeps existing queries (e.g., filter
// { published: true }) working — they should be migrated to use `status`
// in a future refactor, but for now this virtual prevents regressions.
courseSchema.virtual('published').get(function () {
  return this.status === 'published'
})

courseSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    ret.instructor = doc.instructorName
    return ret
  },
})
courseSchema.set('toObject', { virtuals: true })

// Matches 24-character hex ObjectId strings (MongoDB default _id format)
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/

/**
 * findBySlugOrId — dual lookup that supports both:
 *   a) canonical slugs (e.g. "react-professional"), and
 *   b) 24-char hex ObjectId strings.
 *
 * Always tries slug first (unique index, fast), then falls back to _id.
 * Accepts optional extra query keys (`fields`, `populate`, etc.) via `options`.
 *
 * @param {string} slugOrId — slug or ObjectId hex string from client
 * @param {object} [extraQuery] — additional query criteria merged into the match
 * @returns {Promise<object|null>} course doc or null
 */
courseSchema.statics.findBySlugOrId = async function findBySlugOrId(slugOrId, extraQuery = {}) {
  if (!slugOrId) return null
  const bySlug = await this.findOne({ slug: slugOrId, ...extraQuery })
  if (bySlug) return bySlug
  if (OBJECT_ID_RE.test(String(slugOrId))) {
    return this.findOne({ _id: slugOrId, ...extraQuery })
  }
  return null
}

export default mongoose.model('Course', courseSchema)
