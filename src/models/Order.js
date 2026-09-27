import mongoose from 'mongoose'

/**
 * Order
 * -----
 * Represents a payment intent for a course enrollment.
 *
 * Lifecycle:
 *   created   → Order row created in DB, Razorpay order created (razorpayOrderId set)
 *   pending   → Razorpay Checkout modal opened, awaiting user action
 *   paid      → Payment captured by Razorpay, signature verified, student enrolled
 *   failed    → Payment failed (card declined, insufficient funds, signature mismatch, etc.)
 *   refunded  → Admin issued a full or partial refund via Razorpay
 *
 * ── Money is stored in PAISE (1 INR = 100 paise) ──
 * Razorpay requires amounts in the smallest currency unit. Storing in paise
 * here avoids rounding bugs and keeps the DB consistent with the gateway.
 * Convert to rupees for display: amount / 100.
 *
 * Note: Course.price is still in RUPEES (human-readable). The payment
 * controller converts: amount_paise = (course.price - discount_rupees) * 100.
 *
 * The `transactionId` is our internal ID, set ONLY after paid payment.
 * It has a SPARSE UNIQUE index so multiple unpaid orders (transactionId = null)
 * can coexist, but paid orders cannot have duplicate transaction IDs.
 */

const { Schema, model } = mongoose

const orderSchema = new Schema(
  {
    // ── Relations ────────────────────────────────────────────────────────
    student: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student is required'],
      index: true,
    },
    course: {
      type: Schema.Types.ObjectId,
      ref: 'Course',
      required: [true, 'Course is required'],
      index: true,
    },

    // ── Money (all amounts in PAISE — integer, non-negative) ────────────
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Amount must be an integer (paise) — no fractional paise',
      },
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
      trim: true,
      enum: {
        values: ['INR', 'USD', 'EUR', 'GBP'],
        message: 'Currency must be one of INR, USD, EUR, GBP',
      },
    },
    couponCode: {
      type: String,
      uppercase: true,
      trim: true,
      sparse: true,
    },
    discount: {
      // Discount applied to THIS order, in paise. Captured at order-creation
      // time so that future coupon edits do not retroactively change history.
      type: Number,
      default: 0,
      min: [0, 'Discount cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Discount must be an integer (paise)',
      },
    },

    // ── Status & failure tracking ───────────────────────────────────────
    status: {
      type: String,
      enum: {
        values: ['created', 'pending', 'paid', 'failed', 'refunded'],
        message: 'Status must be one of: created, pending, paid, failed, refunded',
      },
      default: 'created',
      index: true,
    },
    failureReason: {
      // Captured from the gateway (e.g. 'card_declined', 'insufficient_funds',
      // 'invalid_signature') or from our own validation. Surfaced to the user
      // on the PaymentFailed page so they know what went wrong.
      type: String,
      trim: true,
      maxlength: [500, 'failureReason cannot exceed 500 characters'],
    },

    // ── Razorpay gateway fields ─────────────────────────────────────────
    razorpayOrderId: {
      // Returned by razorpay.orders.create() — the ID of the order on Razorpay's side.
      // Used to open the Checkout modal and to correlate webhook events.
      type: String,
      trim: true,
      index: { sparse: true }, // unpaid orders won't have one yet
    },
    razorpayPaymentId: {
      // Returned by Razorpay after the user pays (pay_xxx).
      // Used to fetch payment details, issue refunds, and reconcile webhooks.
      type: String,
      trim: true,
      index: { sparse: true },
    },
    razorpaySignature: {
      // HMAC-SHA256(razorpayOrderId + '|' + razorpayPaymentId, RAZORPAY_KEY_SECRET)
      // Verified server-side in /api/payments/verify.
      // Stored for audit trail — NEVER returned in API responses (see toJSON).
      type: String,
      select: false, // excluded from queries by default; use .select('+razorpaySignature') when needed
    },

    // ── Internal transaction ID ─────────────────────────────────────────
    // Set ONLY after paid payment + signature verification.
    // Format: eduzyra_<16 hex chars>  (crypto.randomBytes(8).toString('hex'))
    // Exposed to the user as their "transaction ID" on receipts & certificate pages.
    transactionId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true, // allows many unpaid orders with null transactionId
    },

    // ── Refund fields ───────────────────────────────────────────────────
    refundId: {
      // Razorpay refund ID (rfd_xxx). Set when an admin issues a refund via
      // POST /api/payments/:orderId/refund → razorpay.payments.refund().
      type: String,
      trim: true,
      index: { sparse: true },
    },
    refundedAmount: {
      // Amount refunded, in paise. Can be partial (e.g. 50% refund).
      // Must satisfy: 0 <= refundedAmount <= amount.
      type: Number,
      default: 0,
      min: [0, 'Refunded amount cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Refunded amount must be an integer (paise)',
      },
    },
    refundReason: {
      // Free-text reason captured at refund time. Required if refundedAmount > 0.
      type: String,
      trim: true,
      maxlength: [500, 'Refund reason cannot exceed 500 characters'],
    },
    refundedAt: {
      // Set automatically when refundedAmount transitions from 0 to > 0.
      type: Date,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
    toJSON: {
      virtuals: true,
      transform: function (_doc, ret) {
        // Never leak the signature or internal version key to API consumers.
        delete ret.razorpaySignature
        delete ret.__v
        return ret
      },
    },
    toObject: { virtuals: true },
  },
)

// ── Compound indexes for production query patterns ──────────────────────
orderSchema.index({ student: 1, createdAt: -1 }, {
  name: 'idx_student_history',
}) // GET /api/payments/me  (user's order history, newest first)

orderSchema.index({ course: 1, status: 1 }, {
  name: 'idx_course_revenue',
}) // Admin: per-course revenue, paid-purchase counts

orderSchema.index({ status: 1, createdAt: -1 }, {
  name: 'idx_admin_dashboard',
}) // GET /api/payments/all  (admin dashboard with filters)

// ── Virtuals (read-only convenience getters; not persisted) ─────────────
orderSchema.virtual('amountInRupees').get(function () {
  return (this.amount ?? 0) / 100
})

orderSchema.virtual('discountInRupees').get(function () {
  return (this.discount ?? 0) / 100
})

orderSchema.virtual('refundedAmountInRupees').get(function () {
  return (this.refundedAmount ?? 0) / 100
})

// Net amount the platform actually retained after refunds.
orderSchema.virtual('netPaidInRupees').get(function () {
  return ((this.amount ?? 0) - (this.refundedAmount ?? 0)) / 100
})

orderSchema.virtual('isPaid').get(function () {
  return this.status === 'paid'
})

orderSchema.virtual('isRefunded').get(function () {
  return this.status === 'refunded' || (this.refundedAmount ?? 0) > 0
})

orderSchema.virtual('isFullyRefunded').get(function () {
  return (this.refundedAmount ?? 0) >= (this.amount ?? 0) && (this.amount ?? 0) > 0
})

// ── Pre-validate hook: refund consistency ───────────────────────────────
orderSchema.pre('validate', function (next) {
  // If any money was refunded, we must have a gateway refund ID
  if ((this.refundedAmount ?? 0) > 0 && !this.refundId) {
    this.invalidate('refundId', 'refundId is required when refundedAmount > 0')
  }
  // Refunded amount cannot exceed the original charge
  if ((this.refundedAmount ?? 0) > (this.amount ?? 0)) {
    this.invalidate('refundedAmount', 'refundedAmount cannot exceed amount')
  }
  // If status is 'refunded', refundId must be set
  if (this.status === 'refunded' && !this.refundId) {
    this.invalidate('refundId', 'refundId is required when status is refunded')
  }
  // Status 'refunded' requires a positive refundedAmount
  if (this.status === 'refunded' && (this.refundedAmount ?? 0) <= 0) {
    this.invalidate('refundedAmount', 'refundedAmount must be > 0 when status is refunded')
  }
  // Discount cannot exceed the gross amount (amount + discount = original price)
  // i.e. original price = amount + discount, so discount alone can be any value
  // as long as amount >= 0. No additional constraint needed here.
  next()
})

// ── Pre-save hook: auto-stamp refundedAt ────────────────────────────────
orderSchema.pre('save', function (next) {
  // First time refundedAmount goes above 0, stamp the timestamp
  if (
    this.isModified('refundedAmount') &&
    (this.refundedAmount ?? 0) > 0 &&
    !this.refundedAt
  ) {
    this.refundedAt = new Date()
  }
  next()
})

export default model('Order', orderSchema)
