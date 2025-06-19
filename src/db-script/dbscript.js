// const mongoose = require('mongoose');
// const LeavePolicy = require('../models/leavePolicyModel');
// const LeaveType = require('../models/leaveTypeModel');
// const LeavePolicyMapping = require('../models/leavePolicyMappingModel');

// async function setupLeaveSystem() {
//   await mongoose.connect(
//     'mongodb+srv://Lokesh-Bijarniya:Sikar%40123@cluster0.2oyc6pu.mongodb.net/hrms?retryWrites=true&w=majority'
//   ); // Update as needed

//   // 1. Create Leave Policies
//   const [onrollPolicy] = await LeavePolicy.create([
//     { name: 'Onroll Policy', description: 'Policy for onroll employees' },
//   ]);
//   const [probationPolicy] = await LeavePolicy.create([
//     { name: 'Probation Policy', description: 'Policy for probation employees' },
//   ]);

//   // 2. Create Leave Types
//   const leaveTypesData = [
//     {
//       name: 'Annual Leave',
//       code: 'ANNUAL',
//       defaultQuota: 16,
//       isCarryForward: true,
//       isAccrued: true,
//       defaultAccrualType: 'monthly',
//       isDeleted: false,
//     },
//     {
//       name: 'Casual / Sick Leave',
//       code: 'CASUAL',
//       defaultQuota: 8,
//       isCarryForward: true,
//       isAccrued: true,
//       defaultAccrualType: 'monthly',
//       isDeleted: false,
//     },
//     {
//       name: 'Marriage Leave',
//       code: 'MARRIAGE',
//       defaultQuota: 5,
//       isCarryForward: true,
//       isAccrued: true,
//       defaultAccrualType: 'yearly',
//       isDeleted: false,
//     },
//     {
//       name: 'Bereavement Leave',
//       code: 'BEREAVEMENT',
//       defaultQuota: 3,
//       isCarryForward: true,
//       isAccrued: true,
//       defaultAccrualType: 'yearly',
//       isDeleted: false,
//     },
//     {
//       name: 'Birthday Leave',
//       code: 'BIRTHDAY',
//       defaultQuota: 1,
//       isCarryForward: true,
//       isAccrued: true,
//       defaultAccrualType: 'yearly',
//       isDeleted: false,
//     },
//     {
//       name: 'LOP',
//       code: 'LOP',
//       defaultQuota: 0,
//       isCarryForward: true,
//       isAccrued: true,
//       defaultAccrualType: 'none',
//       isDeleted: false,
//     },
//     {
//       name: 'Probation Leave',
//       code: 'PROBATION',
//       defaultQuota: 0,
//       isCarryForward: true,
//       isAccrued: true,
//       defaultAccrualType: 'monthly',
//       isDeleted: false,
//     },
//   ];
//   const leaveTypes = await LeaveType.insertMany(leaveTypesData);

//   // 3. Create Policy Mappings
//   // Find the "Probation" leave type
//   const probationLeaveType = leaveTypes.find(
//     (lt) => lt.code === 'PROBATION' || lt.code === 'LOP'
//   );
//   // All except "Probation"
//   const onrollLeaveTypes = leaveTypes.filter(
//     (lt) => lt.code !== 'PROBATION'
//   );

//   // Onroll mappings
//   const onrollMappings = onrollLeaveTypes.map((lt) => ({
//     leavePolicyId: onrollPolicy._id,
//     leaveTypeId: lt._id,
//     quota: lt.defaultQuota,
//     accrualType:
//       lt.defaultAccrualType === 'none' ? 'yearly' : lt.defaultAccrualType,
//     accrualPerMonth:
//       lt.defaultAccrualType === 'monthly'
//         ? lt.code === 'ANNUAL'
//           ? 1.33
//           : lt.code === 'CASUAL'
//             ? 0.66
//             : lt.code === 'PROBATION'
//               ? 1
//               : 0
//         : 0,
//     maxCarryForward: lt.isCarryForward
//       ? lt.code === 'ANNUAL'
//         ? 20
//         : lt.code === 'CASUAL'
//           ? 10
//           : lt.code === 'PROBATION'
//             ? 10
//             : 0
//       : 0,
//     isDeleted: false,
//   }));

//   // Probation mapping
//   const probationMappings = [
//     {
//       leavePolicyId: probationPolicy._id,
//       leaveTypeId: probationLeaveType._id,
//       quota: 0,
//       accrualType: 'monthly',
//       accrualPerMonth: 1,
//       maxCarryForward: 10,
//       isDeleted: false,
//     },
//   ];

//   await LeavePolicyMapping.insertMany([
//     ...onrollMappings,
//     ...probationMappings,
//   ]);

//   console.log('✅ Leave system setup complete!');
//   await mongoose.disconnect();
// }

// setupLeaveSystem().catch((err) => {
//   console.error('❌ Error setting up leave system:', err);
//   mongoose.disconnect();
// });

const mongoose = require('mongoose');
const {
  isValid,
  startOfYear,
  differenceInCalendarMonths,
} = require('date-fns');

const User = require('../models/userModel');
const Leave = require('../models/leaveModel');
const LeaveType = require('../models/leaveTypeModel');
const LeavePolicy = require('../models/leavePolicyModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');

async function updateUserLeaveSystem() {
  await mongoose.connect(
    'mongodb+srv://Lokesh-Bijarniya:Sikar%40123@cluster0.2oyc6pu.mongodb.net/hrms?retryWrites=true&w=majority'
  );

  // Step 1: Get Policies
  const onrollPolicy = await LeavePolicy.findOne({ name: 'Onroll Policy' });
  const probationPolicy = await LeavePolicy.findOne({
    name: 'Probation Policy',
  });

  if (!onrollPolicy || !probationPolicy) throw new Error('Policy not found');

  // Step 2: Load LeaveTypes and Mappings
  const leaveTypes = await LeaveType.find({ isDeleted: false });
  const leaveTypeMap = new Map();
  leaveTypes.forEach((lt) => leaveTypeMap.set(lt._id.toString(), lt));

  const mappings = await LeavePolicyMapping.find({ isDeleted: false });

  const users = await User.find({ isDeleted: false });

  for (const user of users) {
    const status = user.status?.toLowerCase() || 'onroll';
    const policy = status === 'probation' ? probationPolicy : onrollPolicy;
    user.leavePolicyId = policy._id;

    await User.updateOne(
      { _id: user._id },
      { $unset: { leaves: 1 }, $set: { leavePolicyId: policy._id } }
    );

    const doj = new Date(user.hireDate || user.createdAt);
    const today = new Date();

    let monthsWorked = 1;

    if (isValid(doj)) {
      const dojYear = doj.getFullYear();
      const currentYear = today.getFullYear();

      const accrualStart = dojYear < currentYear ? startOfYear(today) : doj;
      monthsWorked = Math.max(
        differenceInCalendarMonths(today, accrualStart) + 1,
        1
      );
    }

    // Get relevant mappings for this user's policy
    const userMappings = mappings.filter(
      (m) => m.leavePolicyId.toString() === policy._id.toString()
    );

    for (const map of userMappings) {
      const lt = leaveTypeMap.get(map.leaveTypeId.toString());
      if (!lt) continue;

      // 🎯 Compute accrued
      let accrued = 0;
      if (map.accrualType === 'monthly') {
        accrued = +(map.accrualPerMonth * monthsWorked).toFixed(2);
      } else {
        accrued = map.quota;
      }

      const legacyToCodeMap = {
        annualLeave: 'ANNUAL',
        casualSickLeave: 'CASUAL',
        bereavementLeaves: 'BEREAVEMENT',
        marriageLeave: 'MARRIAGE',
        birthdayLeave: 'BIRTHDAY',
        monthlyleave: 'PROBATION',
      };

      const legacyLeaveType =
        Object.entries(legacyToCodeMap).find(
          ([key, val]) => val === lt.code
        )?.[0] || lt.code.toLowerCase();

      const approvedLeaves = await Leave.find({
        userId: user._id,
        $or: [
          { leaveType: legacyLeaveType }, // ← Don't lowercase
          { leaveTypeId: lt._id },
        ],
        status: 'approved',
        isDeleted: false,
      });

      let used = 0;

      for (const leave of approvedLeaves) {
        if (Array.isArray(leave.dates)) {
          used += leave.dates.length;
        }
      }

      await EmployeeLeaveBalance.updateOne(
        {
          userId: user._id,
          leaveTypeId: map.leaveTypeId,
        },
        {
          $set: {
            userId: user._id,
            leaveTypeId: map.leaveTypeId,
            accrued,
            used,
            total: accrued,
            carryForwarded: 0,
          },
        },
        { upsert: true }
      );
    }

    console.log(`✅ Updated user: ${user.name || user._id}`);
  }

  console.log('🎉 All users updated successfully');
  await mongoose.disconnect();
}

updateUserLeaveSystem().catch((err) => {
  console.error('❌ Error:', err);
  mongoose.disconnect();
});
