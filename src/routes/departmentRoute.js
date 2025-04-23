const express = require('express');
const departmentController = require('../controllers/departmentController');
const {
  authenticateUser,
  authorizeRole,
} = require('../middleware/authMiddleware');
const { USER_ROLES } = require('../utility/constants'); // Import roles for authorization

const router = express.Router();

router.post(
  '/',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]),
  departmentController?.createDepartment
);

// Get all Holiday
router.get('/', authenticateUser, departmentController?.getAllDepartment);

// Get Holiday by Id
router.get('/:id', authenticateUser, departmentController?.getDepartmentById);

// Update Holiday  Restricted (e.g., HR, Admin)
router.put(
  '/:id',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]), // Only Admin and HR can delete users
  departmentController?.updateDepartment
);

router.delete(
  '/:id',
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]),
  departmentController?.deleteDepartment
);

module.exports = router;
