import 'dotenv/config'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { connectDB } from './src/config/db.js'
import app from './src/app.js'
import Course from './src/models/Course.js'
import Coupon from './src/models/Coupon.js'
import User from './src/models/User.js'
import { COURSES_SEED } from './src/data/coursesSeed.js'
import { COUPONS_SEED } from './src/data/couponsSeed.js'
import fs from 'node:fs'

const LOG_PATH = new URL('./_backend_startup.log', import.meta.url).pathname.replace(/^\/([A-Z]:\/)/, '$1')
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(msg)
  try { fs.appendFileSync(LOG_PATH, line + '\n') } catch {}
}

async function seed() {
  log('Seeding 14 courses + 3 coupons + demo admin (in-memory)...')
  for (const course of COURSES_SEED) {
    await Course.findOneAndUpdate({ slug: course.slug }, course, { upsert: true })
  }
  for (const coupon of COUPONS_SEED) {
    await Coupon.findOneAndUpdate({ code: coupon.code }, coupon, { upsert: true })
  }
  const adminEmail = 'admin@eduzyra.dev'
  if (!(await User.findOne({ email: adminEmail }))) {
    await User.create({
      name: 'Eduzyra Admin',
      email: adminEmail,
      password: 'ChangeMe123!',
      role: 'admin',
      isVerified: true,
    })
    log(`  Demo admin created: ${adminEmail} / ChangeMe123!`)
  }
  log('Seed done.')
}

async function start() {
  log('Step 1: starting MongoMemoryReplSet...')
  process.on('uncaughtException', (e) => log(`UNCAUGHT: ${e.stack || e}`))
  process.on('unhandledRejection', (e) => log(`UNHANDLED: ${e?.stack || e}`))

  try {
    const mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1, dbName: 'eduzyra' },
    })
    const inMemoryUri = mongod.getUri('eduzyra')
    log(`Step 2: In-memory Mongo started at: ${inMemoryUri}`)

    process.env.MONGO_URI = inMemoryUri
    await connectDB()
    log('Step 3: Mongoose connected.')

    await seed()

    const PORT = process.env.PORT || 5000
    app.listen(PORT, () => {
      log(`Step 4: Backend LIVE at: http://localhost:${PORT}`)
    })
  } catch (err) {
    log(`FATAL: ${err.stack || err}`)
    process.exit(1)
  }
}

start()
