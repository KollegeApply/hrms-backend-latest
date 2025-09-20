const express = require('express');
const router = express.Router();
const multer = require('multer');
const regularizationController = require('../controllers/regularizationController');
const { authenticateUser } = require('../middleware/authMiddleware');
const { authorizeRole } = require('../middleware/authMiddleware');
const { 
  validateCreateRegularization, 
  validateApproveRegularization, 
  validateRejectRegularization 
} = require('../validators/regularizationValidator');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow only specific file types
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, PDF, DOC, and DOCX files are allowed.'), false);
    }
  }
});

// Get regularization limits for user
router.get('/limits', authenticateUser, regularizationController.getRegularizationLimits);

// Create regularization request (all authenticated users)
router.post('/', authenticateUser, upload.single('evidence'), validateCreateRegularization, regularizationController.createRegularization);

// Get all regularization requests (with role-based filtering)
router.get('/', authenticateUser, regularizationController.getRegularizations);

// Get regularization request by ID
router.get('/:id', authenticateUser, regularizationController.getRegularizationById);

// Approve regularization request (Team Lead, HR, Admin)
router.put('/:id/approve', authenticateUser, authorizeRole(['teamlead', 'hr', 'subadmin', 'admin']), validateApproveRegularization, regularizationController.approveRegularization);

// Reject regularization request (Team Lead, HR, Admin)
router.put('/:id/reject', authenticateUser, authorizeRole(['teamlead', 'hr', 'subadmin', 'admin']), validateRejectRegularization, regularizationController.rejectRegularization);

// Delete regularization request (only applicant can delete pending requests)
router.delete('/:id', authenticateUser, regularizationController.deleteRegularization);

// Get pending approvals (Team Lead, HR, Admin)
router.get('/pending-approvals', authenticateUser, authorizeRole(['teamlead', 'hr', 'subadmin', 'admin']), regularizationController.getPendingApprovals);



module.exports = router;
