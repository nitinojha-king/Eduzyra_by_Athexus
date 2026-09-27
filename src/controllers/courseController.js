import Course from '../models/Course.js'
import { ApiError } from '../utils/ApiError.js'
import { asyncHandler } from '../utils/asyncHandler.js'

// GET /api/courses?category=&query=&level=&minPrice=&maxPrice=&sortBy=&page=&limit=
// Supports pagination, sorting, and filtering by category / level / price range.
// Returns: { courses: [...], total, page, pages }
export const getCourses = asyncHandler(async (req, res) => {
  const {
    category = 'All',
    query = '',
    level = '',
    minPrice,
    maxPrice,
    sortBy = 'newest',
    page = 1,
    limit = 12,
  } = req.query

  // Build the filter — only published courses are visible to the public.
  const filter = { status: 'published' }

  if (category && category !== 'All') {
    filter.category = category
  }

  if (level && ['Beginner', 'Intermediate', 'Advanced'].includes(level)) {
    filter.level = level
  }

  // Price range filter (prices are in rupees on the Course model)
  const priceFilter = {}
  if (minPrice !== undefined && minPrice !== '') {
    const min = Number(minPrice)
    if (!Number.isNaN(min)) priceFilter.$gte = min
  }
  if (maxPrice !== undefined && maxPrice !== '') {
    const max = Number(maxPrice)
    if (!Number.isNaN(max)) priceFilter.$lte = max
  }
  if (Object.keys(priceFilter).length > 0) {
    filter.price = priceFilter
  }

  // Text search (uses the text index on title/instructorName/category)
  if (query.trim()) {
    filter.$text = { $search: query.trim() }
  }

  // Sorting
  const sortOptions = {
    newest: { createdAt: -1 },
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    rating: { rating: -1 },
  }
  const sort = sortOptions[sortBy] || sortOptions.newest

  // Pagination
  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 12))
  const skip = (pageNum - 1) * limitNum

  const [courses, total] = await Promise.all([
    Course.find(filter).sort(sort).skip(skip).limit(limitNum),
    Course.countDocuments(filter),
  ])

  res.json({
    courses,
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum),
  })
})

// GET /api/courses/:id  (id = slug OR 24-char ObjectId hex)
export const getCourseById = asyncHandler(async (req, res) => {
  const course = await Course.findBySlugOrId(req.params.id)
  if (!course) throw new ApiError(404, 'Course not found')
  res.json(course)
})

// POST /api/courses  (instructor/admin only)
export const createCourse = asyncHandler(async (req, res) => {
  const data = req.validatedBody || req.body
  const course = await Course.create({
    ...data,
    instructor: req.user._id,
    instructorName: data.instructorName || req.user.name,
  })
  res.status(201).json(course)
})

// PUT /api/courses/:id  (instructor who owns it, or admin)
export const updateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findBySlugOrId(req.params.id)
  if (!course) throw new ApiError(404, 'Course not found')

  const isOwner = course.instructor && course.instructor.equals(req.user._id)
  if (req.user.role !== 'admin' && !isOwner) {
    throw new ApiError(403, 'You do not have permission to edit this course')
  }

  const data = req.validatedBody || req.body
  // Only allow safe fields to be updated (status replaces the old published boolean)
  const safeFields = ['title', 'category', 'level', 'duration', 'lessons', 'price', 'originalPrice', 'summary', 'outcomes', 'syllabus', 'status', 'instructorName', 'rating']
  for (const field of safeFields) {
    if (data[field] !== undefined) course[field] = data[field]
  }
  await course.save()
  res.json(course)
})

// DELETE /api/courses/:id  (admin, or instructor who owns it)
export const deleteCourse = asyncHandler(async (req, res) => {
  const course = await Course.findBySlugOrId(req.params.id)
  if (!course) throw new ApiError(404, 'Course not found')

  const isOwner = course.instructor && course.instructor.equals(req.user._id)
  if (req.user.role !== 'admin' && !isOwner) {
    throw new ApiError(403, 'You do not have permission to delete this course')
  }

  await Course.deleteOne({ _id: course._id })

  // Delete the course thumbnail from Cloudinary if it exists
  if (course.thumbnailPublicId) {
    try {
      const { deleteFromCloudinary } = await import('../config/cloudinary.js')
      await deleteFromCloudinary(course.thumbnailPublicId)
    } catch (err) {
      console.error('[deleteCourse] Failed to delete thumbnail:', err?.message || err)
    }
  }

  res.json({ message: 'Course deleted' })
})

// POST /api/courses/:id/thumbnail — upload course thumbnail (instructor/admin)
// Multer parses the file into req.file.buffer (memory storage). We compress
// with Sharp to 800x450 (16:9) WebP, upload to Cloudinary, and store the URL
// on the Course. If the course already has a thumbnail, delete the old one.
export const uploadThumbnail = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'No file uploaded. Field name must be "thumbnail".')
  }

  const course = await Course.findBySlugOrId(req.params.id)
  if (!course) throw new ApiError(404, 'Course not found')

  // Ownership check (same as updateCourse)
  const isOwner = course.instructor && course.instructor.equals(req.user._id)
  if (req.user.role !== 'admin' && !isOwner) {
    throw new ApiError(403, 'You do not have permission to edit this course')
  }

  // Lazy-import Sharp
  const sharp = (await import('sharp')).default

  // Compress: 800x450 (16:9), WebP, quality 85
  const compressedBuffer = await sharp(req.file.buffer)
    .resize(800, 450, { fit: 'cover', position: 'center' })
    .webp({ quality: 85 })
    .toBuffer()

  // Lazy-import Cloudinary helper
  const { uploadToCloudinary, deleteFromCloudinary } = await import('../config/cloudinary.js')

  // Delete old thumbnail if it exists
  if (course.thumbnailPublicId) {
    await deleteFromCloudinary(course.thumbnailPublicId)
  }

  // Upload new thumbnail
  const result = await uploadToCloudinary(compressedBuffer, {
    folder: 'eduzyra/thumbnails',
    resource_type: 'image',
  })

  course.thumbnail = result.secure_url
  course.thumbnailPublicId = result.public_id
  await course.save()

  res.json({ thumbnail: course.thumbnail })
})

// GET /api/courses/admin/all — admin only, returns all courses regardless of status
export const getAllCoursesAdmin = asyncHandler(async (req, res) => {
  const courses = await Course.find({}).sort({ createdAt: -1 })
  res.json(courses)
})

// GET /api/courses/mine — instructor/admin, returns all courses (any status)
// created by the authenticated instructor. Instructors must see their draft
// and archived courses too, not just published ones.
export const getInstructorCourses = asyncHandler(async (req, res) => {
  const courses = await Course.find({ instructor: req.user._id }).sort({ createdAt: -1 })
  res.json(courses)
})
