import { z } from 'zod'

export const signupSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
})

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const verifyOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

export const resendOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
})

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').optional(),
  email: z.string().email('Invalid email address').optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters')
    .regex(/[A-Z]/, 'New password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'New password must contain at least one number')
    .optional(),
}).refine(
  (data) => !data.newPassword || data.currentPassword,
  { message: 'currentPassword is required to change password', path: ['currentPassword'] },
)

export const createCourseSchema = z.object({
  slug: z.string().trim().min(3, 'Slug must be at least 3 characters'),
  code: z.string().trim().min(2, 'Code is required'),
  title: z.string().trim().min(3, 'Title is required'),
  category: z.string().trim().min(1, 'Category is required'),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced']),
  duration: z.string().trim().min(1, 'Duration is required'),
  lessons: z.number().int().min(1, 'Lessons count is required'),
  price: z.number().min(0, 'Price must be 0 or greater'),
  originalPrice: z.number().min(0).optional(),
  summary: z.string().trim().min(10, 'Summary must be at least 10 characters'),
  outcomes: z.array(z.string()).optional(),
  syllabus: z.array(z.object({
    title: z.string(),
    lessons: z.number().int().min(0),
  })).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  instructorName: z.string().trim().optional(),
})

export const updateCourseSchema = createCourseSchema.partial().omit({ slug: true, code: true })

export const createOrderSchema = z.object({
  courseId: z.string().trim().min(1, 'courseId is required'),
  couponCode: z.string().trim().optional(),
})

export const verifyPaymentSchema = z.object({
  orderId: z.string().trim().min(1, 'orderId is required'),
  razorpayOrderId: z.string().trim().min(1, 'razorpayOrderId is required'),
  razorpayPaymentId: z.string().trim().min(1, 'razorpayPaymentId is required'),
  razorpaySignature: z.string().trim().min(1, 'razorpaySignature is required'),
})

export const enrollInCourseSchema = z.object({
  courseId: z.string().trim().min(1, 'courseId is required'),
  // orderId is optional — free courses (price === 0) enroll without a payment order.
  // The controller enforces orderId requirement for paid courses.
  orderId: z.string().trim().min(1, 'orderId is required').optional(),
})

export const updateProgressSchema = z.object({
  progress: z.number().min(0).max(100),
})

export const applyCouponSchema = z.object({
  code: z.string().trim().min(1, 'code is required'),
  courseId: z.string().trim().min(1, 'courseId is required'),
})

export const createCouponSchema = z.object({
  code: z.string().trim().min(2, 'Code must be at least 2 characters'),
  type: z.enum(['percentage', 'flat']),
  value: z.number().min(1, 'Value must be at least 1'),
  label: z.string().trim().min(1, 'Label is required'),
  active: z.boolean().optional(),
  expiresAt: z.string().optional().nullable(),
}).refine(
  (data) => data.type !== 'percentage' || data.value <= 100,
  { message: 'Percentage value cannot exceed 100', path: ['value'] },
)

export const issueCertificateSchema = z.object({
  courseId: z.string().trim().min(1, 'courseId is required'),
})

export const lessonSchema = z.object({
  course: z.string().trim().min(1, 'course (courseId) is required'),
  title: z.string().trim().min(2, 'Title must be at least 2 characters'),
  moduleTitle: z.string().trim().min(1, 'moduleTitle is required'),
  moduleIndex: z.number().int().min(0, 'moduleIndex must be a non-negative integer'),
  order: z.number().int().min(1, 'order must be a positive integer (1-based)'),
  type: z.enum(['video', 'quiz', 'assignment', 'notes']),
  videoUrl: z.string().trim().optional(),
  notes: z.string().optional(),
  quizQuestions: z.array(z.object({
    question: z.string().min(1, 'question is required'),
    options: z.array(z.string().min(1)).min(2, 'at least 2 options required'),
    correctIndex: z.number().int().min(0),
  })).optional(),
  published: z.boolean().optional(),
})

export const liveClassSchema = z.object({
  course: z.string().trim().min(1, 'course (courseId) is required'),
  title: z.string().trim().min(2, 'Title must be at least 2 characters'),
  description: z.string().trim().optional(),
  startsAt: z.union([z.string(), z.date()]).refine((v) => !Number.isNaN(new Date(v).getTime()), 'startsAt must be a valid date'),
  durationMinutes: z.number().int().min(1, 'durationMinutes must be at least 1').optional(),
  streamUrl: z.string().trim().url('streamUrl must be a valid URL').optional().or(z.literal('')),
  streamType: z.enum(['youtube', 'jitsi', 'zoom', 'hls', 'other']).optional(),
  maxAttendees: z.number().int().min(0).optional(),
  recordingUrl: z.string().trim().url('recordingUrl must be a valid URL').optional().or(z.literal('')),
  status: z.enum(['scheduled', 'live', 'ended', 'cancelled']).optional(),
})

export const updateLiveClassSchema = liveClassSchema.partial().omit({ course: true })

// ── LiveSession contract (Google Meet first) ─────────────────────────────
// meetingUrl is required; GOOGLE_MEET provider enforces meet.google.com shape.
export const GOOGLE_MEET_RE = /^https:\/\/meet\.google\.com\/[a-z]{3,}-[a-z]{4,}-[a-z]{3,}(\?.*)?$/

const meetingUrlField = z.string().trim().url('meetingUrl must be a valid URL').max(2048)

export const liveSessionSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().trim().max(5000).optional().default(''),
  meetingProvider: z.enum(['GOOGLE_MEET', 'ZOOM', 'OTHER']).optional().default('GOOGLE_MEET'),
  meetingUrl: meetingUrlField,
  scheduledStartAt: z.union([z.string(), z.date()]).refine((v) => !Number.isNaN(new Date(v).getTime()), 'scheduledStartAt must be a valid date'),
  scheduledEndAt: z.union([z.string(), z.date()]).optional().refine((v) => v === undefined || !Number.isNaN(new Date(v).getTime()), 'scheduledEndAt must be a valid date'),
}).superRefine((data, ctx) => {
  if (data.meetingProvider === 'GOOGLE_MEET' && !GOOGLE_MEET_RE.test(data.meetingUrl)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['meetingUrl'], message: 'Google Meet link must look like https://meet.google.com/xxx-xxxx-xxx' })
  }
  if (data.scheduledEndAt !== undefined) {
    const start = new Date(data.scheduledStartAt).getTime()
    const end = new Date(data.scheduledEndAt).getTime()
    if (end <= start) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledEndAt'], message: 'scheduledEndAt must be after scheduledStartAt' })
    }
  }
})

export const updateLiveSessionSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  meetingProvider: z.enum(['GOOGLE_MEET', 'ZOOM', 'OTHER']).optional(),
  meetingUrl: meetingUrlField.optional(),
  scheduledStartAt: z.union([z.string(), z.date()]).refine((v) => !Number.isNaN(new Date(v).getTime()), 'scheduledStartAt must be a valid date').optional(),
  scheduledEndAt: z.union([z.string(), z.date()]).refine((v) => !Number.isNaN(new Date(v).getTime()), 'scheduledEndAt must be a valid date').optional().nullable(),
  status: z.enum(['UPCOMING', 'LIVE', 'ENDED', 'CANCELLED']).optional(),
}).superRefine((data, ctx) => {
  if (data.meetingProvider === 'GOOGLE_MEET' && data.meetingUrl !== undefined && !GOOGLE_MEET_RE.test(data.meetingUrl)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['meetingUrl'], message: 'Google Meet link must look like https://meet.google.com/xxx-xxxx-xxx' })
  }
})

export const refundSchema = z.object({
  amount: z.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional(),
})

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  message: z.string().trim().min(10, 'Message must be at least 10 characters').max(5000, 'Message is too long'),
})

// Mirrors the /feedback form (src/services/feedbackService.js). ROLES and
// CATEGORIES must stay in sync with the frontend constants.
export const submitFeedbackSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  role: z.enum(['Student', 'Instructor', 'Visitor']),
  // The form sends '' for "Not course-specific" — normalize to null like the mock service does.
  courseId: z.string().trim().optional().nullable().transform((v) => v || null),
  rating: z.number().int().min(1, 'Rating must be between 1 and 5').max(5, 'Rating must be between 1 and 5'),
  category: z.enum(['General', 'Course Feedback', 'Suggestion', 'Bug Report', 'Mentor / Support']),
  message: z.string().trim().min(5, 'Message must be at least 5 characters').max(5000, 'Message is too long'),
})

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const errors = result.error.issues.map((i) => i.message)
      return res.status(400).json({ message: errors.join(', ') })
    }
    req.validatedBody = result.data
    next()
  }
}
