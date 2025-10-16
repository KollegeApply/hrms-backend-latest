// src/routes/userRoutes.js
const express = require('express');
const holidayController = require('../controllers/holidayController');
const {
  authenticateUser,
  authorizeRole,
} = require('../middleware/authMiddleware');
const { USER_ROLES } = require('../utility/constants'); // Import roles for authorization

const router = express.Router();

// --- Protected Routes (Require Authentication) ---

// Create Holiday (HR, Admin)
router.post(
  '/',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]), // Only Admin and HR can create users
  holidayController?.createHoliday
);

// Get all Holiday
router.get('/', authenticateUser, holidayController?.getAllHolidays);

// Check if a date is a holiday
router.get('/check', authenticateUser, holidayController?.checkHoliday);

// Get Holiday by Id
router.get('/:id', authenticateUser, holidayController?.getHolidayById);

// Update Holiday  Restricted (e.g., HR, Admin)
router.put(
  '/:id',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]), // Only Admin and HR can delete users
  holidayController.updateHoliday
);

// Delete Holiday (Soft Delete): Restricted (e.g., HR, Admin)
router.delete(
  '/:id',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]), // Only Admin and HR can delete users
  holidayController.deleteHoliday
);

module.exports = router;
