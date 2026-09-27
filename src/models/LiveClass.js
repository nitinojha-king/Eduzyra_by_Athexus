import mongoose from 'mongoose'

/**
 * LiveClass — a scheduled live lecture within a course.
 *
 * Live lectures are delivered by embedding an instructor-provided stream URL
 * (YouTube Live, Jitsi Meet, Zoom, or an HLS/.m3u8 stream). The backend manages
 * scheduling, lifecycle status, and attendance tracking — it does NOT host
 * WebRTC/signaling. The frontend embeds `streamUrl` in the live lesson player.
 *
 * Status lifecycle:
 *   scheduled → live (instructor starts) → ended (instructor ends or endAt passes)
 * `isLive` is a derived helper meaning status === 'live'.
 */
const attendeeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, default: '' },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date },
    durationSeconds: { type: Number, default: 0 },
  },
  { _id: false },
)

const liveClassSchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    instructor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    // Scheduling
    startsAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 1, default: 60 },
    endsAt: { type: Date },

    // Delivery — embed source
    streamUrl: { type: String, default: '' },   // YouTube Live / Jitsi / Zoom iframe
    streamType: { type: String, enum: ['youtube', 'jitsi', 'zoom', 'hls', 'other'], default: 'youtube' },

    // ── LiveSession contract (Google Meet first) ─────────────────────────
    // `meetingUrl` is the canonical join link exposed via /api/live-sessions.
    // Kept in sync with legacy `streamUrl` so old clients keep working.
    meetingProvider: { type: String, enum: ['GOOGLE_MEET', 'ZOOM', 'OTHER'], default: 'GOOGLE_MEET' },
    meetingUrl: { type: String, default: '', trim: true },
    scheduledStartAt: { type: Date },
    scheduledEndAt: { type: Date },

    status: { type: String, enum: ['scheduled', 'live', 'ended', 'cancelled'], default: 'scheduled' },
    startedAt: { type: Date },
    endedAt: { type: Date },

    attendees: { type: [attendeeSchema], default: [] },
    maxAttendees: { type: Number, default: 0 }, // 0 = unlimited

    recordingUrl: { type: String, default: '' }, // optional post-session replay
  },
  { timestamps: true },
)

// Derived helpers exposed as virtuals so the API can reliably read state.
liveClassSchema.virtual('isLive').get(function () {
  return this.status === 'live'
})

liveClassSchema.virtual('attendeeCount').get(function () {
  return this.attendees.length
})

liveClassSchema.set('toJSON', { virtuals: true })
liveClassSchema.set('toObject', { virtuals: true })

// Keep LiveSession aliases in sync with legacy fields before validation.
liveClassSchema.pre('validate', function syncLiveSessionFields(next) {
  if (this.meetingUrl && !this.streamUrl) this.streamUrl = this.meetingUrl
  if (this.streamUrl && !this.meetingUrl) this.meetingUrl = this.streamUrl
  if (this.scheduledStartAt && !this.startsAt) this.startsAt = this.scheduledStartAt
  if (this.startsAt && !this.scheduledStartAt) this.scheduledStartAt = this.startsAt
  if (this.scheduledEndAt && !this.endsAt) this.endsAt = this.scheduledEndAt
  if (this.endsAt && !this.scheduledEndAt) this.scheduledEndAt = this.endsAt
  // Map meetingProvider -> legacy streamType when provider is explicit.
  if (this.isModified('meetingProvider')) {
    if (this.meetingProvider === 'ZOOM') this.streamType = 'zoom'
    else if (this.meetingProvider === 'OTHER') this.streamType = 'other'
  }
  next()
})

// Indexes for the common dashboard queries: upcoming lectures by course, and
// active/upcoming lectures for the "join now" list.
liveClassSchema.index({ course: 1, startsAt: 1 })
liveClassSchema.index({ status: 1, startsAt: 1 })
liveClassSchema.index({ course: 1, scheduledStartAt: 1 })

export default mongoose.model('LiveClass', liveClassSchema)
