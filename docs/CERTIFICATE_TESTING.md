# Certificate Generation Testing Guide

## Overview
The certificate generation has been implemented with **automatic issuance** when a student completes a course (reaches 100% progress).

---

## How to Test Certificate Generation

### Option 1: Using Docker Compose (Recommended)

#### Step 1: Start MongoDB
```bash
cd "c:\Users\pc\OneDrive\Desktop\Eduzyra-By-Althexus-Updated"
docker-compose up mongo -d
```

This starts MongoDB on `localhost:27017` (as configured in `.env`)

#### Step 2: Run the Test Script
```bash
cd "c:\Users\pc\OneDrive\Desktop\Eduzyra-By-Althexus-Updated\eduzyra-backend"
node test-certificate-generation.mjs
```

**Expected Output:**
```
🔗 Connecting to database...
✅ Connected

✅ Created test student:
   Email: test-student-TIMESTAMP@example.com
   Name: Test Certificate Student

✅ Found existing test course:
   Title: Test Certificate Course
   Slug: test-course-cert

📝 Creating enrollment with 100% progress...
✅ Enrollment created:
   Progress: 100%
   Completed: 2026-08-13T...

🎯 Simulating certificate generation (auto-issue on 100% progress)...

✅ Certificate generated successfully!

📜 Certificate Details:
   Certificate ID: EDU-2026-00001
   Student: Test Certificate Student
   Course: Test Certificate Course
   Issued On: 2026-08-13
   Created At: 2026-08-13T...

🔍 Verifying certificate retrieval...
✅ Certificate verified and retrievable!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ Certificate Generation Test Successful!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### Option 2: Using the Backend API (After running backend server)

#### Step 1: Start Backend Server
```bash
cd "c:\Users\pc\OneDrive\Desktop\Eduzyra-By-Althexus-Updated\eduzyra-backend"
npm run dev
```

#### Step 2: Create Test Data via Frontend
1. Open http://localhost:5173
2. Sign up as a student
3. Enroll in any course
4. Complete all lessons (your progress will update to 100%)

#### Step 3: Check Certificate
- A certificate should be **automatically issued**
- Check your email (if SMTP configured) or dashboard notifications
- Download certificate at `/certificate/{certificateId}`

#### Step 4: Verify Certificate via API
```bash
curl http://localhost:5000/api/certificates/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## What the Automatic Certificate Generation Does

When a student's enrollment progress reaches **100%** for the first time:

1. ✅ **Creates Certificate Record**
   - Unique ID: `EDU-YYYY-XXXXX` format
   - Stores student name, course title, issuance date

2. 📧 **Sends Email** (if SMTP configured)
   - Certificate ready notification
   - Download link included

3. 🔔 **Creates In-App Notification**
   - Shows in student dashboard
   - Links to certificate page

4. 🛡️ **Error Handling**
   - Non-blocking: API errors don't block progress update
   - Duplicate ID retry logic (max 3 attempts)

---

## Database Records Created by Test

The test script creates:

**User (Student):**
- Email: `test-student-{timestamp}@example.com`
- Name: `Test Certificate Student`
- Role: `student`

**Course:**
- Title: `Test Certificate Course`
- Slug: `test-course-cert`

**Enrollment:**
- Progress: 100%
- Status: Completed

**Certificate:**
- Unique ID in format: `EDU-2026-00001`
- All student/course details populated

---

## Cleanup (Optional)

To remove test data from database:

```bash
# Connect to MongoDB and run:
use eduzyra
db.users.deleteOne({ email: /test-student/ })
db.courses.deleteOne({ slug: "test-course-cert" })
db.enrollments.deleteMany({ progress: 100 })
db.certificates.deleteMany({ certificateId: /EDU-2026/ })
```

---

## Next Steps

### Frontend Certificate Display
The frontend at [Certificate.jsx](../Eduzyra-By-Althexus-frontend/src/pages/Certificate.jsx) already handles:
- ✅ Certificate verification
- ✅ PDF download with QR code
- ✅ Responsive display

### Email Configuration
To enable certificate emails, configure SMTP in `.env`:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| `ECONNREFUSED 127.0.0.1:27017` | Start MongoDB with `docker-compose up mongo -d` |
| Certificate not emailed | Check SMTP config in `.env` and console logs |
| Duplicate certificate | Use a unique enrollment record (each student+course pair gets one cert) |

---

## Files Modified

- ✅ [enrollmentController.js](./src/controllers/enrollmentController.js) — Added auto-issue logic in `updateProgress()`
- ✅ [test-certificate-generation.mjs](./test-certificate-generation.mjs) — Test script

---

**Run the test now:**
```bash
docker-compose up mongo -d
node test-certificate-generation.mjs
```
