import mongoose from 'mongoose';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env.development' });

import LeavePolicy from '../models/leavePolicyModel.js';
import LeavePolicyMapping from '../models/LeavePolicyMapping.js';
import LeaveType from '../models/LeaveType.js';
import User from '../models/User.js';
import EmployeeLeaveBalance from '../models/EmployeeLeaveBalance.js';
import Leave from '../models/Leave.js';
import { differenceInCalendarMonths, startOfYear, isValid } from 'date-fns';

// JSON → CSV converter
function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','), // header row
    ...rows.map(row =>
      headers
        .map(h => {
          let val = row[h] ?? '';
          if (typeof val === 'string') val = `"${val.replace(/"/g, '""')}"`;
          return val;
        })
        .join(',')
    )
  ];
  return lines.join('\n');
}

async function checkLeaveBalances() {
  console.log('🔎 Checking leave balances...');

  const onrollPolicy = await LeavePolicy.findOne({ name: 'Onroll Policy' });
  const probationPolicy = await LeavePolicy.findOne({ name: 'Probation Policy' });

  if (!onrollPolicy || !probationPolicy) {
    console.error('❌ Required policies not found!');
    return;
  }

  const leaveTypes = await LeaveType.find({ isDeleted: false });
  const leaveTypeMap = new Map(leaveTypes.map(lt => [lt._id.toString(), lt]));

  const mappings = await LeavePolicyMapping.find({ isDeleted: false });
  const users = await User.find({ isDeleted: false });

  // Group discrepancies by team
  const teamDiscrepancies = {};

  for (const user of users) {
    const status = user.status?.toLowerCase() || 'onroll';
    const policy = status === 'probation' ? probationPolicy : onrollPolicy;

    const doj = new Date(user.hireDate || user.createdAt);
    const today = new Date();

    let monthsWorked = 1;
    if (isValid(doj)) {
      const dojYear = doj.getFullYear();
      const currentYear = today.getFullYear();
      const accrualStart = dojYear < currentYear ? startOfYear(today) : doj;
      monthsWorked = Math.max(differenceInCalendarMonths(today, accrualStart) + 1, 1);
    }

    const userMappings = mappings.filter(
      m => m.leavePolicyId.toString() === policy._id.toString()
    );

    for (const map of userMappings) {
      const lt = leaveTypeMap.get(map.leaveTypeId.toString());
      if (!lt) continue;

      const expectedAccrued = map.accrualType === 'monthly'
        ? +(map.accrualPerMonth * monthsWorked).toFixed(2)
        : map.quota;

      const approvedLeaves = await Leave.find({
        userId: user._id,
        $or: [{ leaveTypeId: lt._id }],
        status: 'approved',
        isDeleted: false,
      });

      const expectedUsed = approvedLeaves.reduce(
        (sum, leave) => sum + (Array.isArray(leave.dates) ? leave.dates.length : 0),
        0
      );

      const actual = await EmployeeLeaveBalance.findOne({
        userId: user._id,
        leaveTypeId: lt._id,
      });

      if (!actual || actual.accrued !== expectedAccrued || actual.used !== expectedUsed) {
        const teamName = user.team || user.department?.name || 'Unknown';
        if (!teamDiscrepancies[teamName]) teamDiscrepancies[teamName] = [];

        teamDiscrepancies[teamName].push({
          userId: user._id.toString(),
          user: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          status,
          leaveType: lt.code,
          expectedAccrued,
          expectedUsed,
          actualAccrued: actual?.accrued ?? 0,
          actualUsed: actual?.used ?? 0,
        });
      }
    }
  }

  // Write CSVs per team
  for (const [team, rows] of Object.entries(teamDiscrepancies)) {
    if (!rows.length) continue;
    const csv = toCSV(rows);
    const filename = `leave_discrepancies_${team.replace(/\s+/g, '_')}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    fs.writeFileSync(filename, csv, 'utf8');
    console.log(`⚠️ Exported ${rows.length} discrepancies for team "${team}" → ${filename}`);
  }

  if (!Object.keys(teamDiscrepancies).length) console.log('✅ All balances look good!');
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    await checkLeaveBalances();
    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
})();