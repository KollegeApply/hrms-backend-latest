const express = require('express');
const companyPolicyController = require('../controllers/companypolicyController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = express.Router();

// 🔒 Protected routes
router.use(authenticateUser);

router.get('/', companyPolicyController.getAllCompanyPolicies);
router.get('/view/status', companyPolicyController.viewCompanyPolicyStatuses);
router.get('/:type', companyPolicyController.getCompanyPolicyByType);
router.patch(
  '/:type/submit',
  companyPolicyController.submitCompanyPolicyByType
);

module.exports = router;
