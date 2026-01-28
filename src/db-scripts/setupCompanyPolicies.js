/**
 * One-time script to create BYOD & NDA policy
 * for PROBATION & ONROLL users only
 */

const mongoose = require('mongoose');
const path = require('path');

if (process.env.NODE_ENV) {
  require('dotenv').config({
    path: `.env.${process.env.NODE_ENV}`,
  });
} else {
  require('dotenv').config({
    path: path.resolve(__dirname, '../../.env.development'),
  });
}

// Models
const User = require('../models/userModel');
const CompanyPolicy = require('../models/companypolicyModel');

const POLICY_TYPES = ['BYOD', 'NDA'];

async function setupCompanyPolicies() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) throw new Error('MongoDB URI not found');

    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected\n');

    const users = await User.find({
      isDeleted: { $ne: true },
      status: { $in: ['probation', 'onroll'] },
    }).select('_id firstName lastName employeeId status');

    console.log(`👥 Users found: ${users.length}\n`);

    let created = 0;
    let skipped = 0;

    for (const user of users) {
      for (const policyType of POLICY_TYPES) {
        const exists = await CompanyPolicy.findOne({
          userId: user._id,
          policyType,
          isDeleted: false,
        });

        if (exists) {
          skipped++;
          continue;
        }

        await CompanyPolicy.create({
          userId: user._id,
          policyType,
          status: 'PENDING',
        });

        created++;

        console.log(
          `✅ ${policyType} created for ${user.firstName || ''} ${
            user.lastName || ''
          } (${user.employeeId})`
        );
      }
    }

    console.log('\n🎯 Summary');
    console.log(`Created : ${created}`);
    console.log(`Skipped : ${skipped}`);
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 DB closed');
    process.exit(0);
  }
}

if (require.main === module) {
  setupCompanyPolicies();
}

module.exports = { setupCompanyPolicies };
