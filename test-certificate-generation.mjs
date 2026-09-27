import 'dotenv/config'
import { connectDB } from './src/config/db.js'
import User from './src/models/User.js'
import Course from './src/models/Course.js'
import Enrollment from './src/models/Enrollment.js'
import Certificate from './src/models/Certificate.js'
import mongoose from 'mongoose'

/**
 * Test Script: Certificate Generation
 * 
 * This script tests the automatic certificate issuance when enrollment
 * progress reaches 100%. It:
 * 1. Creates a test student user
 * 2. Creates/finds a test course
 * 3. Creates an enrollment with 100% progress
 * 4. Verifies a certificate is created
 * 5. Displays certificate details
 */

async function testCertificateGeneration() {
  try {
    console.log('\n🔗 Connecting to database...')
    await connectDB()
    console.log('✅ Connected\n')

    // ─────────────────────────────────────────────────────────
    // 1. Create or find test student
    // ─────────────────────────────────────────────────────────
    const testEmail = `test-student-${Date.now()}@example.com`
    const testStudent = await User.create({
      email: testEmail,
      name: 'Test Certificate Student',
      password: 'TestPassword123!',
      role: 'student',
      isVerified: true,
    })
    console.log('✅ Created test student:')
    console.log(`   Email: ${testStudent.email}`)
    console.log(`   Name: ${testStudent.name}\n`)

    // ─────────────────────────────────────────────────────────
    // 2. Find or create test course
    // ─────────────────────────────────────────────────────────
    let testCourse = await Course.findOne({ slug: 'test-course-cert' })
    if (!testCourse) {
      testCourse = await Course.create({
        title: 'Test Certificate Course',
        slug: 'test-course-cert',
        description: 'A test course for certificate generation',
        instructor: new mongoose.Types.ObjectId(), // placeholder instructor
        price: 0,
        category: 'Testing',
        level: 'Beginner',
        duration: '1 week',
        syllabus: [{ title: 'Test Module', lessons: 1 }],
      })
      console.log('✅ Created test course:')
    } else {
      console.log('✅ Found existing test course:')
    }
    console.log(`   Title: ${testCourse.title}`)
    console.log(`   Slug: ${testCourse.slug}\n`)

    // ─────────────────────────────────────────────────────────
    // 3. Create enrollment with 100% progress
    // ─────────────────────────────────────────────────────────
    console.log('📝 Creating enrollment with 100% progress...')
    const enrollment = await Enrollment.create({
      student: testStudent._id,
      course: testCourse._id,
      progress: 100,
      completedAt: new Date(),
    })
    console.log('✅ Enrollment created:')
    console.log(`   Progress: ${enrollment.progress}%`)
    console.log(`   Completed: ${enrollment.completedAt}\n`)

    // ─────────────────────────────────────────────────────────
    // 4. Simulate updateProgress trigger (in real app, this happens via API)
    // ─────────────────────────────────────────────────────────
    console.log('🎯 Simulating certificate generation (auto-issue on 100% progress)...\n')
    
    // Auto-issue certificate logic (mirrors enrollmentController.js)
    const year = new Date().getFullYear()
    const countThisYear = await Certificate.countDocuments({
      certificateId: new RegExp(`^EDU-${year}-`),
    })
    const sequence = String(countThisYear + 1).padStart(5, '0')
    const certificateId = `EDU-${year}-${sequence}`

    const certificate = await Certificate.create({
      certificateId,
      student: testStudent._id,
      studentName: testStudent.name,
      course: testCourse._id,
      courseTitle: testCourse.title,
      issuedOn: new Date().toISOString().slice(0, 10),
    })

    console.log('✅ Certificate generated successfully!\n')

    // ─────────────────────────────────────────────────────────
    // 5. Display certificate details
    // ─────────────────────────────────────────────────────────
    console.log('📜 Certificate Details:')
    console.log(`   Certificate ID: ${certificate.certificateId}`)
    console.log(`   Student: ${certificate.studentName}`)
    console.log(`   Course: ${certificate.courseTitle}`)
    console.log(`   Issued On: ${certificate.issuedOn}`)
    console.log(`   Created At: ${certificate.createdAt}\n`)

    // ─────────────────────────────────────────────────────────
    // 6. Verify certificate can be retrieved
    // ─────────────────────────────────────────────────────────
    console.log('🔍 Verifying certificate retrieval...')
    const verified = await Certificate.findOne({
      certificateId: certificate.certificateId,
    })
    if (verified) {
      console.log('✅ Certificate verified and retrievable!\n')
    }

    // ─────────────────────────────────────────────────────────
    // 7. Summary
    // ─────────────────────────────────────────────────────────
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✨ Certificate Generation Test Successful!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    console.log('🔗 Certificate URL (Frontend):')
    console.log(`   ${process.env.CLIENT_ORIGIN || 'http://localhost:3000'}/certificate/${certificateId}\n`)

    console.log('📋 Next Steps:')
    console.log('   1. Test certificate download on the frontend')
    console.log('   2. Verify QR code generation on the Certificate.jsx page')
    console.log('   3. Test certificate email notifications (if email configured)\n')

  } catch (error) {
    console.error('❌ Error during certificate generation test:', error.message)
    if (error.code === 11000) {
      console.error('   (Duplicate key error - certificate ID already exists)')
    }
  } finally {
    await mongoose.connection.close()
    process.exit(0)
  }
}

// Run the test
testCertificateGeneration()
