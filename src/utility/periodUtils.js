// Utility functions for feedback periods

// Generate available periods for current month
const getCurrentMonthPeriods = (periodType = 'monthly') => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const monthName = now.toLocaleString('default', { month: 'long' });

  if (periodType === 'monthly') {
    // Monthly period - full month
    const from = new Date(year, month, 1); // First day of month
    const to = new Date(year, month + 1, 0); // Last day of month
    
    return [{
      id: `${year}-${String(month + 1).padStart(2, '0')}-monthly`,
      name: `${monthName} ${year}`,
      type: 'monthly',
      from: from,
      to: to,
      displayName: `Monthly - ${monthName} ${year}`
    }];
  } else if (periodType === 'biweekly') {
    // Bi-weekly periods - 2 periods per month
    const firstHalfFrom = new Date(year, month, 1);
    const firstHalfTo = new Date(year, month, 15);
    const secondHalfFrom = new Date(year, month, 16);
    const secondHalfTo = new Date(year, month + 1, 0);

    return [
      {
        id: `${year}-${String(month + 1).padStart(2, '0')}-biweekly-1`,
        name: `${monthName} ${year} - First Half`,
        type: 'biweekly',
        period: 1,
        from: firstHalfFrom,
        to: firstHalfTo,
        displayName: `1st Half - ${monthName} 1-15, ${year}`
      },
      {
        id: `${year}-${String(month + 1).padStart(2, '0')}-biweekly-2`, 
        name: `${monthName} ${year} - Second Half`,
        type: 'biweekly',
        period: 2,
        from: secondHalfFrom,
        to: secondHalfTo,
        displayName: `2nd Half - ${monthName} 16-${secondHalfTo.getDate()}, ${year}`
      }
    ];
  }

  return [];
};

// Get all available periods for current month and previous month
const getAvailablePeriods = (periodType = 'biweekly') => {
  const currentPeriods = getCurrentMonthPeriods(periodType);
  const previousPeriods = getPreviousMonthPeriods(periodType);
  
  return [...previousPeriods, ...currentPeriods];
};

// Generate periods for previous month
const getPreviousMonthPeriods = (periodType = 'monthly') => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  
  // Calculate previous month
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 0) {
    prevMonth = 11;
    prevYear--;
  }
  
  const monthName = new Date(prevYear, prevMonth, 1).toLocaleString('default', { month: 'long' });

  if (periodType === 'monthly') {
    // Monthly period - full month
    const from = new Date(prevYear, prevMonth, 1); // First day of month
    const to = new Date(prevYear, prevMonth + 1, 0); // Last day of month
    
    return [{
      id: `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-monthly`,
      name: `${monthName} ${prevYear}`,
      type: 'monthly',
      from: from,
      to: to,
      displayName: `Monthly - ${monthName} ${prevYear}`
    }];
  } else if (periodType === 'biweekly') {
    // Bi-weekly periods - 2 periods per month
    const firstHalfFrom = new Date(prevYear, prevMonth, 1);
    const firstHalfTo = new Date(prevYear, prevMonth, 15);
    const secondHalfFrom = new Date(prevYear, prevMonth, 16);
    const secondHalfTo = new Date(prevYear, prevMonth + 1, 0);

    return [
      {
        id: `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-biweekly-1`,
        name: `${monthName} ${prevYear} - First Half`,
        type: 'biweekly',
        period: 1,
        from: firstHalfFrom,
        to: firstHalfTo,
        displayName: `1st Half - ${monthName} 1-15, ${prevYear}`
      },
      {
        id: `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-biweekly-2`, 
        name: `${monthName} ${prevYear} - Second Half`,
        type: 'biweekly',
        period: 2,
        from: secondHalfFrom,
        to: secondHalfTo,
        displayName: `2nd Half - ${monthName} 16-${secondHalfTo.getDate()}, ${prevYear}`
      }
    ];
  }

  return [];
};

// Get period by ID
const getPeriodById = (periodId) => {
  const [year, month, type, periodNum] = periodId.split('-');
  const monthIndex = parseInt(month) - 1;
  const yearNum = parseInt(year);
  
  if (type === 'monthly') {
    const from = new Date(yearNum, monthIndex, 1);
    const to = new Date(yearNum, monthIndex + 1, 0);
    const monthName = from.toLocaleString('default', { month: 'long' });
    
    return {
      id: periodId,
      name: `${monthName} ${yearNum}`,
      type: 'monthly',
      from: from,
      to: to,
      displayName: `Monthly - ${monthName} ${yearNum}`
    };
  } else if (type === 'biweekly') {
    const periodNumber = parseInt(periodNum);
    const from = periodNumber === 1 
      ? new Date(yearNum, monthIndex, 1)
      : new Date(yearNum, monthIndex, 16);
    const to = periodNumber === 1
      ? new Date(yearNum, monthIndex, 15)
      : new Date(yearNum, monthIndex + 1, 0);
    const monthName = from.toLocaleString('default', { month: 'long' });
    
    return {
      id: periodId,
      name: `${monthName} ${yearNum} - ${periodNumber === 1 ? 'First' : 'Second'} Half`,
      type: 'biweekly',
      period: periodNumber,
      from: from,
      to: to,
      displayName: `${periodNumber === 1 ? '1st' : '2nd'} Half - ${monthName} ${periodNumber === 1 ? '1-15' : `16-${to.getDate()}`}, ${yearNum}`
    };
  }

  return null;
};

// Check if feedback already exists for a period
const checkFeedbackExists = async (givenBy, givenTo, periodId) => {
  const Feedback = require('../models/feedbackModel');
  const period = getPeriodById(periodId);
  
  if (!period) return false;

  const existingFeedback = await Feedback.findOne({
    givenBy: givenBy,
    givenTo: givenTo,
    from: period.from,
    to: period.to,
    isDeleted: false
  });

  return !!existingFeedback;
};

// Get previous periods for trend analysis
const getPreviousPeriods = (currentPeriodId, count = 6) => {
  const [year, month, type] = currentPeriodId.split('-');
  const periods = [];
  
  let currentYear = parseInt(year);
  let currentMonth = parseInt(month) - 1; // Convert to 0-based
  
  for (let i = 0; i < count; i++) {
    if (type === 'monthly') {
      // Go back one month
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      
      const periodId = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-monthly`;
      periods.push(getPeriodById(periodId));
    } else if (type === 'biweekly') {
      // Go back one bi-weekly period
      const currentPeriodNum = parseInt(currentPeriodId.split('-')[3]);
      
      if (currentPeriodNum === 2) {
        // From 2nd half to 1st half of same month
        const periodId = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-biweekly-1`;
        periods.push(getPeriodById(periodId));
      } else {
        // From 1st half to 2nd half of previous month
        currentMonth--;
        if (currentMonth < 0) {
          currentMonth = 11;
          currentYear--;
        }
        const periodId = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-biweekly-2`;
        periods.push(getPeriodById(periodId));
      }
    }
  }
  
  return periods.filter(Boolean);
};

// Validate period dates
const validatePeriod = (periodId) => {
  const period = getPeriodById(periodId);
  if (!period) return { valid: false, message: 'Invalid period ID' };
  
  const now = new Date();
  if (period.from > now) {
    return { valid: false, message: 'Cannot give feedback for future periods' };
  }
  
  return { valid: true, period };
};

module.exports = {
  getCurrentMonthPeriods,
  getPreviousMonthPeriods,
  getAvailablePeriods,
  getPeriodById,
  checkFeedbackExists,
  getPreviousPeriods,
  validatePeriod
};
