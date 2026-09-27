import Notification from '../models/Notification.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { ApiError } from '../utils/ApiError.js'

/**
 * notificationController — CRUD for in-app notifications.
 *
 * All routes are protected (require a valid JWT). Notifications are scoped
 * to req.user._id — a user can only see/modify their own notifications.
 */

// GET /api/notifications — latest 50, newest first
export const getMyNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()

  const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false })

  res.json({ notifications, unreadCount })
})

// PATCH /api/notifications/:id/read — mark one as read
export const markRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { read: true },
    { new: true },
  )
  if (!notification) throw new ApiError(404, 'Notification not found')
  res.json(notification)
})

// PATCH /api/notifications/read-all — mark all as read
export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { user: req.user._id, read: false },
    { read: true },
  )
  res.json({ success: true })
})

// DELETE /api/notifications/:id — delete one
export const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    user: req.user._id,
  })
  if (!notification) throw new ApiError(404, 'Notification not found')
  res.json({ success: true })
})
