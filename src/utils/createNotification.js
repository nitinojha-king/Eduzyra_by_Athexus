import Notification from '../models/Notification.js'
import logger from './logger.js'

/**
 * createNotification — fire-and-forget helper.
 *
 * Called from other controllers to create an in-app notification for a user.
 * NEVER throws — if notification creation fails, log the error and continue.
 * The main operation (payment, enrollment, etc.) must not be blocked by a
 * notification failure.
 *
 * @param {string} userId — ObjectId of the target user
 * @param {Object} data
 * @param {string} data.type — 'enrollment' | 'payment' | 'refund' | 'certificate' | 'coupon' | 'feedback' | 'system'
 * @param {string} data.title — short headline
 * @param {string} data.body — longer description
 * @param {string} [data.link] — optional frontend route to navigate to on click
 */
export async function createNotification(userId, { type, title, body, link }) {
  try {
    if (!userId || !title || !body) return
    await Notification.create({
      user: userId,
      type: type || 'system',
      title,
      body,
      link: link || '',
    })
  } catch (err) {
    logger.error('Failed to create notification', {
      userId: String(userId),
      title,
      error: err?.message || String(err),
    })
    // never throw — notifications must not block the main operation
  }
}
