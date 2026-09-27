import { Router } from 'express'
import {
  createOrder,
  verifyPayment,
  getMyOrders,
  getAllOrders,
  razorpayWebhook,
  refundOrder,
} from '../controllers/paymentController.js'
import { protect, requireRole } from '../middleware/auth.js'
import { validate, createOrderSchema, verifyPaymentSchema, refundSchema } from '../validators/index.js'

const router = Router()

// ── Webhook (UNAUTHENTICATED) ─────────────────────────────────────────────
// Razorpay webhook receiver. NO protect middleware — the webhook is
// authenticated via the HMAC-SHA256 signature in the x-razorpay-signature
// header, verified inside the controller.
//
// MUST be registered BEFORE router.use(protect) so it bypasses JWT auth.
// Razorpay cannot send a Bearer token with its webhook deliveries.
//
// The raw-body capture middleware is mounted in app.js at:
//   app.use('/api/payments/webhook', express.raw({ type: 'application/json' }))
router.post('/webhook', razorpayWebhook)

// ── Authenticated routes (all routes below require a valid JWT) ──────────
router.use(protect)
router.post('/order', validate(createOrderSchema), createOrder)
router.post('/verify', validate(verifyPaymentSchema), verifyPayment)
router.get('/me', getMyOrders)
router.get('/all', requireRole('admin'), getAllOrders)
router.post('/:orderId/refund', requireRole('admin'), validate(refundSchema), refundOrder)

export default router
