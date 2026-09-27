import mongoose from 'mongoose'

/**
 * Lesson — a single lesson within a course.
 *
 * Each course has multiple lessons organised by module. Lessons are
 * independent documents (not embedded in Course) so instructors can
 * add/edit/delete them via the CMS without rewriting the entire Course doc.
 *
 * Types:
 *   - video      → has videoUrl (YouTube embed or direct MP4)
 *   - quiz       → has quizQuestions array
 *   - assignment → student uploads a file via POST /:id/attachment
 *   - notes      → has notes field (plain text or markdown)
 */
const quizQuestionSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctIndex: { type: Number, required: true },
  },
  { _id: false },
)

const lessonSchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    title: { type: String, required: true, trim: true },
    moduleTitle: { type: String, required: true }, // denormalized from syllabus for fast reads
    moduleIndex: { type: Number, required: true }, // for ordering within the course
    order: { type: Number, required: true },       // lesson position within its module (1-based)
    type: {
      type: String,
      enum: ['video', 'quiz', 'assignment', 'notes'],
      required: true,
    },
    videoUrl: { type: String, default: '' },        // YouTube embed URL or direct MP4 URL
    notes: { type: String, default: '' },           // plain text or markdown for notes-type lessons
    quizQuestions: [quizQuestionSchema],             // used when type is 'quiz'
    attachmentUrl: { type: String, default: '' },    // Cloudinary URL for downloadable PDF
    attachmentPublicId: { type: String, default: '' }, // for deletion
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
)

// Ordered fetching: GET /api/lessons?courseId=slug → sort by moduleIndex then order
lessonSchema.index({ course: 1, moduleIndex: 1, order: 1 })

export default mongoose.model('Lesson', lessonSchema)
