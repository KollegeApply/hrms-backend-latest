const express = require('express');
const expenseController = require('../controllers/expenseController');
const { authenticateUser } = require('../middleware/authMiddleware');
const { safeExpenseAttachmentUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.use(authenticateUser);

// Single file, any field name (receipt / attachment / file / etc.) — images + PDF, max 5MB
router.post('/', safeExpenseAttachmentUpload, expenseController.createExpense);
router.get('/dashboard', expenseController.getExpenseDashboard);
router.get('/my-dashboard', expenseController.getMyExpenseDashboard);
router.get('/tl-bulk-summary', expenseController.getTlBulkSummary);
router.get('/', expenseController.getExpenses);
router.put('/bulk/approve', expenseController.bulkApproveExpenses);
router.put('/bulk/reject', expenseController.bulkRejectExpenses);
router.put('/:id/status', expenseController.updateExpenseStatus);
router.delete('/:id', expenseController.deleteExpense);

module.exports = router;
