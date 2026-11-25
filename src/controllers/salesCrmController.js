// src/controllers/salesCrmController.js -- endpoints the Kapp Sales CRM calls (service secret, no user session).
const { default: httpStatus } = require('http-status');
const catchAsync = require('../utility/catchAsync');
const { leavesOnDay } = require('../services/salesCrmLeaveService');

// GET /external/sales-crm/leaves?date=YYYY-MM-DD[&include_half_day=true]
const leavesForSalesCrm = catchAsync(async (req, res) => {
  const date = req?.query?.date;
  const includeHalfDay = String(req?.query?.include_half_day ?? '').toLowerCase() === 'true';
  const data = await leavesOnDay(date, { includeHalfDay });
  res.status(httpStatus.OK).json({ success: true, date, count: data.length, data });
});

module.exports = { leavesForSalesCrm };
