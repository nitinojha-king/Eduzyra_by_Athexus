import 'dotenv/config'
import assert from 'node:assert/strict'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import User from './src/models/User.js'
import Course from './src/models/Course.js'
import Enrollment from './src/models/Enrollment.js'
import LiveClass from './src/models/LiveClass.js'
import { liveSessionSchema } from './src/validators/index.js'
import {
  createLiveSession,
  listLiveSessions,
  joinLiveSession,
  updateLiveSession,
  deleteLiveSession,
  deriveStatus,
  toLiveSessionJSON,
} from './src/controllers/liveSessionController.js'

const GOOD_MEET = 'https://meet.google.com/abc-defg-hij'

function mockRes() {
  const res = {}
  res.statusCode = 200
  res.body = undefined
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return res
}

async function invoke(fn, req) {
  const res = mockRes()
  let nextErr = null
  let settled = false
  const origJson = res.json
  res.json = (b) => { res.body = b; settled = true; return res }
  fn(req, res, (e) => { nextErr = e || null; settled = true })
  const deadline = Date.now() + 10000
  while (!settled && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 10) })
  }
  return { res, err: nextErr }
}

function reqWith(user, extra = {}) {
  return { user, params: {}, query: {}, body: {}, ...extra }
}

let passed = 0
const ok = (name) => { passed += 1; console.log(`ok - ${name}`) }

let mongoServer = null
try {
  mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())

  // ── 1. URL validation ──────────────────────────────────────────
  assert.equal(liveSessionSchema.safeParse({
    title: 'Live project review', meetingUrl: GOOD_MEET,
    scheduledStartAt: new Date(Date.now() + 3600000).toISOString(),
  }).success, true)
  ok('accepts valid Google Meet URL')
  const bad = liveSessionSchema.safeParse({
    title: 'Live project review', meetingUrl: 'https://example.com/room',
    scheduledStartAt: new Date(Date.now() + 3600000).toISOString(),
  })
  assert.equal(bad.success, false)
  ok('rejects non-Meet URL for GOOGLE_MEET provider')
  const badEnd = liveSessionSchema.safeParse({
    title: 'Live project review', meetingUrl: GOOD_MEET,
    scheduledStartAt: new Date(Date.now() + 7200000).toISOString(),
    scheduledEndAt: new Date(Date.now() + 3600000).toISOString(),
  })
  assert.equal(badEnd.success, false)
  ok('rejects end-before-start window')

  // ── 2. Fixtures ────────────────────────────────────────────────
  const stamp = Date.now()
  const instructor = await User.create({ name: 'I', email: `ins-${stamp}@e.com`, password: 'Password1', role: 'instructor', isVerified: true })
  const otherInstructor = await User.create({ name: 'O', email: `ins2-${stamp}@e.com`, password: 'Password1', role: 'instructor', isVerified: true })
  const student = await User.create({ name: 'S', email: `stu-${stamp}@e.com`, password: 'Password1', role: 'student', isVerified: true })
  const outsider = await User.create({ name: 'X', email: `out-${stamp}@e.com`, password: 'Password1', role: 'student', isVerified: true })
  const admin = await User.create({ name: 'A', email: `adm-${stamp}@e.com`, password: 'Password1', role: 'admin', isVerified: true })
  const course = await Course.create({
    slug: `live-test-${stamp}`, code: `EDU-${String(stamp).slice(-5)}`, title: 'Live Test Course',
    category: 'Test', level: 'Beginner', instructor: instructor._id, instructorName: 'I',
    duration: '4 weeks', lessons: 10, price: 0, summary: 'Summary for live session test course.',
  })
  await Enrollment.create({ student: student._id, course: course._id })

  const startIso = new Date(Date.now() + 3600000).toISOString()
  const endIso = new Date(Date.now() + 7200000).toISOString()

  // ── 3. Instructor creates ──────────────────────────────────────
  const created = await invoke(createLiveSession, reqWith(instructor, {
    params: { courseId: course.slug },
    validatedBody: { title: 'Live project review', description: 'Q&A', meetingProvider: 'GOOGLE_MEET', meetingUrl: GOOD_MEET, scheduledStartAt: startIso, scheduledEndAt: endIso },
  }))
  assert.equal(created.err, null)
  assert.equal(created.res.statusCode, 201)
  assert.equal(created.res.body.meetingUrl, GOOD_MEET)
  assert.equal(created.res.body.status, 'UPCOMING')
  const sessionId = created.res.body.id
  ok('instructor creates session with Meet link (UPCOMING)')

  // Legacy sync check
  const raw = await LiveClass.findById(sessionId)
  assert.equal(raw.streamUrl, GOOD_MEET)
  assert.equal(new Date(raw.startsAt).toISOString(), new Date(raw.scheduledStartAt).toISOString())
  ok('model syncs meetingUrl<->streamUrl and scheduledStartAt<->startsAt')

  // ── 4. Student cannot create ───────────────────────────────────
  const denied = await invoke(createLiveSession, reqWith(student, {
    params: { courseId: course.slug },
    validatedBody: { title: 'Hack', meetingUrl: GOOD_MEET, scheduledStartAt: startIso },
  }))
  assert.equal(denied.err?.statusCode, 403)
  ok('student gets 403 on create')

  // ── 5. Enrolled lists (sees meetingUrl), outsider 403 ──────────
  const listed = await invoke(listLiveSessions, reqWith(student, { params: { courseId: course.slug }, query: {} }))
  assert.equal(listed.err, null)
  assert.equal(listed.res.body.length, 1)
  assert.equal(listed.res.body[0].meetingUrl, GOOD_MEET)
  ok('enrolled student lists session with meetingUrl')

  const blocked = await invoke(listLiveSessions, reqWith(outsider, { params: { courseId: course.slug }, query: {} }))
  assert.equal(blocked.err?.statusCode, 403)
  ok('non-enrolled student gets 403 on list')

  const adminList = await invoke(listLiveSessions, reqWith(admin, { params: { courseId: course.slug }, query: {} }))
  assert.equal(adminList.err, null)
  ok('admin can list all sessions')

  // ── 6. Join ────────────────────────────────────────────────────
  const joined = await invoke(joinLiveSession, reqWith(student, { params: { id: sessionId } }))
  assert.equal(joined.err, null)
  assert.equal(joined.res.body.redirectUrl, GOOD_MEET)
  ok('enrolled student join returns { redirectUrl }')

  const joinBlocked = await invoke(joinLiveSession, reqWith(outsider, { params: { id: sessionId } }))
  assert.equal(joinBlocked.err?.statusCode, 403)
  ok('non-enrolled student gets 403 on join')

  // ── 7. Edit ownership ──────────────────────────────────────────
  const otherEdit = await invoke(updateLiveSession, reqWith(otherInstructor, {
    params: { id: sessionId }, validatedBody: { title: 'Hijacked' },
  }))
  assert.equal(otherEdit.err?.statusCode, 403)
  ok('other instructor gets 403 on update')

  // Late enrollment sees upcoming session
  const late = await User.create({ name: 'L', email: `late-${stamp}@e.com`, password: 'Password1', role: 'student', isVerified: true })
  await Enrollment.create({ student: late._id, course: course._id })
  const lateList = await invoke(listLiveSessions, reqWith(late, { params: { courseId: course.slug }, query: {} }))
  assert.equal(lateList.err, null)
  assert.equal(lateList.res.body.length, 1)
  ok('student enrolling after creation still sees upcoming sessions')

  // Cancel then join blocked
  await invoke(updateLiveSession, reqWith(instructor, { params: { id: sessionId }, validatedBody: { status: 'CANCELLED' } }))
  const cancelledDoc = await LiveClass.findById(sessionId)
  assert.equal(deriveStatus(cancelledDoc), 'CANCELLED')
  const joinCancelled = await invoke(joinLiveSession, reqWith(student, { params: { id: sessionId } }))
  assert.equal(joinCancelled.err?.statusCode, 400)
  ok('cancelled session shows CANCELLED and blocks join')

  // toJSON never leaks when asked to strip
  const stripped = toLiveSessionJSON(cancelledDoc, { includeMeetingUrl: false })
  assert.equal('meetingUrl' in stripped, false)
  ok('serializer omits meetingUrl for unauthorized callers')

  // ── 8. Delete by owner ─────────────────────────────────────────
  const del = await invoke(deleteLiveSession, reqWith(instructor, { params: { id: sessionId } }))
  assert.equal(del.err, null)
  assert.equal(await LiveClass.findById(sessionId), null)
  ok('instructor deletes own session')

  console.log(`\nAll ${passed} live-session checks passed.`)
} finally {
  await mongoose.disconnect().catch(() => {})
  await mongoServer?.stop().catch(() => {})
}
