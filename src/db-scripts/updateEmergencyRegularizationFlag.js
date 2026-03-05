const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
if (process.env.NODE_ENV) {
  require('dotenv').config({
    path: `.env.${process.env.NODE_ENV}`,
  });
} else {
  require('dotenv').config({
    path: path.resolve(__dirname, '../../.env.development'),
  });
}

const User = require('../models/userModel');
const Department = require('../models/departmentModel');

async function updateEmergencyRegularizationFlag() {
  try {
    console.log('🚀 Starting Emergency Regularization Flag Update Script...\n');

    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('MongoDB URI not found in MONGO_URI or DATABASE_URL');
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB\n');

    // Find the "Sales" department (case-insensitive)
    const salesDepartment = await Department.findOne({
      name: { $regex: /^sales$/i },
      isDeleted: false,
    });

    if (salesDepartment) {
      console.log(`📁 Found Sales department with id: ${salesDepartment._id}\n`);
    } else {
      console.log(
        '⚠️ No department named "Sales" found (case-insensitive). ' +
          'Condition "department sales na ho" will be skipped in filter.\n'
      );
    }

    // Base filter: only users who currently have emergency regularization allowed
    const baseFilter = {
      isEmergencyRegularizationAllowed: true,
      isDeleted: false,
    };

    // We ONLY want to turn flag off when:
    // 1) shiftTime is 10:15 (variants allowed) AND department != Sales AND workType != WFH
    // 2) OR shiftTime is null AND department != Sales AND workType != WFH
    //
    // Baaki saare cases me flag as-is rehna chahiye.

    const tenFifteenRegex = /^10:15(\s*am)?$/i;

    // Case 1: shiftTime == 10:15, not Sales, not WFH
    const tenFifteenAndConditions = [
      { shiftTime: { $regex: tenFifteenRegex } },
      { workType: { $ne: 'WFH' } },
    ];

    // Case 2: shiftTime == null, not Sales, not WFH
    const nullShiftAndConditions = [
      { shiftTime: null },
      { workType: { $ne: 'WFH' } },
    ];

    if (salesDepartment) {
      tenFifteenAndConditions.push({
        department: { $ne: salesDepartment._id },
      });
      nullShiftAndConditions.push({
        department: { $ne: salesDepartment._id },
      });
    }

    const finalFilter = {
      ...baseFilter,
      $or: [{ $and: tenFifteenAndConditions }, { $and: nullShiftAndConditions }],
    };

    console.log('🔍 Applying filter to update users where:');
    console.log(
      '- isEmergencyRegularizationAllowed == true\n' +
        '- AND ((shiftTime == 10:15 AND department != Sales AND workType != WFH)\n' +
        '     OR (shiftTime == null AND department != Sales AND workType != WFH))\n'
    );

    const result = await User.updateMany(finalFilter, {
      $set: { isEmergencyRegularizationAllowed: false },
    });

    console.log('📊 Update Result:');
    console.log(`   - Matched users : ${result.matchedCount || result.n}`);
    console.log(`   - Modified users: ${result.modifiedCount || result.nModified}\n`);

    console.log('🎉 Emergency Regularization Flag Update Script Completed!\n');
  } catch (err) {
    console.error('❌ Error while updating emergency regularization flags:', err);
    throw err;
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script directly
if (require.main === module) {
  updateEmergencyRegularizationFlag()
    .then(() => {
      console.log('✨ Script finished successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Script failed:', error);
      process.exit(1);
    });
}

module.exports = { updateEmergencyRegularizationFlag };

