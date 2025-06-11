function calculateOnRollLeave(hireDate,carryForward = 0) {
  const currentYear = new Date().getFullYear();

  if (hireDate.getFullYear() < currentYear) {
    return {
      annualLeave: {
        total: 16,
        quarters: [
          { quarter: 1, total: 4 },
          { quarter: 2, total: 4 },
          { quarter: 3, total: 4 },
          { quarter: 4, total: 4 },
        ],
      },
      casualSickLeave: {
        total: 8,
        quarters: [
          { quarter: 1, total: 2 },
          { quarter: 2, total: 2 },
          { quarter: 3, total: 2 },
          { quarter: 4, total: 2 },
        ],
      },
      bereavementLeave: { total: 3 },
      marriageLeave: { total: 5 },
      birthdayLeave: { total: 1 },
      carryForwardLeave : { total: carryForward },
      total: 33,
    };
  }

  const startOfYear = new Date(hireDate.getFullYear(), 0, 1);
  const endOfYear = new Date(hireDate.getFullYear(), 11, 31);
  const oneDay = 1000 * 60 * 60 * 24;

  const totalDaysInYear = Math.floor((endOfYear - startOfYear) / oneDay) + 1;
  const hireDayOfYear = Math.floor((hireDate - startOfYear) / oneDay);
  const remainingDays = totalDaysInYear - hireDayOfYear;

  // Leave entitlements
  const fullAnnualLeave = 16;
  const fullCasualSickLeave = 8;

  const annualLeaveEntitlement = Math.round(
    (remainingDays / totalDaysInYear) * fullAnnualLeave
  );
  const casualSickLeaveEntitlement = Math.round(
    (remainingDays / totalDaysInYear) * fullCasualSickLeave
  );

  // Determine current and remaining quarters
  let currentQuarter = getQuarter(hireDate);
  const annualLeaveQuarters = [];
  const casualSickLeaveQuarters = [];

  const quarterRanges = {
    1: {
      start: new Date(hireDate.getFullYear(), 0, 1),
      end: new Date(hireDate.getFullYear(), 2, 31),
    },
    2: {
      start: new Date(hireDate.getFullYear(), 3, 1),
      end: new Date(hireDate.getFullYear(), 5, 30),
    },
    3: {
      start: new Date(hireDate.getFullYear(), 6, 1),
      end: new Date(hireDate.getFullYear(), 8, 30),
    },
    4: {
      start: new Date(hireDate.getFullYear(), 9, 1),
      end: new Date(hireDate.getFullYear(), 11, 31),
    },
  };

  // Calculate leaves per quarter (pro-rata for current quarter)
  const quarterDurations = [];
  for (let q = currentQuarter; q <= 4; q++) {
    const start = q === currentQuarter ? hireDate : quarterRanges[q].start;
    const end = quarterRanges[q].end;
    const duration = Math.floor((end - start) / oneDay) + 1;
    quarterDurations.push({ quarter: q, days: duration });
  }

  const totalQuarterDays = quarterDurations.reduce((sum, q) => sum + q.days, 0);

  // Distribute Annual Leave
  let distributedAnnual = 0;
  for (let i = 0; i < quarterDurations.length; i++) {
    const portion = quarterDurations[i].days / totalQuarterDays;
    const leave = Math.round(portion * annualLeaveEntitlement);
    annualLeaveQuarters.push({
      quarter: quarterDurations[i].quarter,
      total: leave,
    });
    distributedAnnual += leave;
  }

  // Adjust for rounding error
  const annualAdjustment = annualLeaveEntitlement - distributedAnnual;
  if (annualAdjustment !== 0) {
    annualLeaveQuarters[annualLeaveQuarters.length - 1].total +=
      annualAdjustment;
  }

  // Distribute Casual/Sick Leave
  let distributedCasual = 0;
  for (let i = 0; i < quarterDurations.length; i++) {
    const portion = quarterDurations[i].days / totalQuarterDays;
    const leave = Math.round(portion * casualSickLeaveEntitlement);
    casualSickLeaveQuarters.push({
      quarter: quarterDurations[i].quarter,
      total: leave,
    });
    distributedCasual += leave;
  }

  const casualAdjustment = casualSickLeaveEntitlement - distributedCasual;
  if (casualAdjustment !== 0) {
    casualSickLeaveQuarters[casualSickLeaveQuarters.length - 1].total +=
      casualAdjustment;
  }

  // Fixed Leave Types
  const bereavementLeave = { total: 3 };
  const marriageLeave = { total: 5 };
  const birthdayLeave = { total: 1 };
  const carryForwardLeave = { total: carryForward };

  const total =
    annualLeaveEntitlement +
    casualSickLeaveEntitlement +
    bereavementLeave.total +
    marriageLeave.total +
    birthdayLeave.total +
    carryForwardLeave.total;

  return {
    annualLeave: {
      total: annualLeaveEntitlement,
      quarters: annualLeaveQuarters,
    },
    casualSickLeave: {
      total: casualSickLeaveEntitlement,
      quarters: casualSickLeaveQuarters,
    },
    bereavementLeave,
    marriageLeave,
    birthdayLeave,
    carryForwardLeave,
    total,
  };
}

function getQuarter(date) {
  const month = date.getMonth() + 1;
  if (month >= 1 && month <= 3) return 1;
  if (month >= 4 && month <= 6) return 2;
  if (month >= 7 && month <= 9) return 3;
  if (month >= 10 && month <= 12) return 4;
  return null;
}

module.exports = {
  calculateOnRollLeave,
  getQuarter,
};
