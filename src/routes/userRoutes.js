// src/routes/userRoutes.js
const express = require('express');
const userController = require('../controllers/userController');
const {
  authenticateUser,
  authorizeRole,
} = require('../middleware/authMiddleware');
const { safeUpload } = require('../middleware/uploadMiddleware');
const { USER_ROLES } = require('../utility/constants');

const router = express.Router();

// --- Public Routes ---
router.post('/login', userController.login);
// Add routes for password reset (forgot password, reset with token) here if implemented

// --- Protected Routes (Require Authentication) ---

// Create User: Often restricted (e.g., HR, Admin)
router.post(
  '/',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]), // Only Admin and HR can create users
  userController.createUser
);

// create users in bulk
router.post(
  '/bulk-create',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]), // Only Admin and HR can create users
  userController?.bulkUpload
);

router.get('/', authenticateUser, userController?.getAllUsers);
// Dedicated route for meeting attendee search to avoid side effects elsewhere
router.get('/meeting-attendees', authenticateUser, userController?.getAllUsersForMeeting);

router.get('/tl-id', authenticateUser, userController?.getUserByTlId);

// Get Team Details: Only for TL and SubTL, returns full team details without flag
router.get('/team-details', authenticateUser, userController?.getTeamDetails);

// Get Specific User: Allow self-access, plus HR/Admin/Manager access
router.get(
  '/:id',
  authenticateUser,
  // Simple check: Allow if user is requesting their own data OR if user is Admin/HR/Manager
  // More complex logic (e.g., manager seeing direct reports) would go in the service/controller
  (req, res, next) => {
    if (
      req.user.id === req?.params?.id ||
      [USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN].includes(
        req?.user?.role
      )
    ) {
      return next();
    }
    return authorizeRole([])(req, res, next); // Trigger forbidden error if no match
  },
  userController?.getUserById
);

// Update User: Allow self-update (limited fields) OR HR/Admin update (more fields)
// The service layer should handle *which* fields can be updated based on role
router.put(
  '/:id',
  authenticateUser,
  // Simple check: Allow if user is updating their own data OR if user is Admin/HR
  (req, res, next) => {
    if (
      req.user.id === req?.params?.id ||
      [USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN].includes(
        req?.user?.role
      )
    ) {
      return next();
    }
    return authorizeRole([])(req, res, next); // Trigger forbidden error
  },
  userController.updateUser
);

// Delete User (Soft Delete): Restricted (e.g., HR, Admin)
router.delete(
  '/:id',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]), // Only Admin and HR can delete users
  userController?.deleteUser
);

// --- Add other user-related routes as needed ---
router.post(
  '/change-password',
  authenticateUser,
  userController?.changePassword
);

router.post('/forgot-password', userController?.forgotPassword); // Request OTP email
// Update the handler for this route
router.post('/reset-password', userController?.verifyOtp);

// Section approvals
router.post('/section-approval/request', authenticateUser, userController?.requestSectionApproval);
router.get('/section-approval/status', authenticateUser, userController?.getSectionApprovalStatus);
router.post('/section-approval/token/:token', userController?.sectionApprovalByToken);

router.get('/:id/history', authenticateUser, userController?.getUserHistory);

// Approve User Form: Restricted to HR/Admin/SubAdmin
router.put(
  '/:id/approve',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]),
  userController.approveUser
);

// Update User CIF Form: Restricted to HR/Admin/SubAdmin
router.put(
  '/:id/cif-form',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]),
  safeUpload([]), // Allow any file fields
  userController.updateUserCifForm
);

// Upload Profile Photo: Users can upload their own profile photo
router.post(
  '/:userId/profile/photo',
  authenticateUser,
  safeUpload(['photo']), // Allow only 'photo' field, single file
  userController.uploadProfilePhoto
);

// Update Shift Time: Only TL/SubTL can update for their team members
router.put(
  '/:id/shift-time',
  authenticateUser,
  (req, res, next) => {
    // Allow TL, SubTL, HR, Admin and SubAdmin
    const allowedRoles = [
      USER_ROLES?.TEAMLEAD,
      USER_ROLES?.SUBTEAMLEAD,
      USER_ROLES?.HR,
      USER_ROLES?.ADMIN,
      USER_ROLES?.SUBADMIN,
    ];
    if (allowedRoles.includes(req?.user?.role)) {
      return next();
    }
    return authorizeRole([])(req, res, next); // Trigger forbidden error
  },
  userController.updateShiftTime
);

module.exports = router;
