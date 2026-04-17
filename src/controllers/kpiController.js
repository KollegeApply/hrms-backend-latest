const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const kpiService = require('../services/kpiService');
const { getAvailablePeriods, checkFeedbackExists, validatePeriod } = require('../utility/periodUtils');
const logger = require('../config/logger');

// Get KPIs for a specific department
const getKPIsByDepartment = catchAsync(async (req, res) => {
  const { departmentName } = req.params;
  
  if (!departmentName) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Department name is required'
    });
  }

  let kpis = await kpiService.getKPIsByDepartment(departmentName);
  
  // If no specific KPIs found, return generic KPIs
  if (!kpis) {
    kpis = kpiService.getGenericKPIs();
    logger.info(`Returning generic KPIs for department: ${departmentName}`);
  }

  return res.status(httpStatus.OK).json({
    success: true,
    data: kpis,
    message: 'KPIs fetched successfully'
  });
});

// Get KPIs for employee's department (used in feedback)
const getKPIsForEmployee = catchAsync(async (req, res) => {
  const { employeeId } = req.params;
  const currentUserId = req.user.id;
  const currentUserRole = req.user.role;
  
  if (!employeeId) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Employee ID is required'
    });
  }

  // Get employee details with department populated
  const User = require('../models/userModel');
  
  const employee = await User.findById(employeeId)
    .populate('department', 'name description')
    .select('firstName lastName employeeId role department team');
  
  if (!employee) {
    return res.status(httpStatus.NOT_FOUND).json({
      success: false,
      message: 'Employee not found'
    });
  }

  // Special case: Employee/Intern/IT giving feedback to TL/STL
  // Use leadership KPIs instead of department-specific KPIs
  if ((currentUserRole === 'employee' || currentUserRole === 'intern' || currentUserRole === 'IT' || currentUserRole === 'subteamlead') && 
      (employee.role === 'teamlead' || employee.role === 'subteamlead')) {
    
    const kpis = kpiService.getLeadershipKPIs();
    
    logger.info(`${currentUserRole} giving feedback to ${employee.role}. Using leadership KPIs.`);
    
    return res.status(httpStatus.OK).json({
      success: true,
      data: {
        employee: {
          id: employee._id,
          name: `${employee.firstName} ${employee.lastName}`,
          employeeId: employee.employeeId,
          department: employee.department ? employee.department.name : 'Not Assigned',
          departmentId: employee.department ? employee.department._id : null,
          role: employee.role,
          team: employee.team
        },
        kpis
      },
      message: 'Leadership KPIs fetched for manager feedback'
    });
  }

  // Regular flow: Use department-specific or generic KPIs
  let departmentDisplayName = 'Not Assigned';
  let kpis;
  let override = null;
  
  if (employee.department && employee.department._id) {
    departmentDisplayName = employee.department.name;
    
    // Primary: Use department ObjectId for reliable KPI mapping
    kpis = await kpiService.getKPIsByDepartmentId(employee.department._id, employee.department.name);
  }
  
  // Check employee-specific override (only for regular flow)
  override = await kpiService.getEmployeeKpiOverride(employee._id);

  if (override) {
    kpis = {
      departmentName: override.departmentId?.name || departmentDisplayName,
      kpis: override.kpis
    };
    logger.info(`Returning employee-specific KPI override for employee: ${employeeId}`);
  } else if (!kpis) {
    // Final fallback to generic KPIs only if no department-specific KPIs found
    kpis = kpiService.getGenericKPIs();
    logger.warn(`No specific KPIs found for department: ${departmentDisplayName}. Using generic KPIs. Run KPI initializer script to create department-specific KPIs.`);
  } else {
    logger.info(`Returning ${kpis.departmentName} KPIs for employee: ${employeeId}, department: ${departmentDisplayName}`);
  }

  return res.status(httpStatus.OK).json({
    success: true,
    data: {
      employee: {
        id: employee._id,
        name: `${employee.firstName} ${employee.lastName}`,
        employeeId: employee.employeeId,
        department: departmentDisplayName,
        departmentId: employee.department ? employee.department._id : null,
        role: employee.role,
        team: employee.team
      },
      kpis,
      kpiSource: override ? 'employee_override' : (kpis?.departmentName === 'generic' ? 'generic' : 'department')
    },
    message: 'Employee KPIs fetched successfully'
  });
});

const setEmployeeKpiOverride = catchAsync(async (req, res) => {
  const { employeeId } = req.params;
  const { kpis } = req.body;
  const currentUserId = req.user.id;
  const currentUserRole = req.user.role;

  if (!employeeId) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Employee ID is required'
    });
  }

  if (!kpis || !Array.isArray(kpis) || kpis.length === 0) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'KPIs array is required'
    });
  }

  const User = require('../models/userModel');
  const employee = await User.findById(employeeId)
    .populate('department', 'name description')
    .select('firstName lastName employeeId role department team teamLeadId subTeamLeadId');

  if (!employee) {
    return res.status(httpStatus.NOT_FOUND).json({
      success: false,
      message: 'Employee not found'
    });
  }

  const isPrivilegedRole = ['admin', 'subadmin'].includes(currentUserRole);
  const isDirectTeamLead = employee.teamLeadId && employee.teamLeadId.toString() === currentUserId.toString();
  const isDirectSubTeamLead = employee.subTeamLeadId && employee.subTeamLeadId.toString() === currentUserId.toString();

  // Allow admin/subadmin globally, or TL/STL for their direct reports.
  if (!isPrivilegedRole && !isDirectTeamLead && !isDirectSubTeamLead) {
    return res.status(httpStatus.FORBIDDEN).json({
      success: false,
      message: 'You are not authorized to edit KPIs for this employee'
    });
  }

  // Load base KPIs for validation (department-specific or generic)
  let baseKpis = null;
  if (employee.department && employee.department._id) {
    baseKpis = await kpiService.getKPIsByDepartmentId(employee.department._id);
  }
  if (!baseKpis) {
    baseKpis = kpiService.getGenericKPIs();
  }

  // Validate KPI structure
  const isValidKPIs = kpis.every(kpi =>
    kpi.name && kpi.description &&
    typeof kpi.maxRating === 'number' && kpi.maxRating > 0
  );

  if (!isValidKPIs) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Each KPI must have name, description, and valid maxRating'
    });
  }

  // Allow employee-specific KPI overrides to add/remove/rename KPI items.
  

  const result = await kpiService.createOrUpdateEmployeeKpiOverride(
    employee._id,
    employee.department ? employee.department._id : null,
    kpis,
    currentUserId
  );

  return res.status(httpStatus.OK).json({
    success: true,
    data: result,
    message: 'Employee KPIs updated successfully'
  });
});

// Create or update KPIs for a department
const createOrUpdateKPIs = catchAsync(async (req, res) => {
  const { departmentName, kpis } = req.body;
  
  if (!departmentName || !kpis || !Array.isArray(kpis)) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Department name and KPIs array are required'
    });
  }

  // Validate KPI structure
  const isValidKPIs = kpis.every(kpi => 
    kpi.name && kpi.description && 
    typeof kpi.maxRating === 'number' && kpi.maxRating > 0
  );

  if (!isValidKPIs) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Each KPI must have name, description, and valid maxRating'
    });
  }

  const result = await kpiService.createOrUpdateKPIs(
    departmentName, 
    kpis, 
    req.user.id
  );

  return res.status(httpStatus.OK).json({
    success: true,
    data: result,
    message: 'KPIs created/updated successfully'
  });
});

// Get all KPIs
const getAllKPIs = catchAsync(async (req, res) => {
  const kpis = await kpiService.getAllKPIs();
  
  return res.status(httpStatus.OK).json({
    success: true,
    data: kpis,
    message: 'All KPIs fetched successfully'
  });
});

// Initialize default KPIs
const initializeDefaultKPIs = catchAsync(async (req, res) => {
  const result = await kpiService.initializeDefaultKPIs(req.user.id);
  
  return res.status(httpStatus.OK).json({
    success: true,
    data: result,
    message: `Initialized ${result.length} default department KPIs`
  });
});

// Delete KPIs for a department
const deleteKPIs = catchAsync(async (req, res) => {
  const { departmentName } = req.params;
  
  if (!departmentName) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Department name is required'
    });
  }

  const result = await kpiService.deleteKPIs(departmentName, req.user.id);
  
  if (!result) {
    return res.status(httpStatus.NOT_FOUND).json({
      success: false,
      message: 'KPIs not found for the specified department'
    });
  }

  return res.status(httpStatus.OK).json({
    success: true,
    data: result,
    message: 'KPIs deleted successfully'
  });
});

// Get available periods for feedback
const getAvailablePeriodsForFeedback = catchAsync(async (req, res) => {
  const { periodType = 'biweekly' } = req.query;
  
  const periods = getAvailablePeriods(periodType);
  
  return res.status(httpStatus.OK).json({
    success: true,
    data: periods,
    message: 'Available periods fetched successfully'
  });
});

// Check if feedback exists for a specific period
const checkPeriodFeedbackExists = catchAsync(async (req, res) => {
  const { employeeId, periodId } = req.params;
  const userId = req.user.id;
  
  const exists = await checkFeedbackExists(userId, employeeId, periodId);
  
  return res.status(httpStatus.OK).json({
    success: true,
    data: { exists },
    message: exists ? 'Feedback already exists for this period' : 'No feedback found for this period'
  });
});

module.exports = {
  getKPIsByDepartment,
  getKPIsForEmployee,
  setEmployeeKpiOverride,
  createOrUpdateKPIs,
  getAllKPIs,
  deleteKPIs,
  getAvailablePeriodsForFeedback,
  checkPeriodFeedbackExists
};
