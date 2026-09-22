// src/routes/externalRoute.js
//
// Routes for trusted internal services calling into HRMS -- not for human
// (JWT) sessions. Each sub-path is scoped to one calling service via its
// own shared secret env var, checked by verifyServiceSecret.
const express = require('express');
const userController = require('../controllers/userController');
const { verifyServiceSecret } = require('../middleware/serviceAuthMiddleware');

const router = express.Router();

// Kapp Sales CRM: search Sales-department employees by name/email/kapp id,
// used to autofill a new Sales CRM user from their existing HRMS record.
router.get(
  '/sales-crm/users',
  verifyServiceSecret('SALES_CRM_API_KEY'),
  userController.searchUsersForSalesCrm
);

module.exports = router;
