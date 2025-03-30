// src/routes/userRoutes.js
const express = require('express');
const userController = require('../controllers/userController');
const {
  authenticateUser,
  authorizeRole,
} = require('../middleware/authMiddleware');
const { USER_ROLES } = require('../utility/constants'); // Import roles for authorization

const router = express.Router();

// --- Public Routes ---
router.post('/login', userController.login);
// Add routes for password reset (forgot password, reset with token) here if implemented

// --- Protected Routes (Require Authentication) ---

// Create User: Often restricted (e.g., HR, Admin)
router.post(
  '/',
  authenticateUser,
  authorizeRole([USER_ROLES.ADMIN, USER_ROLES.HR]), // Only Admin and HR can create users
  userController.createUser
);

// Get All Users: Access might vary by role (e.g., everyone sees basic info, HR/Admin see more)
router.get(
  '/',
  authenticateUser,
  // Add authorizeRole if access needs restriction, e.g., authorizeRole([USER_ROLES.ADMIN, USER_ROLES.HR, USER_ROLES.MANAGER])
  userController.getAllUsers
);

// Get Specific User: Allow self-access, plus HR/Admin/Manager access
router.get(
  '/:id',
  authenticateUser,
  // Simple check: Allow if user is requesting their own data OR if user is Admin/HR/Manager
  // More complex logic (e.g., manager seeing direct reports) would go in the service/controller
  (req, res, next) => {
    if (
      req.user.id === req.params.id ||
      [USER_ROLES.ADMIN, USER_ROLES.HR, USER_ROLES.MANAGER].includes(
        req.user.role
      )
    ) {
      return next();
    }
    return authorizeRole([])(req, res, next); // Trigger forbidden error if no match
  },
  userController.getUserById
);

// Update User: Allow self-update (limited fields) OR HR/Admin update (more fields)
// The service layer should handle *which* fields can be updated based on role
router.put(
  '/:id',
  authenticateUser,
  // Simple check: Allow if user is updating their own data OR if user is Admin/HR
  (req, res, next) => {
    if (
      req.user.id === req.params.id ||
      [USER_ROLES.ADMIN, USER_ROLES.HR].includes(req.user.role)
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
  authorizeRole([USER_ROLES.ADMIN, USER_ROLES.HR]), // Only Admin and HR can delete users
  userController.deleteUser
);

// --- Add other user-related routes as needed ---
// e.g., router.post('/change-password', authenticateUser, userController.changePassword);

module.exports = router;
