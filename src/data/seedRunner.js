
import 'dotenv/config'
import { connectDB } from '../config/db.js'
import Course from '../models/Course.js'
import Coupon from '../models/Coupon.js'
import User from '../models/User.js'
import Lesson from '../models/Lesson.js'
import Enrollment from '../models/Enrollment.js'
import Notification from '../models/Notification.js'
import Certificate from '../models/Certificate.js'
import { COURSES_SEED } from './coursesSeed.js'
import { COUPONS_SEED } from './couponsSeed.js'

function buildLessonsForCourse(courseId, course) {
  const lessons = []
  const { syllabus = [] } = course

  for (let mIdx = 0; mIdx < syllabus.length; mIdx++) {
    const mod = syllabus[mIdx]
    const numLessons = Math.max(1, Math.min(mod.lessons || 1, 8))

    for (let lIdx = 1; lIdx <= numLessons; lIdx++) {
      const typePick = lIdx % 4
      let type = 'video'
      if (typePick === 2) type = 'quiz'
      else if (typePick === 3 && lIdx === numLessons) type = 'assignment'
      else if (typePick === 0 && lIdx !== 1) type = 'notes'

      const base = {
        course: courseId,
        title: `${mod.title} — Lesson ${lIdx}`,
        moduleTitle: mod.title,
        moduleIndex: mIdx,
        order: lIdx,
        type,
        published: true,
      }

      if (type === 'video') {
        base.videoUrl = 'https://www.youtube.com/embed/dQw4w9WgXcQ'
      } else if (type === 'notes') {
        base.notes = `# ${mod.title} — Notes ${lIdx}\n\nKey concepts covered in this lesson:\n- Overview of ${mod.title.toLowerCase()} fundamentals\n- Common pitfalls and how to avoid them\n- Practice exercises and solutions\n\n## Summary\n\nReview the material and complete the checkpoint before moving on.`
      } else if (type === 'quiz') {
        base.quizQuestions = [
          {
            question: `Which of the following best describes "${mod.title}"?`,
            options: [
              'A collection of unrelated topics',
              'A structured module building on prior concepts',
              'An optional bonus section',
              'A quiz with no learning objective',
            ],
            correctIndex: 1,
          },
          {
            question: `What is the recommended order for completing Lesson ${lIdx}?`,
            options: [
              'Skip straight to the quiz',
              'Read/watch, take notes, then practice',
              'Only watch the first 30 seconds',
              'Complete the assignment first without context',
            ],
            correctIndex: 1,
          },
          {
            question: `How many lessons are in the "${mod.title}" module?`,
            options: ['1', String(numLessons), '100', '0'],
            correctIndex: 1,
          },
        ]
      } else if (type === 'assignment') {
        base.notes = `# ${mod.title} — Capstone Assignment\n\n## Objective\nBuild a small deliverable that demonstrates mastery of the module.\n\n## Submission\n1. Fork the starter repo\n2. Complete the tasks listed in the README\n3. Submit a link via the attachment upload\n\n## Rubric\n- Functionality: 60%\n- Code quality: 25%\n- Documentation: 15%`
      }

      lessons.push(base)
    }
  }

  return lessons
}

async function upsertUser({ email, name, role, password }) {
  const existing = await User.findOne({ email }).select('+password')
  if (existing) {
    existing.name = name
    existing.role = role
    existing.isVerified = true
    if (password) existing.password = password
    await existing.save()
    return existing
  }
  const user = await User.create({ email, name, role, password, isVerified: true })
  return user
}

async function run() {
  await connectDB()

  console.log('\n── Seeding Courses ──')
  const upsertedCourses = []
  for (const course of COURSES_SEED) {
    const doc = await Course.findOneAndUpdate(
      { slug: course.slug },
      { $set: course },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    upsertedCourses.push(doc)
  }
  console.log(`  ✅ ${COURSES_SEED.length} courses upserted.`)

  console.log('\n── Seeding Coupons ──')
  for (const coupon of COUPONS_SEED) {
    await Coupon.findOneAndUpdate(
      { code: coupon.code },
      { $set: coupon },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }
  console.log(`  ✅ ${COUPONS_SEED.length} coupons upserted (${COUPONS_SEED.filter(c => c.active).length} active, ${COUPONS_SEED.filter(c => !c.active).length} inactive).`)

  console.log('\n── Seeding Users ──')
  const admin = await upsertUser({
    email: 'admin@eduzyra.dev',
    name: 'Eduzyra Admin',
    role: 'admin',
    password: 'ChangeMe123!',
  })
  console.log(`  ✅ Admin       → ${admin.email} / ChangeMe123!`)

  const instructor = await upsertUser({
    email: 'aditi.rao@eduzyra.dev',
    name: 'Aditi Rao',
    role: 'instructor',
    password: 'Instructor123!',
  })
  console.log(`  ✅ Instructor  → ${instructor.email} / Instructor123!`)

  const mentor2 = await upsertUser({
    email: 'karthik.menon@eduzyra.dev',
    name: 'Karthik Menon',
    role: 'instructor',
    password: 'Instructor123!',
  })
  console.log(`  ✅ Instructor  → ${mentor2.email} / Instructor123!`)

  const student = await upsertUser({
    email: 'student@eduzyra.dev',
    name: 'Demo Student',
    role: 'student',
    password: 'Student123!',
  })
  console.log(`  ✅ Student     → ${student.email} / Student123!`)

  console.log('\n── Linking Instructors to Courses ──')
  const instructorMap = { 'Aditi Rao': instructor, 'Karthik Menon': mentor2 }
  let linked = 0
  for (const c of upsertedCourses) {
    const prof = instructorMap[c.instructorName] || instructor
    if (!c.instructor || String(c.instructor) !== String(prof._id)) {
      c.instructor = prof._id
      await c.save()
      linked++
    }
  }
  console.log(`  ✅ Linked ${linked} courses to instructor documents.`)

  console.log('\n── Seeding Lessons ──')
  let totalLessons = 0
  for (const course of upsertedCourses) {
    const existing = await Lesson.countDocuments({ course: course._id })
    if (existing > 0) {
      totalLessons += existing
      continue
    }
    const lessons = buildLessonsForCourse(course._id, course)
    if (lessons.length) {
      await Lesson.insertMany(lessons)
      totalLessons += lessons.length
    }
  }
  console.log(`  ✅ ${totalLessons} lessons across ${upsertedCourses.length} courses.`)

  console.log('\n── Seeding Enrollments (Demo Student) ──')
  const enrolledCourseIds = []
  const sampleCourses = [upsertedCourses[0], upsertedCourses[2], upsertedCourses[5], upsertedCourses[9]]
  const progressSamples = [100, 62, 28, 5]

  for (let i = 0; i < sampleCourses.length; i++) {
    const course = sampleCourses[i]
    const progress = progressSamples[i]
    const completed = progress === 100
    const enrollment = await Enrollment.findOneAndUpdate(
      { student: student._id, course: course._id },
      {
        $set: {
          student: student._id,
          course: course._id,
          progress,
          completedAt: completed ? new Date() : null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    enrolledCourseIds.push(course._id)

    await User.updateOne(
      { _id: student._id },
      { $addToSet: { enrolledCourses: course._id } },
    )

    console.log(`     → ${course.title.padEnd(45)}  ${String(progress).padStart(3)}% ${completed ? '✓ completed' : ''}`)
    void enrollment
  }

  console.log('\n── Seeding Notifications (Demo Student) ──')
  const notifications = [
    {
      type: 'enrollment',
      title: `Welcome to "${sampleCourses[2].title}"!`,
      body: `Your enrollment was successful. Start Module 1 now to stay on pace.`,
      link: `/learn/${sampleCourses[2].slug}`,
      read: false,
    },
    {
      type: 'coupon',
      title: 'New coupon available: LAUNCH20',
      body: 'Use LAUNCH20 at checkout for 20% off any course — expires Aug 31.',
      link: '/courses',
      read: false,
    },
    {
      type: 'certificate',
      title: `Certificate issued: "${sampleCourses[0].title}"`,
      body: 'Congratulations on finishing the course! View and download your certificate now.',
      link: `/certificate/EDU-104-${student._id.toString().slice(-6)}`,
      read: true,
    },
    {
      type: 'payment',
      title: 'Payment received — thank you!',
      body: `Your payment for "${sampleCourses[0].title}" was processed successfully.`,
      link: '/dashboard',
      read: true,
    },
    {
      type: 'system',
      title: 'Account created successfully',
      body: 'Welcome to Eduzyra! Complete your profile to unlock course recommendations.',
      link: '/profile',
      read: true,
    },
  ]
  for (const n of notifications) {
    await Notification.findOneAndUpdate(
      { user: student._id, title: n.title },
      { $set: { user: student._id, ...n } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }
  console.log(`  ✅ ${notifications.length} notifications seeded for ${student.email}`)

  console.log('\n── Seeding Certificate (Demo Student) ──')
  const certCourse = sampleCourses[0]
  const certificateId = `EDU-104-${student._id.toString().slice(-6)}`
  const issuedOn = new Date().toISOString().slice(0, 10)
  await Certificate.findOneAndUpdate(
    { certificateId },
    {
      $set: {
        certificateId,
        student: student._id,
        studentName: student.name,
        course: certCourse._id,
        courseTitle: certCourse.title,
        issuedOn,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  console.log(`  ✅ Certificate ${certificateId} → "${certCourse.title}" (issued ${issuedOn})`)
  console.log(`     Verify at: http://localhost:5174/verify-certificate  (enter ID: ${certificateId})`)

  console.log('\n── Seed Summary ──')
  const counts = {
    courses: await Course.countDocuments(),
    coupons: await Coupon.countDocuments(),
    users: await User.countDocuments(),
    lessons: await Lesson.countDocuments(),
    enrollments: await Enrollment.countDocuments(),
    notifications: await Notification.countDocuments(),
    certificates: await Certificate.countDocuments(),
  }
  Object.entries(counts).forEach(([k, v]) => console.log(`  ${k.padEnd(15)} ${v}`))

  console.log('\nSeed complete. Process exiting.')
  process.exit(0)
}

run().catch((err) => {
  console.error('\n❌ Seed failed:', err)
  process.exit(1)
})
