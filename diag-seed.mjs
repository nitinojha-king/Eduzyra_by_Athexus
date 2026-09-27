
import 'dotenv/config'
import { connectDB } from './src/config/db.js'
import Certificate from './src/models/Certificate.js'
import Course from './src/models/Course.js'
import Enrollment from './src/models/Enrollment.js'
import Lesson from './src/models/Lesson.js'
import Notification from './src/models/Notification.js'
import User from './src/models/User.js'

async function run() {
  await connectDB()
  const certs = await Certificate.find({})
  console.log('\n=== Certificates ===')
  console.log(JSON.stringify(certs, null, 2))

  const lessonsSample = await Lesson.find({}).limit(3)
  console.log('\n=== Lessons Sample (3) ===')
  console.log(lessonsSample.map(l => ({ id: l._id, course: l.course, title: l.title, type: l.type, module: l.moduleIndex, order: l.order })))

  const enrollments = await Enrollment.find({}).populate('student', 'email').populate('course', 'title')
  console.log('\n=== Enrollments ===')
  console.log(enrollments.map(e => ({
    student: e.student?.email,
    course: e.course?.title,
    progress: e.progress,
    completed: !!e.completedAt,
  })))

  const notifications = await Notification.find({})
  console.log('\n=== Notifications (count, types) ===')
  console.log('count=', notifications.length)
  console.log(notifications.map(n => ({ type: n.type, title: n.title, read: n.read })))

  const courseLessonCounts = await Lesson.aggregate([
    { $group: { _id: '$course', count: { $sum: 1 } } },
  ])
  const courses = await Course.find({})
  console.log('\n=== Courses with Lesson counts ===')
  for (const c of courses) {
    const m = courseLessonCounts.find(x => String(x._id) === String(c._id))
    console.log(`  [${c.code}] ${c.title.padEnd(55)} syllabus-lessons=${c.lessons}  actual-lessons=${m?.count || 0}  status=${c.status}  instructor=${c.instructorName}`)
  }
  process.exit(0)
}
run().catch(err => { console.error(err); process.exit(1) })
