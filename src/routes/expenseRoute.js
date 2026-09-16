const express = require('express');
const expenseController = require('../controllers/expenseController');
const { authenticateUser } = require('../middleware/authMiddleware');
const { safeExpenseAttachmentUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.use(authenticateUser);

// Single file, any field name (receipt / attachment / file / etc.) — images + PDF, max 5MB
router.post('/', safeExpenseAttachmentUpload, expenseController.createExpense);
router.get('/dashboard', expenseController.getExpenseDashboard);
router.get('/dashboard/records', expenseController.getExpenseDashboardEmployeeRecords);
router.get('/my-dashboard', expenseController.getMyExpenseDashboard);
router.get('/team-dashboard/:userId', expenseController.getTeamMemberExpenseDashboard);
router.get('/tl-bulk-summary', expenseController.getTlBulkSummary);
// FR-1.1/1.2 — filing cutoff toggle. GET is open to any authenticated user
// (Add Expense needs it); Expense-department-only enforcement for the
// writes/history lives in the service layer, matching this router's
// existing convention.
router.get('/filing-cutoff', expenseController.getExpenseFilingCutoff);
router.put('/filing-cutoff', expenseController.updateExpenseFilingCutoff);
router.get('/filing-cutoff/history', expenseController.getExpenseFilingCutoffHistory);
router.get('/', expenseController.getExpenses);
router.put('/bulk/approve', expenseController.bulkApproveExpenses);
router.put('/bulk/reject', expenseController.bulkRejectExpenses);
// FR-3.2 — claimant edits a rejected expense in place and resubmits it.
router.put('/:id', safeExpenseAttachmentUpload, expenseController.updateExpense);
router.put('/:id/status', expenseController.updateExpenseStatus);
router.delete('/:id', expenseController.deleteExpense);

module.exports = router;
