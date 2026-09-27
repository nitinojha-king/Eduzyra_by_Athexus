
import 'dotenv/config'
import { connectDB } from './src/config/db.js'
import Certificate from './src/models/Certificate.js'
import Course from './src/models/Course.js'
import Enrollment from './src/models/Enrollment.js'
import Lesson from './src/models/Lesson.js'
import Notification from './src/models/Notification.js'
import Order from './src/models/Order.js'

async function run() {
  await connectDB()

  const before = {
    courses: await Course.countDocuments(),
    lessons: await Lesson.countDocuments(),
    enrollments: await Enrollment.countDocuments(),
    certificates: await Certificate.countDocuments(),
    notifications: await Notification.countDocuments(),
    orders: await Order.countDocuments(),
  }

  console.log('\n=== Before cleanup ===')
  Object.entries(before).forEach(([k, v]) => console.log(`  ${k.padEnd(15)} ${v}`))

  const courseIds = (await Course.find({}, { _id: 1 })).map(c => c._id)

  console.log(`\nDeleting ${courseIds.length} courses and all related records...`)

  const deleted = {}
  deleted.lessons = await Lesson.deleteMany({ course: { $in: courseIds } })
  deleted.enrollments = await Enrollment.deleteMany({ course: { $in: courseIds } })
  deleted.certificates = await Certificate.deleteMany({ course: { $in: courseIds } })
  deleted.orders = await Order.deleteMany({ course: { $in: courseIds } })
  deleted.notifications = await Notification.deleteMany({
    type: { $in: ['enrollment', 'certificate'] },
  })
  deleted.courses = await Course.deleteMany({ _id: { $in: courseIds } })

  console.log('\n=== Deletion results ===')
  Object.entries(deleted).forEach(([k, r]) => console.log(`  ${k.padEnd(15)} deleted=${r.deletedCount || 0}`))

  const after = {
    courses: await Course.countDocuments(),
    lessons: await Lesson.countDocuments(),
    enrollments: await Enrollment.countDocuments(),
    certificates: await Certificate.countDocuments(),
    notifications: await Notification.countDocuments(),
    orders: await Order.countDocuments(),
  }

  console.log('\n=== After cleanup ===')
  Object.entries(after).forEach(([k, v]) => console.log(`  ${k.padEnd(15)} ${v}`))

  process.exit(0)
}

run().catch((err) => {
  console.error('Cleanup failed:', err)
  process.exit(1)
})
