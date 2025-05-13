const express = require('express');
const requestController = require('../controllers/requestController');
const {
  authenticateUser,
  authorizeRole,
} = require('../middleware/authMiddleware');
const { USER_ROLES } = require('../utility/constants'); // Import roles for authorization

const router = express.Router();

// Create a new request (accessible to all authenticated users)
router.post('/', authenticateUser, requestController?.createRequest);

// **** Get all requests (restricted to Admin, HR, Subadmin, Team Lead, Sub Team Lead)
router.get(
  '/',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN, USER_ROLES.TEAMLEAD, USER_ROLES.SUBTEAMLEAD]),
  requestController?.getAllRequests
);

// Get request by ID (for individual access or admin check)
router.get('/:id', authenticateUser, requestController?.getRequestById);

// Get all requests for a specific user (self or admin)
router.get(
  '/user/:userId',
  authenticateUser,
  requestController?.getRequestsByUser
);

// Update request status (approve/reject) — restricted
router.patch(
  '/:id/status',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]),
  requestController?.updateRequestStatus
);

// Delete request (soft delete) — restricted
router.delete(
  '/:id',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]),
  requestController?.deleteRequest
);

module.exports = router;
