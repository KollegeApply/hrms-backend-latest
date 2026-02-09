/**
 * Test script to manually test biometric sync with attendance
 * Run this to check if biometric logs are syncing correctly
 */

const mongoose = require('mongoose');
const path = require('path');

// Try different env file locations
const envPaths = [
  path.resolve(__dirname, '../../.env.development'),
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env')
];

for (const envPath of envPaths) {
  try {
    require('dotenv').config({ path: envPath });
    break;
  } catch (error) {
    // Continue to next path
  }
}

const BiometricLog = require('../models/biometricLogModel');
const User = require('../models/userModel');
const Attendance = require('../models/attendanceModel');
const moment = require('moment-timezone');

/**
 * Converts employeeCode format (SD116) to employeeId format (SD_116)
 */
function convertEmployeeCodeToEmployeeId(employeeCode) {
  if (!employeeCode || typeof employeeCode !== 'string') {
    return employeeCode;
  }
  return employeeCode.replace(/([A-Za-z]+)(\d+)/, '$1_$2');
}

async function testBiometricSync() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('No MongoDB URI found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected successfully\n');

    // Get a sample biometric log
    const biometricLog = await BiometricLog.findOne({
      employeeCode: { $exists: true, $ne: null }
    }).sort({ createdAt: -1 });

    if (!biometricLog) {
      console.log('❌ No biometric logs found in database');
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log('📋 Found biometric log:');
    console.log({
      _id: biometricLog._id,
      employeeCode: biometricLog.employeeCode,
      logDate: biometricLog.logDate,
      user: biometricLog.user,
    });
    console.log('');

    // Convert employeeCode to employeeId format
    const convertedEmployeeId = convertEmployeeCodeToEmployeeId(biometricLog.employeeCode);
    console.log('🔄 Converting employeeCode:');
    console.log({
      original: biometricLog.employeeCode,
      converted: convertedEmployeeId,
    });
    console.log('');

    // Find user
    const user = await User.findOne({
      employeeId: convertedEmployeeId,
      isDeleted: { $ne: true },
    }).select('_id employeeId firstName lastName');

    if (!user) {
      console.log('❌ User not found for employeeCode:', biometricLog.employeeCode);
      console.log('   Converted employeeId:', convertedEmployeeId);
      
      // Show sample employeeIds
      const sampleUsers = await User.find({
        isDeleted: { $ne: true },
        employeeId: { $exists: true, $ne: null }
      }).select('employeeId').limit(5).lean();
      
      console.log('\n📝 Sample employeeIds in database:');
      sampleUsers.forEach(u => console.log('   -', u.employeeId));
      
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log('✅ User found:');
    console.log({
      _id: user._id,
      employeeId: user.employeeId,
      name: `${user.firstName} ${user.lastName}`,
    });
    console.log('');

    // Get date range for attendance
    const logDateIST = moment(biometricLog.logDate).tz('Asia/Kolkata').startOf('day');
    const attendanceDate = logDateIST.toDate();
    const endOfDay = moment(logDateIST).add(1, 'day').toDate();

    console.log('📅 Date range for attendance:');
    console.log({
      logDate: biometricLog.logDate,
      attendanceDate: attendanceDate,
      endOfDay: endOfDay,
    });
    console.log('');

    // Find attendance record
    let attendance = await Attendance.findOne({
      user: user._id,
      date: attendanceDate,
    });

    if (!attendance) {
      attendance = await Attendance.findOne({
        user: user._id,
        date: {
          $gte: attendanceDate,
          $lt: endOfDay,
        },
      });
    }

    if (!attendance) {
      console.log('⚠️  No attendance record found, creating new one...');
      attendance = new Attendance({
        user: user._id,
        date: attendanceDate,
      });
      await attendance.save();
      console.log('✅ Created new attendance record');
    } else {
      console.log('✅ Found existing attendance record:');
      console.log({
        _id: attendance._id,
        date: attendance.date,
        biometricCheckIn: attendance.biometricCheckIn,
        biometricCheckOut: attendance.biometricCheckOut,
      });
    }
    console.log('');

    // Get all biometric logs for this employeeCode on this date
    const biometricLogsForDay = await BiometricLog.find({
      employeeCode: { $regex: new RegExp(`^${biometricLog.employeeCode}$`, 'i') },
      logDate: {
        $gte: logDateIST.toDate(),
        $lt: endOfDay,
      },
    }).sort({ logDate: 1 }).select('logDate direction employeeCode').lean();

    console.log('📊 Biometric logs for the day:');
    console.log({
      employeeCode: biometricLog.employeeCode,
      totalLogs: biometricLogsForDay.length,
      logs: biometricLogsForDay.map(log => ({
        logDate: log.logDate,
        direction: log.direction,
        employeeCode: log.employeeCode,
      })),
    });
    console.log('');

    if (biometricLogsForDay.length === 0) {
      console.log('❌ No biometric logs found for the date range!');
      console.log('   This might be a date/timezone issue.');
      
      // Check for any logs with this employeeCode
      const anyLogs = await BiometricLog.find({
        employeeCode: { $regex: new RegExp(`^${biometricLog.employeeCode}$`, 'i') },
      }).sort({ logDate: -1 }).limit(5).select('logDate employeeCode').lean();
      
      console.log('\n📋 Recent logs for this employeeCode:');
      anyLogs.forEach(log => {
        console.log({
          logDate: log.logDate,
          employeeCode: log.employeeCode,
        });
      });
      
      await mongoose.connection.close();
      process.exit(0);
    }

    // Set biometricCheckIn if not set
    if (biometricLogsForDay.length > 0 && !attendance.biometricCheckIn) {
      const firstLogTime = biometricLogsForDay[0].logDate;
      attendance.biometricCheckIn = firstLogTime;
      console.log('✅ Setting biometricCheckIn:', firstLogTime);
    } else if (attendance.biometricCheckIn) {
      console.log('ℹ️  biometricCheckIn already set:', attendance.biometricCheckIn);
    }

    // Update biometricCheckOut
    if (biometricLogsForDay.length > 0) {
      const lastLogTime = biometricLogsForDay[biometricLogsForDay.length - 1].logDate;
      const previousCheckOut = attendance.biometricCheckOut;
      attendance.biometricCheckOut = lastLogTime;
      console.log('✅ Updating biometricCheckOut:', {
        previous: previousCheckOut,
        new: lastLogTime,
      });
    }

    // Save attendance
    await attendance.save();
    console.log('');

    // Final check
    const finalAttendance = await Attendance.findById(attendance._id);
    console.log('✅ Final attendance record:');
    console.log({
      _id: finalAttendance._id,
      date: finalAttendance.date,
      biometricCheckIn: finalAttendance.biometricCheckIn,
      biometricCheckOut: finalAttendance.biometricCheckOut,
    });

    await mongoose.connection.close();
    console.log('\n✅ Test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testBiometricSync();

