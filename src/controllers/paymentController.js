import mongoose from 'mongoose'
import crypto from 'crypto'
import Razorpay from 'razorpay'

import Course from '../models/Course.js'
import Order from '../models/Order.js'
import Coupon from '../models/Coupon.js'
import Enrollment from '../models/Enrollment.js'
import User from '../models/User.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { sendPaymentSuccessEmail, sendEnrollmentConfirmationEmail, sendRefundEmail } from '../services/emailService.js'
import { createNotification } from '../utils/createNotification.js'

// ── Razorpay client (lazy singleton) ─────────────────────────────────────
// Lazily initialised so the rest of the app can boot without Razorpay creds
// configured — the error only surfaces when a payment endpoint is actually
// hit. This lets you run auth/courses/etc. in dev without forcing Razorpay
// setup until you actually need to test payments.
//
// Requires:  npm install razorpay
// Env vars:  RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
let _razorpayClient = null
function getRazorpayClient() {
  if (_razorpayClient) return _razorpayClient

  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new ApiError(
      500,
      'Razorpay credentials not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env',
    )
  }
  _razorpayClient = new Razorpay({ key_id: keyId, key_secret: keySecret })
  return _razorpayClient
}

// ── Helper: coupon re-validation ─────────────────────────────────────────
// Used by createOrder to recompute the discount at order-creation time.
// Returns discount in RUPEES (caller rounds to paise). Returns 0 if the
// coupon is missing, inactive, expired, or not applicable.
//
// This is deliberately a re-validation, not a trust of the earlier
// /coupons/apply response — the coupon may have expired between apply and
// pay, and we want to capture the discount snapshot at order-creation time
// so future coupon edits don't retroactively change historical orders.
async function computeDiscountInRupees(course, couponCode) {
  if (!couponCode) return 0
  const coupon = await Coupon.findOne({
    code: couponCode.trim().toUpperCase(),
    active: true,
  })
  if (!coupon) return 0
  if (coupon.expiresAt && coupon.expiresAt < new Date()) return 0

  if (coupon.type === 'percentage') {
    return Math.round((course.price * coupon.value) / 100)
  }
  return coupon.value // flat — rupees
}

// ── Helper: timing-safe HMAC comparison ──────────────────────────────────
// Prevents timing attacks on signature verification. Returns true if the
// signatures match, false otherwise. Handles unequal-length inputs safely
// (crypto.timingSafeEqual throws on length mismatch).
function safeCompare(a, b) {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

// ── Shared helper: enrollStudent ─────────────────────────────────────────
// Used by BOTH verifyPayment() and razorpayWebhook() to ensure identical
// enrollment behavior regardless of which path triggers the success.
//
// Caller responsibilities BEFORE calling this helper:
//   - Set order.status = 'paid'
//   - Set order.razorpayPaymentId (if available)
//   - Set order.razorpaySignature (if available, /verify path only)
//   - Set order.transactionId (if not already set)
//
// This helper does (inside the caller's session):
//   1. Save the order (with the status/fields the caller already set)
//   2. Check for existing enrollment (idempotent — skip if already enrolled)
//   3. If not enrolled: create Enrollment, $addToSet User.enrolledCourses,
//      $inc Course.students
//
// Idempotency: if the enrollment already exists, this is a no-op.
// This makes it safe to call from both /verify and the webhook — whichever
// fires second will find the enrollment already exists and skip.
async function enrollStudent(order, session) {
  // 1. Persist the order's new state
  await order.save({ session })

  // 2. Idempotency check — skip if already enrolled
  const existingEnrollment = await Enrollment.findOne({
    student: order.student,
    course: order.course,
  }).session(session)

  if (existingEnrollment) return { enrolled: false }

  // 3. Create enrollment + update user + increment course student count
  await Enrollment.create(
    [{ student: order.student, course: order.course, order: order._id }],
    { session },
  )

  await User.findByIdAndUpdate(
    order.student,
    { $addToSet: { enrolledCourses: order.course } },
    { session },
  )

  await Course.findByIdAndUpdate(
    order.course,
    { $inc: { students: 1 } },
    { session },
  )

  return { enrolled: true }
}

/**
 * Send payment success + enrollment confirmation emails.
 * Called AFTER the transaction commits — never inside it.
 * Non-blocking: a failed email must not affect the payment response.
 *
 * @param {Object} order — the paid Order document (must have transactionId, amount)
 * @param {Object} user  — { name, email } of the student
 * @param {Object} course — { title, slug } of the course
 */
async function sendEnrollmentEmails(order, user, course) {
  try {
    const courseUrl = `${process.env.CLIENT_ORIGIN}/learn/${course.slug}`
    const receiptUrl = `${process.env.CLIENT_ORIGIN}/payment/success`

    await Promise.all([
      sendPaymentSuccessEmail({
        name: user.name,
        email: user.email,
        courseTitle: course.title,
        amount: order.amount, // paise — emailService formats it
        transactionId: order.transactionId,
        receiptUrl,
      }),
      sendEnrollmentConfirmationEmail({
        name: user.name,
        email: user.email,
        courseTitle: course.title,
        courseUrl,
      }),
    ])

    // Create in-app notification (fire-and-forget)
    await createNotification(user._id || user.id, {
      type: 'enrollment',
      title: 'Enrollment confirmed',
      body: `You're now enrolled in "${course.title}". Start learning!`,
      link: `/learn/${course.slug}`,
    })
  } catch (err) {
    console.error('[sendEnrollmentEmails] failed:', err?.message || err)
  }
}

// ── POST /api/payments/order  { courseId, couponCode? } ──────────────────
// Creates an Order in our DB AND a corresponding Order on Razorpay.
// Amount is computed server-side from Course.price (rupees) → paise.
// The frontend never sends an amount.
export const createOrder = asyncHandler(async (req, res) => {
  const { courseId, couponCode } = req.validatedBody || req.body
  if (!courseId) throw new ApiError(400, 'courseId is required')

  // 1. Look up course by slug or ObjectId
  const course = await Course.findBySlugOrId(courseId)
  if (!course) throw new ApiError(404, 'Course not found')

  // 2. Prevent duplicate enrollment
  const existing = await Enrollment.findOne({
    student: req.user._id,
    course: course._id,
  })
  if (existing) throw new ApiError(409, 'You are already enrolled in this course')

  // 3. Re-validate coupon + compute amounts
  const discountInRupees = await computeDiscountInRupees(course, couponCode)
  const amountInRupees = Math.max(course.price - discountInRupees, 0)
  const amountInPaise = Math.round(amountInRupees * 100)
  const discountInPaise = Math.round(discountInRupees * 100)

  // 4. Create the DB Order (status: 'created', no razorpayOrderId yet)
  const order = await Order.create({
    student: req.user._id,
    course: course._id,
    amount: amountInPaise,
    currency: 'INR',
    couponCode: couponCode ? couponCode.trim().toUpperCase() : undefined,
    discount: discountInPaise,
    status: 'created',
  })

  // 5. Create the Razorpay Order
  let rzpOrder
  try {
    rzpOrder = await getRazorpayClient().orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `eduzyra_${order._id}`,
      notes: {
        orderId: String(order._id),
        courseSlug: course.slug,
        studentEmail: req.user.email || '',
      },
    })
  } catch (err) {
    // Gateway failed — mark our Order as failed so we have an audit trail
    order.status = 'failed'
    order.failureReason = `Razorpay order creation failed: ${
      err?.error?.description || err?.message || 'Unknown gateway error'
    }`
    await order.save()
    throw new ApiError(
      502,
      `Payment gateway error: ${
        err?.error?.description || err?.message || 'Could not create order'
      }`,
    )
  }

  // 6. Persist razorpayOrderId on our Order
  order.razorpayOrderId = rzpOrder.id
  await order.save()

  // 7. Return everything the frontend needs to open Razorpay Checkout modal
  res.status(201).json({
    orderId: order._id,
    razorpayOrderId: rzpOrder.id,
    amount: amountInPaise,
    currency: 'INR',
    keyId: process.env.RAZORPAY_KEY_ID,
  })
})

// ── POST /api/payments/verify ────────────────────────────────────────────
// Body: { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }
//
// Verifies the payment actually happened on Razorpay's side via THREE
// defence layers, then atomically enrolls the student.
//
//   Layer 1 — razorpayOrderId matches what we stored on our Order document
//   Layer 2 — HMAC-SHA256 signature verification (proves the response
//             genuinely came from Razorpay, not a MITM)
//   Layer 3 — Fetch the payment from Razorpay's API and confirm
//             payment.status === 'captured' AND payment.amount === order.amount
//
// On success, all writes are wrapped in a single Mongo transaction via
// the shared enrollStudent() helper.
//
// Idempotency: if the order is already 'paid' (e.g., webhook fired first),
// returns 200 with success: true and the existing transactionId — does NOT
// return 409, because a successful payment is not an error even if the
// webhook beat us to it.
export const verifyPayment = asyncHandler(async (req, res) => {
  const {
    orderId,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  } = req.validatedBody || req.body

  if (!orderId) throw new ApiError(400, 'orderId is required')
  if (!razorpayOrderId) throw new ApiError(400, 'razorpayOrderId is required')
  if (!razorpayPaymentId) throw new ApiError(400, 'razorpayPaymentId is required')
  if (!razorpaySignature) throw new ApiError(400, 'razorpaySignature is required')

  // 1. Find the order, scoped to the authenticated student
  const order = await Order.findOne({ _id: orderId, student: req.user._id })
  if (!order) throw new ApiError(404, 'Order not found')

  // 2. Idempotency — already paid (by webhook or a previous /verify call)?
  //    Return success with the existing transactionId. NOT a 409, because
  //    the payment genuinely succeeded and the frontend should proceed to
  //    the success page, not show an error.
  if (order.status === 'paid') {
    return res.json({
      success: true,
      transactionId: order.transactionId,
      orderId: order._id,
      idempotent: true,
    })
  }

  // 3. Defence layer 1 — razorpayOrderId must match what's on our Order
  if (order.razorpayOrderId !== razorpayOrderId) {
    order.status = 'failed'
    order.razorpayPaymentId = razorpayPaymentId
    order.razorpaySignature = razorpaySignature
    order.failureReason = 'razorpayOrderId mismatch — supplied ID does not match order'
    await order.save()
    throw new ApiError(400, 'Order ID mismatch')
  }

  // 4. Defence layer 2 — HMAC-SHA256 signature verification (timing-safe)
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex')

  if (!safeCompare(expectedSignature, razorpaySignature)) {
    order.status = 'failed'
    order.razorpayPaymentId = razorpayPaymentId
    order.razorpaySignature = razorpaySignature // save bad signature for forensics
    order.failureReason = 'Invalid signature — possible tampering attempt'
    await order.save()
    throw new ApiError(400, 'Payment signature verification failed')
  }

  // 5. Defence layer 3a — fetch the payment from Razorpay and confirm captured
  let payment
  try {
    payment = await getRazorpayClient().payments.fetch(razorpayPaymentId)
  } catch (err) {
    order.status = 'failed'
    order.razorpayPaymentId = razorpayPaymentId
    order.razorpaySignature = razorpaySignature
    order.failureReason = `Razorpay fetch failed: ${
      err?.error?.description || err?.message || 'Unknown gateway error'
    }`
    await order.save()
    throw new ApiError(
      502,
      `Could not verify payment with gateway: ${
        err?.error?.description || err?.message || 'Unknown error'
      }`,
    )
  }

  if (payment.status !== 'captured') {
    order.status = 'failed'
    order.razorpayPaymentId = razorpayPaymentId
    order.razorpaySignature = razorpaySignature
    order.failureReason = `Gateway payment status: ${payment.status}${
      payment.error_description ? ` — ${payment.error_description}` : ''
    }`
    await order.save()
    throw new ApiError(400, `Payment not captured (gateway status: ${payment.status})`)
  }

  // 6. Defence layer 3b — captured amount must match what we asked for
  if (payment.amount !== order.amount) {
    order.status = 'failed'
    order.razorpayPaymentId = razorpayPaymentId
    order.razorpaySignature = razorpaySignature
    order.failureReason = `Amount mismatch: expected ${order.amount} paise, gateway reports ${payment.amount} paise`
    await order.save()
    throw new ApiError(400, 'Payment amount mismatch')
  }

  // 7. Atomically enroll the student — all writes in one Mongo transaction.
  //    Re-fetch the order inside the transaction to defend against a concurrent
  //    request (webhook + /verify race, or user double-clicking Pay).
  const session = await mongoose.startSession()
  let finalTransactionId
  let didEnroll = false
  try {
    await session.withTransaction(async () => {
      const freshOrder = await Order.findById(order._id).session(session)
      if (!freshOrder) throw new ApiError(404, 'Order not found')

      // Concurrent request already completed this order — return its txn ID
      if (freshOrder.status === 'paid') {
        finalTransactionId = freshOrder.transactionId
        return
      }

      // Set the success state + gateway fields on the order
      freshOrder.status = 'paid'
      freshOrder.razorpayPaymentId = razorpayPaymentId
      freshOrder.razorpaySignature = razorpaySignature
      freshOrder.transactionId = 'eduzyra_' + crypto.randomBytes(8).toString('hex')

      // Delegate the save + enrollment writes to the shared helper
      const result = await enrollStudent(freshOrder, session)
      didEnroll = result?.enrolled === true

      finalTransactionId = freshOrder.transactionId
    })
  } finally {
    session.endSession()
  }

  // 8. Send emails AFTER the transaction commits (non-blocking).
  //    Only send if this call actually created the enrollment (not idempotent
  //    repeat). The user + course are fetched outside the txn — these reads
  //    are non-critical and don't need to be in the transaction.
  if (didEnroll) {
    const [user, course] = await Promise.all([
      User.findById(order.student).select('name email'),
      Course.findById(order.course).select('title slug'),
    ])
    if (user && course) {
      // Fire-and-forget — don't block the response on email delivery
      const paidOrder = { amount: order.amount, transactionId: finalTransactionId }
      sendEnrollmentEmails(paidOrder, user, course).catch(() => {})
    }
  }

  // 9. Respond to the frontend
  res.json({
    success: true,
    transactionId: finalTransactionId,
    orderId: order._id,
  })
})

// ── POST /api/payments/webhook ───────────────────────────────────────────
// Razorpay webhook receiver. NO auth middleware — the webhook is
// authenticated via the HMAC signature in the x-razorpay-signature header.
//
// ⚠️ REQUIRES app.js to capture the raw request body for signature
// verification. Add to app.js BEFORE express.json():
//
//   app.use('/api/payments/webhook', express.raw({ type: 'application/json' }))
//
// Or globally with express.json:
//
//   app.use(express.json({
//     verify: (req, res, buf) => { req.rawBody = buf }
//   }))
//
// Events handled:
//   payment.captured   → mark order 'paid', enroll student (idempotent)
//   payment.failed     → mark order 'failed', save failureReason
//   refund.processed   → mark order 'refunded', save refundId + refundedAmount
//
// All other events are acknowledged with { received: true, ignored: true }
// so Razorpay doesn't retry them.
//
// Idempotency: safe to receive the same webhook multiple times. Each
// handler checks the current order status before mutating.
export const razorpayWebhook = asyncHandler(async (req, res) => {
  // 1. Read the webhook signature from the header
  const signature = req.headers['x-razorpay-signature']
  if (!signature) {
    return res
      .status(400)
      .json({ success: false, message: 'Missing x-razorpay-signature header' })
  }

  // 2. Get the raw body Buffer. express.raw() in app.js populates req.body
  //    with a Buffer (NOT parsed JSON) for this route. We use it directly
  //    for HMAC verification, then parse it locally for event dispatch.
  const rawBody = req.body
  if (!Buffer.isBuffer(rawBody)) {
    console.error(
      '[webhook] req.body is not a Buffer — configure express.raw() ' +
        'in app.js for /api/payments/webhook',
    )
    return res.status(500).json({
      success: false,
      message: 'Server misconfiguration: raw body not captured',
    })
  }

  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('[webhook] RAZORPAY_WEBHOOK_SECRET is not set in .env')
    return res.status(500).json({
      success: false,
      message: 'Server misconfiguration: webhook secret not set',
    })
  }

  // 3. HMAC-SHA256 verify the signature against the raw body
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')

  if (!safeCompare(expectedSignature, signature)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid webhook signature',
    })
  }

  // 4. Parse the JSON payload locally (signature is already verified)
  let payload
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return res
      .status(400)
      .json({ success: false, message: 'Invalid JSON in webhook body' })
  }

  // 5. Read the event and dispatch
  const event = payload?.event
  if (!event) {
    return res.status(200).json({ ignored: true })
  }

  // 6. Find our order based on the event type
  //    - payment.* events → find by razorpayOrderId (from payment.order_id)
  //    - refund.processed → find by razorpayPaymentId (from refund.payment_id)
  let order

  if (event === 'refund.processed') {
    const refund = payload?.payload?.refund?.entity
    if (!refund || !refund.payment_id) {
      return res.status(200).json({ ignored: true })
    }
    order = await Order.findOne({ razorpayPaymentId: refund.payment_id })
  } else {
    // payment.captured, payment.failed, and any other payment.* events
    const paymentEntity = payload?.payload?.payment?.entity
    if (!paymentEntity || !paymentEntity.order_id) {
      return res.status(200).json({ ignored: true })
    }
    order = await Order.findOne({ razorpayOrderId: paymentEntity.order_id })
  }

  // 7. Unknown Razorpay order — not ours, acknowledge and ignore
  if (!order) {
    return res.status(200).json({ ignored: true })
  }

  // 8. Dispatch to the appropriate handler
  switch (event) {
    // ── payment.captured ──────────────────────────────────────────────────
    // Mark the order as paid and enroll the student. Uses the SAME
    // enrollStudent() helper as verifyPayment() so behavior is identical
    // regardless of which path fires.
    case 'payment.captured': {
      const paymentEntity = payload.payload.payment.entity

      // Idempotency — already paid (by /verify or a previous webhook delivery)
      if (order.status === 'paid') {
        return res.status(200).json({ received: true, idempotent: true })
      }

      // Don't downgrade from 'refunded' (edge case: refund processed
      // before capture webhook arrived — shouldn't happen but be safe)
      if (order.status === 'refunded') {
        return res.status(200).json({ received: true, idempotent: true })
      }

      const session = await mongoose.startSession()
      let didEnroll = false
      try {
        await session.withTransaction(async () => {
          // Re-fetch inside the transaction to defend against concurrent
          // webhook deliveries or a /verify call racing with us
          const freshOrder = await Order.findById(order._id).session(session)
          if (!freshOrder) return

          // Double-check inside the transaction — another request may have
          // flipped the status between our check above and the transaction start
          if (freshOrder.status === 'paid' || freshOrder.status === 'refunded') {
            return
          }

          // Set the success state + gateway fields
          freshOrder.status = 'paid'
          if (paymentEntity.id && !freshOrder.razorpayPaymentId) {
            freshOrder.razorpayPaymentId = paymentEntity.id
          }
          if (!freshOrder.transactionId) {
            freshOrder.transactionId = 'eduzyra_' + crypto.randomBytes(8).toString('hex')
          }

          // Delegate save + enrollment to the shared helper
          const result = await enrollStudent(freshOrder, session)
          didEnroll = result?.enrolled === true
        })
      } finally {
        session.endSession()
      }

      // Send emails after transaction commits (non-blocking, fire-and-forget)
      if (didEnroll) {
        try {
          // Re-fetch the order to get the transactionId set inside the transaction
          const updatedOrder = await Order.findById(order._id).select('amount transactionId')
          const [user, course] = await Promise.all([
            User.findById(order.student).select('name email'),
            Course.findById(order.course).select('title slug'),
          ])
          if (user && course && updatedOrder) {
            const paidOrder = { amount: updatedOrder.amount, transactionId: updatedOrder.transactionId }
            sendEnrollmentEmails(paidOrder, user, course).catch(() => {})
          }
        } catch (err) {
          console.error('[webhook payment.captured] email send failed:', err?.message || err)
        }
      }
      break
    }

    // ── payment.failed ────────────────────────────────────────────────────
    // Mark the order as failed. Only update if the order is still in a
    // pre-payment state ('created' or 'pending') — don't downgrade from
    // 'paid' or 'refunded'.
    case 'payment.failed': {
      const paymentEntity = payload.payload.payment.entity

      // Idempotency + state guard — don't downgrade a paid/refunded order
      if (order.status === 'paid' || order.status === 'refunded' || order.status === 'failed') {
        return res.status(200).json({ received: true, idempotent: true })
      }

      order.status = 'failed'
      if (paymentEntity.id && !order.razorpayPaymentId) {
        order.razorpayPaymentId = paymentEntity.id
      }
      order.failureReason =
        paymentEntity.error_description ||
        `Payment failed (gateway status: ${paymentEntity.status || 'unknown'})`
      await order.save()
      break
    }

    // ── refund.processed ──────────────────────────────────────────────────
    // Mark the order as refunded. Accumulates refundedAmount in case of
    // multiple partial refunds.
    //
    // CRITICAL: We acknowledge the webhook FIRST (before any DB writes) so
    // that Razorpay doesn't retry on a 500 caused by a Mongoose validation
    // race (e.g., refundId missing at the moment the pre-validate hook runs).
    // The DB update is fire-and-forget — it logs errors but never throws.
    case 'refund.processed': {
      // Acknowledge FIRST — Razorpay only cares about receipt, not about our DB write.
      // Responding before the DB update prevents Razorpay from retrying on a 500.
      res.status(200).json({ received: true })

      // Update the order asynchronously (best-effort, non-blocking)
      ;(async () => {
        try {
          const refund = payload.payload.refund.entity
          if (!refund?.id || !refund?.payment_id) return

          const o = await Order.findOne({ razorpayPaymentId: refund.payment_id })
          if (!o) return

          const refundAmountPaise = refund.amount || 0
          o.refundedAmount = (o.refundedAmount || 0) + refundAmountPaise
          o.status = 'refunded'
          o.refundId = refund.id
          if (refund.notes?.reason && !o.refundReason) o.refundReason = refund.notes.reason
          await o.save()
        } catch (err) {
          console.error('[webhook refund.processed] DB update failed:', err?.message || err)
        }
      })()

      return // response already sent
    }

    // ── Unhandled event type ─────────────────────────────────────────────
    // Acknowledge so Razorpay doesn't retry, but don't process.
    default:
      return res.status(200).json({
        received: true,
        ignored: true,
        event,
      })
  }

  // 9. Acknowledge successful processing (only if response hasn't been sent yet)
  if (!res.headersSent) {
    return res.status(200).json({ received: true })
  }
})

// ── GET /api/payments/me — order history for the logged-in student ───────
export const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ student: req.user._id }).populate('course').sort({ createdAt: -1 })
  res.json(orders)
})

// ── GET /api/payments/all — admin: all orders with student+course populated ─
export const getAllOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({})
    .populate('student', 'name email')
    .populate('course', 'title')
    .sort({ createdAt: -1 })
    .lean()

  const rows = orders.map((o) => ({
    _id: String(o._id),
    id: o.transactionId || '—',
    student: o.student?.name || 'Unknown',
    studentEmail: o.student?.email || '',
    course: o.course?.title || 'Unknown',
    amount: o.amount,
    status: o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : 'Created',
    date: o.createdAt.toISOString().slice(0, 10),
  }))
  res.json(rows)
})

// ── POST /api/payments/:orderId/refund — admin only ──────────────────────
// Issues a refund via Razorpay for a paid order. Supports full or partial
// refunds. The Order model's pre-save hook auto-stamps `refundedAt` when
// `refundedAmount` transitions from 0 to > 0 — no manual timestamp needed here.
//
// Body:  { amount?, reason? }
//   - amount (paise) — optional, defaults to order.amount (full refund)
//   - reason         — optional, free-text reason stored on the order
//
// Returns: { success: true, refundId, refundedAmount }
//
// Duplicate refund protection:
//   1. Pre-flight check: if status !== 'paid' (already refunded/failed/etc.),
//      reject with 400 BEFORE calling Razorpay.
//   2. In-flight race protection: wrap the read-check-refund-write in a Mongo
//      transaction. Re-fetch the order inside the txn and re-check status.
//      If a concurrent request already flipped it to 'refunded', abort.
export const refundOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params
  const { amount, reason } = req.validatedBody || req.body || {}

  // 1. Find the order
  const order = await Order.findById(orderId)
  if (!order) throw new ApiError(404, 'Order not found')

  // 2. Pre-flight status check — only 'paid' orders can be refunded.
  //    This catches the common case (sequential duplicate refund attempt)
  //    BEFORE we open a transaction or call Razorpay.
  if (order.status !== 'paid') {
    throw new ApiError(
      400,
      `Order cannot be refunded (current status: ${order.status}). Only 'paid' orders can be refunded.`,
    )
  }

  // 3. Must have a Razorpay payment ID to issue a refund
  if (!order.razorpayPaymentId) {
    throw new ApiError(400, 'Order has no razorpayPaymentId — cannot issue refund via gateway')
  }

  // 4. Validate amount: default to full refund, must not exceed order.amount
  const refundAmountPaise = Math.round(Number(amount)) || order.amount
  if (!Number.isInteger(refundAmountPaise) || refundAmountPaise <= 0) {
    throw new ApiError(400, 'amount must be a positive integer (paise)')
  }
  if (refundAmountPaise > order.amount) {
    throw new ApiError(
      400,
      `Refund amount (${refundAmountPaise} paise) cannot exceed order amount (${order.amount} paise)`,
    )
  }

  // 5. Call Razorpay to issue the refund.
  //    NOTE: We call Razorpay BEFORE the transaction because the gateway call
  //    is slow (network I/O) and we don't want to hold a Mongo transaction
  //    open for seconds. The transaction below re-checks status to defend
  //    against a concurrent refund request that completed while we were
  //    waiting on Razorpay.
  let refund
  try {
    refund = await getRazorpayClient().payments.refund(order.razorpayPaymentId, {
      amount: refundAmountPaise,
      notes: reason ? { reason } : undefined,
    })
  } catch (err) {
    throw new ApiError(
      502,
      `Razorpay refund failed: ${err?.error?.description || err?.message || 'Unknown gateway error'}`,
    )
  }

  // 6. Atomically update the order inside a Mongo transaction.
  //    Re-fetch inside the txn and re-check status — if a concurrent refund
  //    request already marked it 'refunded', we don't overwrite its refundId
  //    or refundedAmount. (The Razorpay refund we just issued will still be
  //    reconciled by the refund.processed webhook, which accumulates
  //    refundedAmount idempotently.)
  const session = await mongoose.startSession()
  let savedRefundId = refund.id
  let savedRefundedAmount = refund.amount
  try {
    await session.withTransaction(async () => {
      const freshOrder = await Order.findById(order._id).session(session)
      if (!freshOrder) throw new ApiError(404, 'Order not found')

      // Concurrent refund already updated this order — don't overwrite.
      // Return the existing refundId/refundedAmount so the response is accurate.
      if (freshOrder.status === 'refunded') {
        savedRefundId = freshOrder.refundId
        savedRefundedAmount = freshOrder.refundedAmount
        return
      }

      // If the status flipped to something unexpected (failed, created),
      // don't mark it refunded — the webhook will reconcile.
      if (freshOrder.status !== 'paid') {
        return
      }

      freshOrder.refundId = refund.id
      freshOrder.refundedAmount = refund.amount // paise, from gateway response
      if (reason) freshOrder.refundReason = reason
      freshOrder.status = 'refunded'
      await freshOrder.save({ session })
    })
  } finally {
    session.endSession()
  }

  res.json({
    success: true,
    refundId: savedRefundId,
    refundedAmount: savedRefundedAmount,
  })

  // Send refund email AFTER the response is sent (non-blocking, fire-and-forget).
  // Fetch user + course for the email context.
  try {
    const [user, course] = await Promise.all([
      User.findById(order.student).select('name email'),
      Course.findById(order.course).select('title'),
    ])
    if (user && course) {
      sendRefundEmail({
        name: user.name,
        email: user.email,
        courseTitle: course.title,
        amount: savedRefundedAmount, // paise — emailService formats it
        refundId: savedRefundId,
      }).catch((err) => {
        console.error('[refundOrder] refund email failed:', err?.message || err)
      })

      // Create in-app notification (fire-and-forget)
      createNotification(order.student, {
        type: 'refund',
        title: 'Refund processed',
        body: `A refund of ₹${Math.round(savedRefundedAmount / 100)} for "${course.title}" has been processed.`,
        link: '/profile',
      }).catch(() => {})
    }
  } catch (err) {
    console.error('[refundOrder] email context fetch failed:', err?.message || err)
  }
})
