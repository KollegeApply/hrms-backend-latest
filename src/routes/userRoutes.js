// src/routes/userRoutes.js
const express = require('express');
const { default: httpStatus } = require('http-status');
const userController = require('../controllers/userController');
const {
  authenticateUser,
  authorizeRole,
} = require('../middleware/authMiddleware');
const { safeUpload } = require('../middleware/uploadMiddleware');
const { USER_ROLES } = require('../utility/constants');
const ApiError = require('../utility/ApiError');

const router = express.Router();

const toIdString = (value) => (value ? String(value) : '');

// Any authenticated user can edit their own profile sections; HR/Admin/SubAdmin can edit others too.
const canEditUserProfile = (req, res, next) => {
  const targetUserId = toIdString(req.params?.userId);
  const requesterId = toIdString(req.user?.id || req.user?._id);

  const isSelf = Boolean(targetUserId && requesterId && targetUserId === requesterId);
  const isPrivileged = [USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN].includes(
    req?.user?.role
  );

  if (isSelf || isPrivileged) {
    return next();
  }

  return next(
    new ApiError(
      httpStatus.FORBIDDEN,
      'You can only update your own profile. HR/Admin can update other users.'
    )
  );
};

const profileSectionRoutes = [
  { path: 'personalInfo', handler: userController.updateUserProfilePersonalInfo },
  { path: 'addressInfo', handler: userController.updateUserProfileAddressInfo },
  { path: 'education', handler: userController.updateUserProfileEducation },
  {
    path: 'employmentHistory',
    handler: userController.updateUserProfileEmploymentHistory,
  },
  { path: 'medicalInfo', handler: userController.updateUserProfileMedicalInfo },
  {
    path: 'backgroundInfo',
    handler: userController.updateUserProfileBackgroundInfo,
  },
  { path: 'bankDetails', handler: userController.updateUserProfileBankDetails },
  {
    path: 'documents',
    handler: userController.updateUserProfileDocuments,
    upload: true,
  },
];

profileSectionRoutes.forEach(({ path, handler, upload = false }) => {
  router.put(
    `/:userId/profile/${path}`,
    authenticateUser,
    canEditUserProfile,
    ...(upload ? [safeUpload([])] : []),
    handler
  );
});

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

// Profile change approvals (HR queue — same pattern as leaves & regularisation)
router.get(
  '/profile-change-requests',
  authenticateUser,
  userController.getProfileChangeRequests
);
router.put(
  '/profile-change-requests/:id/approve',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]),
  userController.approveProfileChangeRequest
);
router.put(
  '/profile-change-requests/:id/reject',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]),
  userController.rejectProfileChangeRequest
);

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

// Expense band (K1–K4): TL / SubTL — one PUT for both initial set and later edits
router.put(
  '/:id/expense-band',
  authenticateUser,
  authorizeRole([USER_ROLES?.TEAMLEAD, USER_ROLES?.SUBTEAMLEAD]),
  userController.updateReporteeExpenseBand
);

module.exports = router;
