import LiveClass from '../models/LiveClass.js'
import Course from '../models/Course.js'
import Enrollment from '../models/Enrollment.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { createNotification } from '../utils/createNotification.js'

const STORE_FROM_API = { UPCOMING: 'scheduled', LIVE: 'live', ENDED: 'ended', CANCELLED: 'cancelled' }

async function resolveCourse(courseRef) {
  const course = await Course.findBySlugOrId(courseRef)
  if (!course) throw new ApiError(404, 'Course not found')
  return course
}

async function assertInstructorOrAdmin(user, course) {
  const isOwner = course.instructor && course.instructor.equals(user._id)
  if (user.role !== 'admin' && !isOwner) {
    throw new ApiError(403, 'You do not have permission to manage live sessions for this course')
  }
}

async function assertCanView(user, course) {
  if (user.role === 'admin') return 'admin'
  const isOwner = course.instructor && course.instructor.equals(user._id)
  if (isOwner || user.role === 'instructor') {
    // Instructors may only view sessions for courses they are assigned to.
    if (isOwner) return 'instructor'
    throw new ApiError(403, 'You are not assigned to this course')
  }
  const enrollment = await Enrollment.findOne({ student: user._id, course: course._id })
  if (!enrollment) throw new ApiError(403, 'You must be enrolled in this course to view live sessions')
  return 'student'
}

/** Derive public UPCOMING/LIVE/ENDED/CANCELLED status from stored doc + clock. */
export function deriveStatus(doc, now = new Date()) {
  if (doc.status === 'cancelled') return 'CANCELLED'
  if (doc.status === 'ended') return 'ENDED'
  const start = doc.scheduledStartAt || doc.startsAt
  const end = doc.scheduledEndAt || doc.endsAt
  if (end && now > new Date(end)) return 'ENDED'
  if (start && now >= new Date(start) && doc.status === 'live') return 'LIVE'
  if (start && now >= new Date(start) && (!end || now <= new Date(end))) return 'LIVE'
  return doc.status === 'live' ? 'LIVE' : 'UPCOMING'
}

async function autoExpire(doc, now = new Date()) {
  if (doc.status !== 'cancelled' && doc.status !== 'ended') {
    const end = doc.scheduledEndAt || doc.endsAt
    if (end && now > new Date(end)) {
      doc.status = 'ended'
      doc.endedAt = doc.endedAt || now
      await doc.save()
    }
  }
}

export function toLiveSessionJSON(doc, { includeMeetingUrl = false } = {}) {
  const obj = doc.toJSON ? doc.toJSON() : doc
  const start = obj.scheduledStartAt || obj.startsAt
  const end = obj.scheduledEndAt || obj.endsAt
  const out = {
    id: String(obj._id || obj.id),
    courseId: String(obj.course?._id || obj.course),
    instructorId: String(obj.instructor?._id || obj.instructor),
    title: obj.title,
    description: obj.description || '',
    meetingProvider: obj.meetingProvider || 'GOOGLE_MEET',
    scheduledStartAt: start ? new Date(start).toISOString() : null,
    scheduledEndAt: end ? new Date(end).toISOString() : null,
    status: deriveStatus(doc),
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  }
  if (includeMeetingUrl) out.meetingUrl = obj.meetingUrl || obj.streamUrl || ''
  return out
}

// POST /api/courses/:courseId/live-sessions — instructor (own course) / admin
export const createLiveSession = asyncHandler(async (req, res) => {
  const course = await resolveCourse(req.params.courseId)
  await assertInstructorOrAdmin(req.user, course)
  const data = req.validatedBody || req.body

  const start = new Date(data.scheduledStartAt)
  const end = data.scheduledEndAt ? new Date(data.scheduledEndAt) : new Date(start.getTime() + 60 * 60 * 1000)
  const durationMinutes = Math.max(1, Math.round((end - start) / 60000))

  const doc = await LiveClass.create({
    course: course._id,
    instructor: req.user._id,
    title: data.title,
    description: data.description || '',
    meetingProvider: data.meetingProvider || 'GOOGLE_MEET',
    meetingUrl: data.meetingUrl,
    streamUrl: data.meetingUrl,
    streamType: data.meetingProvider === 'ZOOM' ? 'zoom' : 'other',
    startsAt: start,
    scheduledStartAt: start,
    durationMinutes,
    endsAt: end,
    scheduledEndAt: end,
  })

  try {
    const enrollments = await Enrollment.find({ course: course._id })
    for (const e of enrollments) {
      await createNotification(e.student, {
        type: 'system',
        title: 'New live session scheduled',
        body: `"${doc.title}" for ${course.title} is scheduled.`,
        link: `/courses/${course.slug}`,
      })
    }
  } catch { /* non-blocking */ }

  res.status(201).json(toLiveSessionJSON(doc, { includeMeetingUrl: true }))
})

// GET /api/courses/:courseId/live-sessions — enrolled student / instructor / admin
export const listLiveSessions = asyncHandler(async (req, res) => {
  const course = await resolveCourse(req.params.courseId)
  await assertCanView(req.user, course)

  const docs = await LiveClass.find({ course: course._id }).sort({ scheduledStartAt: 1, startsAt: 1 })
  const now = new Date()
  for (const d of docs) await autoExpire(d, now)

  let filtered = docs
  if (req.query.scope === 'upcoming') filtered = docs.filter((d) => ['UPCOMING', 'LIVE'].includes(deriveStatus(d, now)))
  else if (req.query.scope === 'past') filtered = docs.filter((d) => ['ENDED', 'CANCELLED'].includes(deriveStatus(d, now)))

  res.json(filtered.map((d) => toLiveSessionJSON(d, { includeMeetingUrl: true })))
})

// GET /api/live-sessions/:id — authorized users only
export const getLiveSession = asyncHandler(async (req, res) => {
  const doc = await LiveClass.findById(req.params.id)
  if (!doc) throw new ApiError(404, 'Live session not found')
  const course = await Course.findById(doc.course)
  if (!course) throw new ApiError(404, 'Course not found')
  await assertCanView(req.user, course)
  await autoExpire(doc)
  res.json(toLiveSessionJSON(doc, { includeMeetingUrl: true }))
})

// PATCH /api/live-sessions/:id — instructor (own course) / admin
export const updateLiveSession = asyncHandler(async (req, res) => {
  const doc = await LiveClass.findById(req.params.id)
  if (!doc) throw new ApiError(404, 'Live session not found')
  const course = await Course.findById(doc.course)
  if (!course) throw new ApiError(404, 'Course not found')
  await assertInstructorOrAdmin(req.user, course)

  const data = req.validatedBody || req.body
  if (data.title !== undefined) doc.title = data.title
  if (data.description !== undefined) doc.description = data.description
  if (data.meetingProvider !== undefined) {
    doc.meetingProvider = data.meetingProvider
    doc.streamType = data.meetingProvider === 'ZOOM' ? 'zoom' : 'other'
  }
  if (data.meetingUrl !== undefined) {
    doc.meetingUrl = data.meetingUrl
    doc.streamUrl = data.meetingUrl
  }
  if (data.scheduledStartAt !== undefined) {
    const s = new Date(data.scheduledStartAt)
    doc.scheduledStartAt = s
    doc.startsAt = s
  }
  if (data.scheduledEndAt !== undefined) {
    const e = data.scheduledEndAt ? new Date(data.scheduledEndAt) : null
    doc.scheduledEndAt = e
    doc.endsAt = e
  }
  // Recompute duration when window changes
  const s = doc.scheduledStartAt || doc.startsAt
  const e = doc.scheduledEndAt || doc.endsAt
  if (s && e) doc.durationMinutes = Math.max(1, Math.round((new Date(e) - new Date(s)) / 60000))
  if (data.status !== undefined) {
    doc.status = STORE_FROM_API[data.status]
    if (data.status === 'CANCELLED') doc.endedAt = doc.endedAt || new Date()
    if (data.status === 'ENDED') doc.endedAt = new Date()
  }
  await doc.save()
  res.json(toLiveSessionJSON(doc, { includeMeetingUrl: true }))
})

// DELETE /api/live-sessions/:id — instructor (own course) / admin (hard delete)
export const deleteLiveSession = asyncHandler(async (req, res) => {
  const doc = await LiveClass.findById(req.params.id)
  if (!doc) throw new ApiError(404, 'Live session not found')
  const course = await Course.findById(doc.course)
  if (!course) throw new ApiError(404, 'Course not found')
  await assertInstructorOrAdmin(req.user, course)
  await LiveClass.findByIdAndDelete(doc._id)
  res.json({ message: 'Live session deleted' })
})

// POST /api/live-sessions/:id/join — enrolled student (also owner instructor/admin).
// Returns { redirectUrl } so the client always uses the current link.
export const joinLiveSession = asyncHandler(async (req, res) => {
  const doc = await LiveClass.findById(req.params.id)
  if (!doc) throw new ApiError(404, 'Live session not found')
  await autoExpire(doc)
  const status = deriveStatus(doc)
  if (status === 'ENDED') throw new ApiError(400, 'This live session has ended')
  if (status === 'CANCELLED') throw new ApiError(400, 'This live session was cancelled')

  const course = await Course.findById(doc.course)
  if (!course) throw new ApiError(404, 'Course not found')

  const isOwner = course.instructor && course.instructor.equals(req.user._id)
  if (req.user.role !== 'admin' && !isOwner) {
    const enrollment = await Enrollment.findOne({ student: req.user._id, course: course._id })
    if (!enrollment) throw new ApiError(403, 'You must be enrolled in this course to join this live session')
  }

  const meetingUrl = doc.meetingUrl || doc.streamUrl
  if (!meetingUrl) throw new ApiError(400, 'Live session link is not available yet')

  // Track attendance idempotently (best-effort).
  try {
    const existing = doc.attendees.find((a) => a.user.equals(req.user._id))
    if (!existing) {
      doc.attendees.push({ user: req.user._id, name: req.user.name || '', joinedAt: new Date() })
      await doc.save()
    }
  } catch { /* non-blocking */ }

  res.json({ redirectUrl: meetingUrl })
})
