const mongoose = require('mongoose');
const Leave = require('../models/leaveModel');
const LeaveType = require('../models/leaveTypeModel');
const LeaveApplication = require('../models/leaveApplicationModel');
const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');
require('dotenv').config({ path: './.env.production' });

const LEAVETYPE_MAP = {
  casualSickLeave: 'CASUAL',
  annualLeave: 'ANNUAL',
  bereavementLeave: 'BEREAVEMENT',
  marriageLeave: 'MARRIAGE',
  birthdayLeave: 'BIRTHDAY',
  monthlyleave: 'PROBATION',
};

async function migrateLeaves() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  const leaveTypes = await LeaveType.find({});
  const codeToIdMap = {};
  leaveTypes.forEach((lt) => (codeToIdMap[lt.code] = lt._id));

  const legacyLeaves = await Leave.find({ isDeleted: false });

  for (const leave of legacyLeaves) {

    let wasSingleDate = false;
    let datesArr = [];

    // 1: dates array present and has items
    if (Array.isArray(leave.dates) && leave.dates.length > 0) {
      datesArr = leave.dates;
    }

    // 2: fallback to leave.date if available
    else if (leave.date instanceof Date) {
      datesArr = [leave.date];
      wasSingleDate = true;
      await Leave.updateOne({ _id: leave._id }, { $set: { dates: datesArr } });
    } else if (typeof leave.date === 'string') {
      const parsed = new Date(leave.date);
      if (!isNaN(parsed)) {
        datesArr = [parsed];
        wasSingleDate = true;
        await Leave.updateOne({ _id: leave._id }, { $set: { dates: datesArr } });
      } else {
        console.warn(`Invalid date string in leave.date: ${leave.date}`);
        continue;
      }
    } else {
      console.warn(`No valid date found in leave: ${leave._id}`);
      continue;
    }

    // If still no dates, skip
    if (!datesArr.length) {
      console.warn(`Skipping leave _id=${leave._id} — no valid date(s)`);
      continue;
    }

    const legacyKey = leave.leaveType;
    const code = LEAVETYPE_MAP[legacyKey];

    if (!code || !codeToIdMap[code]) {
      console.warn(`Unknown leaveType: ${legacyKey}`);
      continue;
    }

    const leaveTypeId = codeToIdMap[code];
    const totalDays = datesArr.length;
    const status = (leave.status || '').toLowerCase();

  const isOriginallyFromDateField =
  !!leave.date && (!Array.isArray(leave.dates) || leave.dates.length === 0);

if (status === 'approved' && !!leave.date){
  await EmployeeLeaveBalance.updateOne(
    { userId: leave.userId, leaveTypeId },
    {
      $inc: { used: 1 },
      $setOnInsert: {
        userId: leave.userId,
        leaveTypeId,
        accrued: 0,
        total: 0,
        carryForwarded: 0,
      },
    },
    { upsert: true }
  );
} else {
  console.log(`Balance update skipped (status=${status}, cameFromDateField=${isOriginallyFromDateField})`);
}


    // Migrate to LeaveApplication
    await LeaveApplication.create({
      userId: leave.userId,
      leaveTypeId,
      dates: datesArr,
      totalDays,
      leaveReason: leave.leaveReason || 'Migrated Leave',
      status: leave.status || 'approved',
      isUnpaid: code === 'LOP',
      isDeleted: leave.isDeleted || false,
      approvedBy: leave.approvedBy,
      rejectedBy: leave.rejectedBy,
      appliedOn: leave.createdAt || new Date(),
    });

    console.log(`Migrated to LeaveApplication for user ${leave.userId} (${totalDays} day(s))`);
  }

  console.log('Migration complete!');
  await mongoose.disconnect();
}

migrateLeaves().catch((err) => {
  console.error('Migration failed:', err);
  mongoose.disconnect();
});
