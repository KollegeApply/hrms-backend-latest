/**
 * Test script specifically for SD_116 to debug attendance sync
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

async function testSD116Sync() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('No MongoDB URI found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected\n');

    const employeeCode = 'SD116';
    const employeeId = 'SD_116';

    console.log('🔍 Testing for:');
    console.log(`   employeeCode: ${employeeCode}`);
    console.log(`   employeeId: ${employeeId}\n`);

    // Step 1: Find user
    const user = await User.findOne({
      employeeId: employeeId,
      isDeleted: { $ne: true },
    }).select('_id employeeId firstName lastName');

    if (!user) {
      console.log('❌ User NOT found!');
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log('✅ Step 1: User found');
    console.log({
      _id: user._id,
      employeeId: user.employeeId,
      name: `${user.firstName} ${user.lastName}`,
    });
    console.log('');

    // Step 2: Get latest biometric log
    const latestLog = await BiometricLog.findOne({
      employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') }
    }).sort({ logDate: -1 });

    if (!latestLog) {
      console.log('❌ No biometric logs found!');
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log('✅ Step 2: Latest biometric log found');
    console.log({
      _id: latestLog._id,
      employeeCode: latestLog.employeeCode,
      logDate: latestLog.logDate,
    });
    console.log('');

    // Step 3: Calculate date range
    const logDateIST = moment(latestLog.logDate).tz('Asia/Kolkata').startOf('day');
    const attendanceDate = logDateIST.toDate();
    const endOfDay = moment(logDateIST).add(1, 'day').toDate();

    console.log('✅ Step 3: Date calculation');
    console.log({
      originalLogDate: latestLog.logDate,
      logDateIST: logDateIST.format('YYYY-MM-DD HH:mm:ss'),
      attendanceDate: attendanceDate,
      endOfDay: endOfDay,
    });
    console.log('');

    // Step 4: Find attendance record
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
      console.log('⚠️  Step 4: No attendance record found, creating new one...');
      attendance = new Attendance({
        user: user._id,
        date: attendanceDate,
      });
      await attendance.save();
      console.log('✅ Created new attendance record');
    } else {
      console.log('✅ Step 4: Attendance record found');
      console.log({
        _id: attendance._id,
        date: attendance.date,
        current_biometricCheckIn: attendance.biometricCheckIn,
        current_biometricCheckOut: attendance.biometricCheckOut,
      });
    }
    console.log('');

    // Step 5: Query biometric logs for the day (using createdAt instead of logDate)
    const biometricLogsForDay = await BiometricLog.find({
      employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') },
      createdAt: {
        $gte: logDateIST.toDate(),
        $lt: endOfDay,
      },
    })
      .sort({ createdAt: 1 })
      .select('logDate createdAt direction employeeCode')
      .lean();

    console.log('✅ Step 5: Biometric logs query');
    console.log({
      query: {
        employeeCode: employeeCode,
        createdAt: {
          $gte: logDateIST.toDate(),
          $lt: endOfDay,
        },
      },
      totalLogs: biometricLogsForDay.length,
      logs: biometricLogsForDay,
    });
    console.log('');

    if (biometricLogsForDay.length === 0) {
      console.log('❌ No logs found for the date range!');
      
      // Check what logs exist
      const allLogs = await BiometricLog.find({
        employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') }
      }).sort({ logDate: -1 }).limit(5).select('logDate employeeCode').lean();
      
      console.log('\n📋 All logs for this employeeCode:');
      allLogs.forEach((log, i) => {
        const logDateIST = moment(log.logDate).tz('Asia/Kolkata');
        console.log(`   ${i + 1}. ${logDateIST.format('YYYY-MM-DD HH:mm:ss')} (${log.logDate})`);
      });
      
      await mongoose.connection.close();
      process.exit(0);
    }

    // Step 6: Update attendance
    console.log('✅ Step 6: Updating attendance...');
    
    if (biometricLogsForDay.length > 0 && !attendance.biometricCheckIn) {
      // Use createdAt for biometricCheckIn
      const firstLogTime = biometricLogsForDay[0].createdAt;
      attendance.biometricCheckIn = firstLogTime;
      console.log(`   ✅ Setting biometricCheckIn: ${firstLogTime}`);
    } else if (attendance.biometricCheckIn) {
      console.log(`   ℹ️  biometricCheckIn already set: ${attendance.biometricCheckIn}`);
    }

    if (biometricLogsForDay.length > 0) {
      // Use createdAt for biometricCheckOut
      const lastLogTime = biometricLogsForDay[biometricLogsForDay.length - 1].createdAt;
      const previousCheckOut = attendance.biometricCheckOut;
      attendance.biometricCheckOut = lastLogTime;
      console.log(`   ✅ Updating biometricCheckOut: ${previousCheckOut || 'null'} → ${lastLogTime}`);
    }

    await attendance.save();
    console.log('');

    // Step 7: Verify
    const finalAttendance = await Attendance.findById(attendance._id);
    console.log('✅ Step 7: Final attendance record');
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
testSD116Sync();

