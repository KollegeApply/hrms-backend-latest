/**
 * One-time migration: maps a fixed list of employees to their Zonal Head by
 * setting `zonalHeadId` on their User document. This is the "temporary
 * workaround" from the Sales Expense & Zoho Reporting Automation PRD, and is
 * scoped ONLY to the employees listed in MAPPING below — nobody else's
 * approval flow changes.
 *
 * Zonal Heads and employees are matched by name / employeeId respectively;
 * nothing is written until you've reviewed the DRY RUN output, because a
 * wrong match here would misroute real expense approvals.
 *
 * Usage (from hrms-backend-latest):
 *   NODE_ENV=development MIGRATION_DRY_RUN=true node scripts/setZonalHeadMapping.js
 *   NODE_ENV=development node scripts/setZonalHeadMapping.js
 *
 * Requires MONGO_URI (or MONGODB_URI) in .env.<NODE_ENV> (or .env).
 */

const mongoose = require('mongoose');
const path = require('path');

if (process.env.NODE_ENV) {
  require('dotenv').config({ path: `.env.${process.env.NODE_ENV}` });
} else {
  const envPaths = [
    path.resolve(__dirname, '../.env.development'),
    path.resolve(__dirname, '../.env.local'),
    path.resolve(__dirname, '../.env'),
  ];
  for (const envPath of envPaths) {
    try {
      require('dotenv').config({ path: envPath });
      break;
    } catch (err) {
      // continue
    }
  }
}

const User = require('../src/models/userModel');

const DRY_RUN = process.env.MIGRATION_DRY_RUN === 'true' || process.env.MIGRATION_DRY_RUN === '1';

// Zonal Head name → the employeeIds (KAPP IDs) that report into that zone.
const MAPPING = [
  {
    zonalHeadName: 'Chandraprakash Awasthi',
    employeeIds: ['KAP_223', 'KAP_226', 'KAP_554', 'KAP_526', 'KAP_593'],
  },
  {
    zonalHeadName: 'Kalpana Dagar',
    employeeIds: ['KAP_508', 'KAP_531', 'KAP_530', 'KAP_499'],
  },
  {
    zonalHeadName: 'Manoj Sharma',
    employeeIds: [
      'KAP_130', 'KAP_235', 'KAP_450', 'KAP_221', 'KAP_320', 'KAP_128',
      'KAP_217', 'KAP_595', 'KAP_374', 'KAP_547', 'KAP_220', 'KAP_218',
      'KAP_549', 'KAP_569',
    ],
  },
  {
    zonalHeadName: 'Raghav Luthra',
    employeeIds: ['KAP_129', 'KAP_219', 'KAP_555'],
  },
];

/** Accepts the employeeId as given, or with/without the underscore, since we
 *  don't know the exact stored format ahead of time. */
function employeeIdVariants(empId) {
  const trimmed = empId.trim();
  return [...new Set([trimmed, trimmed.replace('_', ''), trimmed.replace(/^KAP_?/i, 'KAP_')])];
}

async function findZonalHead(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const users = await User.find({ isDeleted: { $ne: true } })
    .select('firstName lastName employeeId email role')
    .lean();

  const matches = users.filter((u) => {
    const name = `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase();
    return parts.every((part) => name.includes(part.toLowerCase()));
  });

  return matches;
}

async function findEmployee(empId) {
  const variants = employeeIdVariants(empId);
  return User.findOne({
    employeeId: { $in: variants },
    isDeleted: { $ne: true },
  }).select('firstName lastName employeeId zonalHeadId');
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('No MONGO_URI/MONGODB_URI found in env.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log(`Connected to "${mongoose.connection.name}". Dry run: ${DRY_RUN}\n`);

  const applied = [];
  const skipped = [];

  for (const group of MAPPING) {
    const candidates = await findZonalHead(group.zonalHeadName);

    if (candidates.length !== 1) {
      console.log(
        `\n[SKIP GROUP] "${group.zonalHeadName}" — found ${candidates.length} matching user(s), expected exactly 1.`
      );
      candidates.forEach((c) =>
        console.log(`    candidate: ${c.firstName} ${c.lastName || ''} (employeeId=${c.employeeId}, email=${c.email})`)
      );
      group.employeeIds.forEach((empId) =>
        skipped.push({ empId, reason: `Zonal Head "${group.zonalHeadName}" not uniquely resolved` })
      );
      continue;
    }

    const zonalHead = candidates[0];
    console.log(
      `\n${group.zonalHeadName} -> ${zonalHead.firstName} ${zonalHead.lastName || ''} (_id=${zonalHead._id})`
    );

    for (const empId of group.employeeIds) {
      const employee = await findEmployee(empId);
      if (!employee) {
        console.log(`  ${empId} -> NOT FOUND, skipping`);
        skipped.push({ empId, reason: 'employee not found' });
        continue;
      }

      const alreadySet = employee.zonalHeadId?.toString() === zonalHead._id.toString();
      console.log(
        `  ${empId} -> ${employee.firstName} ${employee.lastName || ''}` +
          (alreadySet ? ' (already mapped, no change)' : ` — setting zonalHeadId`)
      );

      if (!alreadySet) {
        if (!DRY_RUN) {
          employee.zonalHeadId = zonalHead._id;
          await employee.save();
        }
        applied.push({ empId, employee: `${employee.firstName} ${employee.lastName || ''}`, zonalHead: group.zonalHeadName });
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`${applied.length} mapping(s) ${DRY_RUN ? 'would be applied' : 'applied'}.`);
  console.log(`${skipped.length} skipped (needs manual attention):`);
  skipped.forEach((s) => console.log(`  ${s.empId}: ${s.reason}`));

  if (DRY_RUN) {
    console.log('\nDRY RUN — no documents were written. Re-run without MIGRATION_DRY_RUN to apply.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
