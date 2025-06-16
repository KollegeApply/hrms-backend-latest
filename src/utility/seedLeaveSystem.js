const mongoose = require('mongoose');
const LeaveType = require('../models/leaveTypeModel');
const LeavePolicy = require('../models/leavePolicyModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');

const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb+srv://Lokesh-Bijarniya:Sikar%40123@cluster0.2oyc6pu.mongodb.net/hrms?retryWrites=true&w=majority';

async function seed() {
  await mongoose.connect(MONGO_URI);

  // 1. Seed Leave Types
  const leaveTypes = [
    {
      name: 'Annual Leave',
      code: 'ANNUAL',
      defaultQuota: 16,
      isCarryForward: true,
      isAccrued: true,
      defaultAccrualType: 'monthly',
    },
    {
      name: 'Casual / Sick Leave',
      code: 'CASUAL',
      defaultQuota: 8,
      isCarryForward: true,
      isAccrued: true,
      defaultAccrualType: 'monthly',
    },
    {
      name: 'Bereavement Leave',
      code: 'BEREAVEMENT',
      defaultQuota: 3,
      isCarryForward: false,
      isAccrued: false,
      defaultAccrualType: 'none',
    },
    {
      name: 'Marriage Leave',
      code: 'MARRIAGE',
      defaultQuota: 5,
      isCarryForward: false,
      isAccrued: false,
      defaultAccrualType: 'none',
    },
    {
      name: 'Birthday Leave',
      code: 'BIRTHDAY',
      defaultQuota: 1,
      isCarryForward: false,
      isAccrued: false,
      defaultAccrualType: 'none',
    },
  ];
  await LeaveType.deleteMany({});
  const leaveTypeDocs = await LeaveType.insertMany(leaveTypes);

  // 2. Seed Leave Policies
  const policies = [
    { name: 'Onroll Policy', description: 'Policy for on-roll employees' },
    { name: 'Probation Policy', description: 'Policy for probation employees' },
  ];
  await LeavePolicy.deleteMany({});
  const policyDocs = await LeavePolicy.insertMany(policies);

  // 3. Seed Leave Policy Mappings
  const annualType = leaveTypeDocs.find((t) => t.code === 'ANNUAL');
  const casualType = leaveTypeDocs.find((t) => t.code === 'CASUAL');
  const bereavementType = leaveTypeDocs.find((t) => t.code === 'BEREAVEMENT');
  const marriageType = leaveTypeDocs.find((t) => t.code === 'MARRIAGE');
  const birthdayType = leaveTypeDocs.find((t) => t.code === 'BIRTHDAY');
  const onrollPolicy = policyDocs.find((p) => p.name === 'Onroll Policy');
  const probationPolicy = policyDocs.find((p) => p.name === 'Probation Policy');

  const mappings = [
    // Onroll Policy (on-roll)
    {
      leavePolicyId: onrollPolicy._id,
      leaveTypeId: annualType._id,
      quota: 16,
      accrualType: 'monthly',
      accrualPerMonth: 1.33,
      maxCarryForward: 30,
      allowNegativeBalance: false,
    },
    {
      leavePolicyId: onrollPolicy._id,
      leaveTypeId: casualType._id,
      quota: 8,
      accrualType: 'monthly',
      accrualPerMonth: 0.66,
      maxCarryForward: 30,
      allowNegativeBalance: false,
    },
    {
      leavePolicyId: onrollPolicy._id,
      leaveTypeId: bereavementType._id,
      quota: 3,
      accrualType: 'none',
      accrualPerMonth: 0,
      maxCarryForward: 0,
      allowNegativeBalance: false,
    },
    {
      leavePolicyId: onrollPolicy._id,
      leaveTypeId: marriageType._id,
      quota: 5,
      accrualType: 'none',
      accrualPerMonth: 0,
      maxCarryForward: 0,
      allowNegativeBalance: false,
    },
    {
      leavePolicyId: onrollPolicy._id,
      leaveTypeId: birthdayType._id,
      quota: 1,
      accrualType: 'none',
      accrualPerMonth: 0,
      maxCarryForward: 0,
      allowNegativeBalance: false,
    },
    // Probation Policy
    {
      leavePolicyId: probationPolicy._id,
      leaveTypeId: casualType._id,
      quota: 0,
      accrualType: 'monthly',
      accrualPerMonth: 1,
      maxCarryForward: 0,
      allowNegativeBalance: false,
    },
  ];
  await LeavePolicyMapping.deleteMany({});
  await LeavePolicyMapping.insertMany(mappings);

  console.log('✅ Leave system seed complete!');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('❌ Seed error:', err);
  process.exit(1);
});
