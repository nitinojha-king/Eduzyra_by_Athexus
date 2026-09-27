import LiveClass from '../models/LiveClass.js'
import Course from '../models/Course.js'
import Enrollment from '../models/Enrollment.js'
import User from '../models/User.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { createNotification } from '../utils/createNotification.js'

// Safe fields for updates — mirrors how lessonController restricts what callers can mutate.
const SAFE_UPDATE_FIELDS = ['title', 'description', 'startsAt', 'durationMinutes', 'streamUrl', 'streamType', 'maxAttendees', 'recordingUrl', 'status']

/**
 * Resolve a course from a slug or ObjectId and return the ObjectId.
 */
async function resolveCourseId(courseRef) {
  const course = await Course.findBySlugOrId(courseRef)
  if (!course) throw new ApiError(404, 'Course not found')
  return course._id
}

/**
 * Verify the requesting user is the course's instructor (or an admin).
 */
async function assertInstructorOrAdmin(user, courseId) {
  const course = await Course.findById(courseId)
  if (!course) throw new ApiError(404, 'Course not found')
  const isOwner = course.instructor?.equals(user._id)
  if (user.role !== 'admin' && !isOwner) {
    throw new ApiError(403, 'You do not have permission to manage live classes for this course')
  }
  return course
}

function withInstructorName(liveClass) {
  const obj = liveClass.toJSON ? liveClass.toJSON() : liveClass
  return obj
}

// Never leak join links / rosters to unauthorized callers on legacy routes.
// The LiveSession API (/api/live-sessions) is the authorized channel.
function stripSensitive(obj) {
  const { streamUrl, meetingUrl, recordingUrl, attendees, ...rest } = obj
  return { ...rest, attendees: undefined, attendeeCount: undefined }
}

// Auto-end any "live" class whose scheduled window has passed, finalizing the
// attendee durations. Keeps the persisted status in sync with the frontend's
// resolveLiveStatus (which already treats an expired window as "live").
async function autoExpire(liveClass, now = new Date()) {
  if (
    liveClass.status === 'live' &&
    liveClass.endsAt &&
    now > new Date(liveClass.endsAt)
  ) {
    liveClass.status = 'ended'
    liveClass.endedAt = liveClass.endedAt || now
    liveClass.attendees = liveClass.attendees.map((a) => {
      if (!a.leftAt && a.joinedAt) {
        a.leftAt = now
        a.durationSeconds = Math.max(0, Math.round((now - a.joinedAt) / 1000))
      }
      return a
    })
    await liveClass.save()
  }
}

// GET /api/live-classes?course=:slug&scope=upcoming|all
// Public — lists live classes for a course (used by the course detail/LMS pages).
// `scope=all` (instructor/admin only) returns every class including ended/cancelled.
export const listLiveClasses = asyncHandler(async (req, res) => {
  const { course } = req.query
  if (!course) throw new ApiError(400, 'course query param is required')

  const courseId = await resolveCourseId(course)

  const query = { course: courseId }
  if (req.query.scope === 'all') {
    // Only the instructor/admin can see non-upcoming classes.
    const isOwnerOrAdmin = req.user && (req.user.role === 'admin' || (await Course.findById(courseId))?.instructor?.equals(req.user._id))
    if (!isOwnerOrAdmin) throw new ApiError(403, 'Not authorized to view all live classes')
    // nothing to restrict — return everything
  } else {
    query.status = { $in: ['scheduled', 'live'] }
  }

  const classes = await LiveClass.find(query)
    .sort({ startsAt: 1 })
    .populate('instructor', 'name email')
    .populate('course', 'title code')

  // Persist any class whose live window has already passed (instructor may not
  // have clicked "End").
  const now = new Date()
  for (const lc of classes) {
    await autoExpire(lc, now)
  }

  res.json(classes.map((c) => {
    const full = withInstructorName(c)
    // scope=all is already restricted to owner/admin above — keep links there.
    if (req.query.scope === 'all') return full
    return stripSensitive(full)
  }))
})

// GET /api/live-classes/:id — Protected. Returns one class with roster.
export const getLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id)
    .populate('instructor', 'name email')
    .populate('course', 'title code')
  if (!liveClass) throw new ApiError(404, 'Live class not found')
  await autoExpire(liveClass)
  const full = withInstructorName(liveClass)
  // Only enrolled students, the course instructor, or admin may see join links.
  const course = await Course.findById(liveClass.course?._id || liveClass.course)
  const isOwner = course?.instructor?.equals(req.user._id)
  const enrollment = await Enrollment.findOne({ student: req.user._id, course: liveClass.course })
  if (req.user.role !== 'admin' && !isOwner && !enrollment) {
    return res.json(stripSensitive(full))
  }
  res.json(full)
})

// POST /api/live-classes  { course, title, description?, startsAt, durationMinutes, streamUrl?, streamType?, maxAttendees? }
// Protected — course instructor or admin only.
export const createLiveClass = asyncHandler(async (req, res) => {
  const data = req.validatedBody || req.body

  const courseId = await resolveCourseId(data.course)
  await assertInstructorOrAdmin(req.user, courseId)

  const liveClass = await LiveClass.create({
    course: courseId,
    instructor: req.user._id,
    title: data.title,
    description: data.description || '',
    startsAt: new Date(data.startsAt),
    durationMinutes: data.durationMinutes || 60,
    streamUrl: data.streamUrl || '',
    streamType: data.streamType || 'youtube',
    maxAttendees: data.maxAttendees || 0,
    endsAt: new Date(new Date(data.startsAt).getTime() + (data.durationMinutes || 60) * 60 * 1000),
  })

  const populated = await LiveClass.populate(liveClass, [
    { path: 'instructor', select: 'name email' },
    { path: 'course', select: 'title code' },
  ])

  // Notify all enrolled students about the new lecture.
  try {
    const enrollments = await Enrollment.find({ course: courseId })
    const course = await Course.findById(courseId)
    const link = `/live-classes?course=${courseId}`
    for (const e of enrollments) {
      await createNotification(e.student, {
        type: 'system',
        title: 'New live lecture scheduled',
        body: `"${liveClass.title}" for ${course?.title || 'your course'} is scheduled.`,
        link,
      })
    }
  } catch (err) {
    // never block the create on notification failures
  }

  res.status(201).json(withInstructorName(populated))
})

// PUT /api/live-classes/:id  — Protected, course instructor or admin only.
export const updateLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id)
  if (!liveClass) throw new ApiError(404, 'Live class not found')

  await assertInstructorOrAdmin(req.user, liveClass.course)

  const data = req.validatedBody || req.body
  for (const field of SAFE_UPDATE_FIELDS) {
    if (data[field] !== undefined) liveClass[field] = data[field]
  }

  // Recompute endsAt whenever startsAt or durationMinutes changes.
  if (data.startsAt !== undefined || data.durationMinutes !== undefined) {
    const base = data.startsAt ? new Date(data.startsAt) : liveClass.startsAt
    const durMin = data.durationMinutes !== undefined ? data.durationMinutes : liveClass.durationMinutes
    liveClass.endsAt = new Date(base.getTime() + durMin * 60 * 1000)
  }

  await liveClass.save()
  const populated = await LiveClass.populate(liveClass, [
    { path: 'instructor', select: 'name email' },
    { path: 'course', select: 'title code' },
  ])
  res.json(withInstructorName(populated))
})

// PATCH /api/live-classes/:id/start — Protected, instructor/admin only.
// Transitions a scheduled class to live and records when it started.
export const startLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id)
  if (!liveClass) throw new ApiError(404, 'Live class not found')

  await assertInstructorOrAdmin(req.user, liveClass.course)
  if (liveClass.status === 'ended' || liveClass.status === 'cancelled') {
    throw new ApiError(400, 'A class that has ended or been cancelled cannot be started')
  }

  liveClass.status = 'live'
  liveClass.startedAt = liveClass.startedAt || new Date()
  await liveClass.save()

  // Notify enrolled students that the live class has begun.
  try {
    const enrollments = await Enrollment.find({ course: liveClass.course })
    const link = `/live-classes?course=${liveClass.course}`
    for (const e of enrollments) {
      await createNotification(e.student, {
        type: 'system',
        title: 'Live class is now live',
        body: `"${liveClass.title}" has started — join now!`,
        link,
      })
    }
  } catch (err) {
    // non-blocking
  }

  res.json(withInstructorName(liveClass))
})

// PATCH /api/live-classes/:id/end — Protected, instructor/admin only.
// Transitions a live class to ended, records end time and per-attendee duration.
export const endLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id)
  if (!liveClass) throw new ApiError(404, 'Live class not found')

  await assertInstructorOrAdmin(req.user, liveClass.course)

  const now = new Date()
  liveClass.status = 'ended'
  liveClass.endedAt = now

  // Finalize durations for attendees still present, based on each person's own
  // join time (not the class-wide start) so late joiners aren't over-credited.
  liveClass.attendees = liveClass.attendees.map((a) => {
    if (!a.leftAt && a.joinedAt) {
      a.leftAt = now
      a.durationSeconds = Math.max(0, Math.round((now - a.joinedAt) / 1000))
    }
    return a
  })

  await liveClass.save()
  res.json(withInstructorName(liveClass))
})

// POST /api/live-classes/:id/join — Protected, enrolled students.
// Adds the user to the attendee roster (idempotent).
export const joinLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id)
  if (!liveClass) throw new ApiError(404, 'Live class not found')
  if (liveClass.status === 'ended' || liveClass.status === 'cancelled') {
    throw new ApiError(400, 'This live class is not open for joining')
  }

  // Enrollment check — students must be enrolled in the course.
  const enrollment = await Enrollment.findOne({ student: req.user._id, course: liveClass.course })
  const course = await Course.findById(liveClass.course)
  const isOwner = course?.instructor?.equals(req.user._id)
  if (!enrollment && req.user.role !== 'admin' && !isOwner) {
    throw new ApiError(403, 'You must be enrolled in this course to join the live class')
  }

  // Max attendees guard.
  if (liveClass.maxAttendees > 0 && liveClass.attendees.length >= liveClass.maxAttendees) {
    const alreadyIn = liveClass.attendees.some((a) => a.user.equals(req.user._id))
    if (!alreadyIn) throw new ApiError(400, 'This live class is at full capacity')
  }

  const existing = liveClass.attendees.find((a) => a.user.equals(req.user._id))
  if (!existing) {
    liveClass.attendees.push({
      user: req.user._id,
      name: req.user.name || '',
      joinedAt: new Date(),
    })
    await liveClass.save()
  }

  res.json({ ok: true, attendeeCount: liveClass.attendees.length })
})

// POST /api/live-classes/:id/leave — Protected.
// Marks the user as left and accrues their attendance duration.
export const leaveLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id)
  if (!liveClass) throw new ApiError(404, 'Live class not found')

  const now = new Date()

  liveClass.attendees = liveClass.attendees.map((a) => {
    if (a.user.equals(req.user._id) && !a.leftAt) {
      a.leftAt = now
      a.durationSeconds = Math.max(0, Math.round((now - a.joinedAt) / 1000))
    }
    return a
  })
  await liveClass.save()

  res.json({ ok: true, attendeeCount: liveClass.attendees.length })
})

// GET /api/live-classes/:id/attendees — Protected.
// Returns the attendee roster (instructors see names; students see a count).
export const getAttendees = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id)
  if (!liveClass) throw new ApiError(404, 'Live class not found')

  const isOwner = (await Course.findById(liveClass.course))?.instructor?.equals(req.user._id)
  const isInstructorOrAdmin = req.user.role === 'admin' || isOwner

  const attendees = liveClass.attendees.map((a) => ({
    user: a.user,
    name: isInstructorOrAdmin ? a.name : undefined,
    joinedAt: a.joinedAt,
    leftAt: a.leftAt,
    durationSeconds: isInstructorOrAdmin ? a.durationSeconds : undefined,
  }))

  res.json({ count: liveClass.attendees.length, attendees: isInstructorOrAdmin ? attendees : [] })
})

// DELETE /api/live-classes/:id — Protected, course instructor or admin only.
export const deleteLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id)
  if (!liveClass) throw new ApiError(404, 'Live class not found')

  await assertInstructorOrAdmin(req.user, liveClass.course)
  await LiveClass.findByIdAndDelete(liveClass._id)

  res.json({ message: 'Live class deleted' })
})
