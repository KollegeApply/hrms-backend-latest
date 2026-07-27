/**
 * One-time, idempotent script: create a single dummy "Finance" Team Lead
 * user for local UI testing only.
 *
 * This script does NOT touch the Expense workflow, approvals, APIs,
 * routes, permissions, or authentication logic. It only inserts one User
 * document using the existing User schema, exactly like any other user.
 *
 * This creates a clearly-marked dummy account (fixed test email below)
 * regardless of any real, pre-existing Finance Team Lead — it never reads
 * or modifies any other user's data.
 *
 * Usage:
 *   NODE_ENV=development node src/db-scripts/createFinanceTeamLead.js
 *
 * Safe to re-run: if the dummy test account (identified by its fixed
 * test email below) already exists, no duplicate is created — the
 * existing dummy account is reported instead.
 */
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

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/userModel');
const Department = require('../models/departmentModel');

const DEPARTMENT_NAME = 'Finance';
const TEST_TEAM = 'SD';
const TEST_PASSWORD = 'Finance@Test123';
const TEST_EMAIL = 'finance.testlead.dummy@hrms-test.com';

function autoGenerateEmpId(lastUser) {
  let nextNumber = 1;
  if (lastUser?.employeeId) {
    const lastNumber = parseInt(lastUser.employeeId.split('_')[1], 10);
    nextNumber = isNaN(lastNumber) ? 1 : lastNumber + 1;
  }
  return nextNumber;
}

async function createFinanceTeamLead() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('MongoDB URI not found in MONGO_URI or DATABASE_URL');
    }

    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB\n');

    const financeDept = await Department.findOne({
      name: DEPARTMENT_NAME,
      isDeleted: { $ne: true },
    }).lean();

    if (!financeDept) {
      throw new Error(`Department "${DEPARTMENT_NAME}" not found. Nothing was created.`);
    }

    // Only checks for OUR OWN dummy test account (by its fixed test email),
    // not for any real, pre-existing Finance Team Lead. This intentionally
    // creates a distinct dummy account even if a real Finance TL already
    // exists, without ever reading/modifying that real user's data.
    const existingDummy = await User.findOne({
      email: TEST_EMAIL,
      isDeleted: { $ne: true },
    }).lean();

    if (existingDummy) {
      console.log('Finance Team Lead already exists.\n');
      console.log('Email:', existingDummy.email);
      console.log('Employee ID:', existingDummy.employeeId);
      console.log('Mongo _id:', existingDummy._id.toString());
      return;
    }

    const lastUser = await User.findOne({
      employeeId: { $regex: new RegExp(`^${TEST_TEAM}_\\d+$`) },
    })
      .sort({ employeeId: -1 })
      .select('employeeId')
      .lean();
    const nextNumber = autoGenerateEmpId(lastUser);
    const employeeId = `${TEST_TEAM}_${String(nextNumber).padStart(3, '0')}`;

    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);

    const newUser = new User({
      firstName: 'Finance',
      lastName: 'TestLead',
      email: TEST_EMAIL,
      password: hashedPassword,
      employeeId,
      workType: 'WFO',
      role: 'teamlead',
      status: 'onroll',
      department: financeDept._id,
      workingDays: 6,
      team: TEST_TEAM,
      expenseBand: 'K4',
    });

    await newUser.save();

    console.log('Finance Team Lead Created\n');
    console.log('Email:', newUser.email);
    console.log('Password:', TEST_PASSWORD);
    console.log('Employee ID:', newUser.employeeId);
    console.log('Department:', DEPARTMENT_NAME);
    console.log('Role:', newUser.role);
    console.log('Mongo _id:', newUser._id.toString());
  } catch (error) {
    console.error('Script failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
  }
}

createFinanceTeamLead();
