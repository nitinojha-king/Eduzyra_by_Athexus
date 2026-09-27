import { v2 as cloudinary } from 'cloudinary'

/**
 * Cloudinary configuration + helper functions.
 *
 * Reads credentials from env vars:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 * Lazy configuration — the SDK is configured on first use so the app can
 * boot without Cloudinary credentials configured.
 */

let _configured = false

function ensureConfigured() {
  if (_configured) return
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  })
  _configured = true
}

/**
 * Upload a buffer to Cloudinary.
 *
 * @param {Buffer} buffer  - The file buffer (from Multer memory storage)
 * @param {Object} options - { folder: string, resource_type: 'image'|'raw', public_id?: string }
 * @returns {Promise<{ secure_url: string, public_id: string }>}
 */
export async function uploadToCloudinary(buffer, options = {}) {
  ensureConfigured()

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'eduzyra',
        resource_type: options.resource_type || 'image',
        ...(options.public_id ? { public_id: options.public_id } : {}),
      },
      (err, result) => {
        if (err) {
          reject(err)
        } else {
          resolve({
            secure_url: result.secure_url,
            public_id: result.public_id,
          })
        }
      },
    )
    uploadStream.end(buffer)
  })
}

/**
 * Delete an asset from Cloudinary by its public_id.
 * Silently no-ops if publicId is null/undefined (e.g., the resource was
 * never uploaded to Cloudinary in the first place).
 *
 * @param {string|null|undefined} publicId
 * @returns {Promise<void>}
 */
export async function deleteFromCloudinary(publicId) {
  if (!publicId) return
  try {
    ensureConfigured()
    await cloudinary.uploader.destroy(publicId)
  } catch (err) {
    // Log but don't throw — a failed delete should not break the parent operation
    console.error('[cloudinary] Failed to delete asset:', publicId, err?.message || err)
  }
}

export default cloudinary
