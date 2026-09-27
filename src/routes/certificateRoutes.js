import { Router } from 'express'
import { issueCertificate, verifyCertificate, getMyCertificates, getAllCertificates } from '../controllers/certificateController.js'
import { protect, requireRole } from '../middleware/auth.js'
import { validate, issueCertificateSchema } from '../validators/index.js'

const router = Router()

router.get('/mine', protect, getMyCertificates)
router.get('/admin/all', protect, requireRole('admin'), getAllCertificates)
router.get('/:id', verifyCertificate) // public — certificate verification page
router.post('/', protect, validate(issueCertificateSchema), issueCertificate)

export default router
