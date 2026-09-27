import mongoose from 'mongoose'

/**
 * Notification — in-app notifications for each user.
 *
 * Stored in MongoDB (not just a transient toast). This lets us show a bell
 * icon in the navbar with an unread count, and a dropdown of recent
 * notifications when clicked.
 *
 * Lifecycle:
 *   - Created by `createNotification()` helper (called from other controllers)
 *   - Listed by `GET /api/notifications` (latest 50)
 *   - Marked read by `PATCH /api/notifications/:id/read`
 *   - Marked all read by `PATCH /api/notifications/read-all`
 *   - Deleted by `DELETE /api/notifications/:id`
 */
const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['enrollment', 'payment', 'refund', 'certificate', 'coupon', 'feedback', 'system'],
      required: true,
      default: 'system',
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    read: { type: Boolean, default: false, index: true },
    link: { type: String, default: '' }, // frontend route to navigate to on click
  },
  { timestamps: true },
)

// ── Indexes (Phase 11) ────────────────────────────────────────────────────
// For the "unread count" query: { user, read: false }
notificationSchema.index({ user: 1, read: 1 })
// For the "list latest 50" query: { user } sorted by createdAt desc
notificationSchema.index({ user: 1, createdAt: -1 })

export default mongoose.model('Notification', notificationSchema)
