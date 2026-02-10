const express = require('express');
const router = express.Router();
const kpiController = require('../controllers/kpiController');
const { authenticateUser, authorizeRole } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(authenticateUser);

// Get KPIs for a specific department
router.get('/department/:departmentName', kpiController.getKPIsByDepartment);

// Get KPIs for employee (used in feedback forms)
router.get('/employee/:employeeId', kpiController.getKPIsForEmployee);

// Set employee KPI override (teamlead, subteamlead, admin, subadmin)
router.put('/employee/:employeeId/override', authorizeRole(['teamlead', 'subteamlead', 'admin', 'subadmin']), kpiController.setEmployeeKpiOverride);

// Get all KPIs (admin/hr only)
router.get('/', authorizeRole(['admin', 'subadmin', 'hr']), kpiController.getAllKPIs);

// Create or update KPIs for a department (admin/hr only)
router.post('/', authorizeRole(['admin', 'subadmin', 'hr']), kpiController.createOrUpdateKPIs);

// Delete KPIs for a department (admin/hr only)
router.delete('/department/:departmentName', authorizeRole(['admin', 'subadmin', 'hr']), kpiController.deleteKPIs);

// Get available periods for feedback
router.get('/periods', kpiController.getAvailablePeriodsForFeedback);

// Check if feedback exists for a period
router.get('/periods/:periodId/employee/:employeeId/exists', kpiController.checkPeriodFeedbackExists);

module.exports = router;
