import mongoose from 'mongoose'


const certificateSchema = new mongoose.Schema(
  {
    certificateId: { type: String, required: true, unique: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    studentName: { type: String, required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    courseTitle: { type: String, required: true },
    issuedOn: { type: String, required: true }, 
  },
  { timestamps: true },
)

certificateSchema.index({ student: 1, course: 1 })

certificateSchema.virtual('id').get(function () {
  return this.certificateId
})

certificateSchema.set('toJSON', { virtuals: true })
certificateSchema.set('toObject', { virtuals: true })

export default mongoose.model('Certificate', certificateSchema)