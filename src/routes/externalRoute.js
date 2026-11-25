// src/routes/externalRoute.js
//
// Routes for trusted internal services calling into HRMS -- not for human
// (JWT) sessions. Each sub-path is scoped to one calling service via its
// own shared secret env var, checked by verifyServiceSecret.
const express = require('express');
const userController = require('../controllers/userController');
const salesCrmController = require('../controllers/salesCrmController');
const { verifyServiceSecret } = require('../middleware/serviceAuthMiddleware');

const router = express.Router();

// Kapp Sales CRM: search Sales-department employees by name/email/kapp id,
// used to autofill a new Sales CRM user from their existing HRMS record.
router.get(
  '/sales-crm/users',
  verifyServiceSecret('HRMS_API_KEY'),
  userController.searchUsersForSalesCrm
);

// Kapp Sales CRM: Sales-department employees on APPROVED full-day leave on a day
// (?date=YYYY-MM-DD, IST), so its DRS & Compliance report shows them as on leave.
router.get(
  '/sales-crm/leaves',
  verifyServiceSecret('HRMS_API_KEY'),
  salesCrmController.leavesForSalesCrm
);

module.exports = router;
