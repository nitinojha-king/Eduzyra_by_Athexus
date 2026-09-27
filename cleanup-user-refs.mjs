
import 'dotenv/config'
import { connectDB } from './src/config/db.js'
import User from './src/models/User.js'
import Enrollment from './src/models/Enrollment.js'

async function run() {
  await connectDB()

  const result = await User.updateMany(
    { enrolledCourses: { $exists: true, $ne: [] } },
    { $set: { enrolledCourses: [] } },
  )
  console.log(`Cleared enrolledCourses on ${result.modifiedCount} user documents.`)

  const students = await User.find({ role: 'student' }, { email: 1, enrolledCourses: 1, name: 1 })
  console.log('\nStudent accounts after cleanup:')
  students.forEach(s => console.log(`  ${s.email}  enrolledCourses.length=${s.enrolledCourses?.length || 0}`))

  console.log(`\nEnrollments remaining: ${await Enrollment.countDocuments()}`)
  process.exit(0)
}
run().catch(err => { console.error(err); process.exit(1) })
