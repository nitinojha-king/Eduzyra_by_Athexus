import multer from 'multer'

/**
 * Multer middleware configurations — all use memory storage.
 *
 * Memory storage is used (not disk) so we can pass the buffer directly to
 * Cloudinary without writing to disk. The buffer is available on
 * `req.file.buffer`.
 *
 * Three presets:
 *   - profileUpload   — avatar images, 5MB max, images only
 *   - thumbnailUpload — course thumbnails, 10MB max, images only
 *   - pdfUpload       — PDF files (assignments/notes), 20MB max, PDF only
 */

const memoryStorage = multer.memoryStorage()

/** Image MIME types allowed for avatar + thumbnail uploads. */
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/** File filter for image-only uploads. */
function imageFileFilter(req, file, cb) {
  if (IMAGE_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('Only image files (JPEG, PNG, WebP, GIF) are allowed'), false)
  }
}

/** File filter for PDF-only uploads. */
function pdfFileFilter(req, file, cb) {
  if (file.mimetype === 'application/pdf') {
    cb(null, true)
  } else {
    cb(new Error('Only PDF files are allowed'), false)
  }
}

/** Avatar upload — single file, field name 'avatar', 5MB max, images only. */
export const profileUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: imageFileFilter,
}).single('avatar')

/** Course thumbnail upload — single file, field name 'thumbnail', 10MB max, images only. */
export const thumbnailUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: imageFileFilter,
}).single('thumbnail')

/** PDF upload — single file, field name 'file', 20MB max, PDF only. */
export const pdfUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: pdfFileFilter,
}).single('file')
