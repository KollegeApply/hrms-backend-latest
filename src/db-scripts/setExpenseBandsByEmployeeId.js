/**
 * Sets user.expenseBand from employeeId using expenseBandEmployeeMapping.js
 * (K1–K3 explicit list; all other employees → K4).
 *
 * Usage (from repo root):
 *   NODE_ENV=development node src/db-scripts/setExpenseBandsByEmployeeId.js
 *   MIGRATION_DRY_RUN=true NODE_ENV=development node src/db-scripts/setExpenseBandsByEmployeeId.js
 *
 * Requires MONGO_URI or DATABASE_URL in .env.<NODE_ENV>
 */

const mongoose = require('mongoose');
const path = require('path');

if (process.env.NODE_ENV) {
  require('dotenv').config({ path: `.env.${process.env.NODE_ENV}` });
} else {
  require('dotenv').config({
    path: path.resolve(__dirname, '../../.env.development'),
  });
}

const User = require('../models/userModel');
const {
  getExpenseBandForEmployeeId,
  normalizeEmployeeId,
  validateMapping,
} = require('./expenseBandEmployeeMapping');

const DRY_RUN =
  process.env.MIGRATION_DRY_RUN === 'true' || process.env.MIGRATION_DRY_RUN === '1';

async function setExpenseBandsByEmployeeId() {
  const mappingStats = validateMapping();
  console.log('Expense band mapping loaded:', mappingStats);
  console.log(DRY_RUN ? '\nDRY RUN — no writes\n' : '\nLive run — updating MongoDB\n');

  const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
  if (!mongoUri) {
    throw new Error('MongoDB URI not found in MONGO_URI or DATABASE_URL');
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');

  const users = await User.find({ isDeleted: { $ne: true } })
    .select('firstName lastName email employeeId expenseBand')
    .lean();

  const summary = {
    total: users.length,
    updated: 0,
    unchanged: 0,
    noEmployeeId: 0,
    byBand: { K1: 0, K2: 0, K3: 0, K4: 0 },
    byTargetBand: { K1: 0, K2: 0, K3: 0, K4: 0 },
  };

  const bulkOps = [];

  for (const user of users) {
    if (!user.employeeId) {
      summary.noEmployeeId++;
      continue;
    }

    const targetBand = getExpenseBandForEmployeeId(user.employeeId);
    summary.byTargetBand[targetBand]++;

    const current = user.expenseBand || null;
    if (current === targetBand) {
      summary.unchanged++;
      if (targetBand !== 'K4') summary.byBand[targetBand]++;
      continue;
    }

    summary.updated++;
    if (targetBand !== 'K4') summary.byBand[targetBand]++;

    const label = `${normalizeEmployeeId(user.employeeId)} | ${user.firstName} ${user.lastName}`;
    console.log(`  ${current || '(none)'} → ${targetBand}  ${label}`);

    if (!DRY_RUN) {
      bulkOps.push({
        updateOne: {
          filter: { _id: user._id },
          update: { $set: { expenseBand: targetBand } },
        },
      });
    }
  }

  if (!DRY_RUN && bulkOps.length > 0) {
    const result = await User.bulkWrite(bulkOps, { ordered: false });
    console.log(`\nbulkWrite matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);
  }

  console.log('\n--- Summary ---');
  console.log(`Users scanned:        ${summary.total}`);
  console.log(`No employeeId:        ${summary.noEmployeeId} (skipped)`);
  console.log(`Would change / changed: ${summary.updated}`);
  console.log(`Already correct:      ${summary.unchanged}`);
  console.log('Target band counts (users with employeeId):');
  console.log(`  K1: ${summary.byTargetBand.K1}`);
  console.log(`  K2: ${summary.byTargetBand.K2}`);
  console.log(`  K3: ${summary.byTargetBand.K3}`);
  console.log(`  K4: ${summary.byTargetBand.K4}`);
  console.log('Non-K4 updates this run:', summary.byBand);
}

if (require.main === module) {
  setExpenseBandsByEmployeeId()
    .then(() => {
      console.log('\nDone.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { setExpenseBandsByEmployeeId };
