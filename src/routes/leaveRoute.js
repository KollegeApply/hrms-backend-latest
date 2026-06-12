const express = require('express');
const leaveController = require('../controllers/leaveController');
const { authenticateUser } = require('../middleware/authMiddleware');
const { safeLeaveAttachmentUpload } = require('../middleware/uploadMiddleware');
const leavePolicyController = require('../controllers/leavePolicyController');
const employeeLeaveBalanceController = require('../controllers/employeeLeaveBalanceController');

const router = express.Router();

router.use(authenticateUser);

// Leave Types
router.get('/leave-types', leavePolicyController.getAllLeaveTypes);
router.post('/leave-types', leavePolicyController.createLeaveType);

// Leave Policies
router.get('/leave-policies', leavePolicyController.getAllPolicies);
router.post('/leave-policies', leavePolicyController.createPolicy);

// Leave Policy Mappings
router.get('/leave-policy-mappings', leavePolicyController.getPolicyMappings);
router.post(
  '/leave-policy-mappings',
  leavePolicyController.createPolicyMapping
);

// Employee Leave Balances
router.get(
  '/employee-leave-balance',
  employeeLeaveBalanceController.getBalancesForEmployee
);

// Policy-driven leave application
router.post('/apply', authenticateUser, safeLeaveAttachmentUpload, leaveController.applyForLeave);
// Fetch leave applications (new model)
router.get(
  '/applications',
  authenticateUser,
  leaveController.getLeaveApplications
);

// Leave CRUD (dynamic routes last)
router.get('/', authenticateUser, leaveController?.getAllLeave);
router.get('/:id', authenticateUser, leaveController?.getLeaveById);
router.put('/:id', authenticateUser, leaveController?.updateLeave);
router.delete('/:id', authenticateUser, leaveController?.deleteLeave);

module.exports = router;
