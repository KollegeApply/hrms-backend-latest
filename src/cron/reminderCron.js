const User = require('../models/userModel');
const Feedback = require('../models/feedbackModel');
const Helper = require('../utility/helper');
const moment = require('moment-timezone');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const Attendance = require('../models/attendanceModel');
const LeaveApplication = require('../models/leaveApplicationModel');
require('dotenv').config({ path: './.env.production' }); // Make sure in production it is .env.production

/**
 * Send feedback reminders to Team Leads and Sub Team Leads
 */
async function sendFeedbackReminders() {
  try {
    const teamLeads = await User.find({
      role: { $in: ['teamlead', 'subteamlead'] },
      status: { $in: ['probation','onroll'] },
      isDeleted: false
    });

    const dashboardUrl = process.env.HRMS_FRONTEND_URL;

    for (const tl of teamLeads) {
       
        const tlName = `${tl.firstName} ${tl.lastName}`;
        
        Helper.sendEmail({
          receiverEmails: [tl.email],
          subject: 'Team Feedback Reminder',
          message: Helper.getFeedbackReminderForTL( tlName, dashboardUrl, tl.team),
          fromHR: false,
          fromIT: false,
          team: tl.team
        }).catch(err => logger.error('Error sending feedback reminder:', err));

        console.log("Email sent successfully");
    }
  } catch (error) {
    logger.error('Error in sendFeedbackReminders:', error);
  }
}

/**
 * Send attendance check-in reminders to all employees
 */
async function sendAttendanceReminders() {
  try {
    const users = await User.find({ 
      status: { $in: ['probation','onroll'] },
      isDeleted: false,
    });

    // Get today's date in IST
    const now = moment().tz('Asia/Kolkata');
    const today = now.clone().startOf('day');

    // Get all attendance records for today
    const todayAttendance = await Attendance.find({
      date: today.toDate(),
      checkInTime: { $exists: true },
      $or: [
        { status: 'present' },
        { status: 'late_in' },
        { status: 'leave_applied_full' },
        { status: 'leave_applied_first_half' },
      ]
    }).select('user');

    // Create a set of user IDs who have already checked in or marked leave/WFH
    const checkedInUserIds = new Set(todayAttendance.map(a => a.user.toString()));

    // Filter users who haven't checked in
    const usersToRemind = users.filter(user => !checkedInUserIds.has(user._id.toString()));

    // Send reminders only to users who haven't checked in
    for (const user of usersToRemind) {
      const userName = `${user.firstName} ${user.lastName}`;
      
      Helper.sendEmail({
        receiverEmails: [user.email],
        subject: 'Daily Check-in Reminder',
        message: Helper.getAttendanceCheckInReminder(userName, user.team),
        team: user.team
      }).catch(err => logger.error('Error sending attendance reminder:', err));
    }
  } catch (error) {
    logger.error('Error in sendAttendanceReminders:', error);
  }
}



/**
 * Send regularization reminders to employees
 */
async function sendRegularizationReminders() {
  try {
    const users = await User.find({ 
      status: { $in: ['probation','onroll'] },
      isDeleted: false,
    });

    const dashboardUrl = process.env.HRMS_FRONTEND_URL;

    for (const user of users) {

        const userName = `${user.firstName} ${user.lastName}`;
        
        Helper.sendEmail({
          receiverEmails: [user.email],
          subject: 'Pending Attendance Regularization',
          message: Helper.getRegularizationReminder(userName, dashboardUrl, user.team),
          team: user.team
        }).catch(err => logger.error('Error sending regularization reminder:', err));
    }
  } catch (error) {
    logger.error('Error in sendRegularizationReminders:', error);
  }
}

/**
 * Send leave action reminders to Team Leads
 */
async function sendTLLeaveActionReminders() {
  try {
    // Find all potential team leads (including regular TLs and HR/admin/subadmin/IT who might be TLs)
    const potentialTeamLeads = await User.find({
      status: { $in: ['probation','onroll'] },
      role: { $in: ['teamlead', 'hr', 'admin', 'subadmin', 'it'] },
      
      isDeleted: false
    });

    const dashboardUrl = process.env.HRMS_FRONTEND_URL;

    for (const tl of potentialTeamLeads) {
      // Check if this person is actually a team lead of anyone
      const teamMemberCount = await User.countDocuments({
        teamLeadId: tl._id,
        isDeleted: false
      });

      // Only send email if they have team members
      if (teamMemberCount > 0) {
        const tlName = `${tl.firstName} ${tl.lastName}`;
        
        Helper.sendEmail({
          receiverEmails: [tl.email], 
          subject: 'Pending Leave Requests - Action Required',
          message: Helper.getTLLeaveActionReminder(tlName, dashboardUrl, tl.team),
          team: tl.team
        }).catch(err => logger.error('Error sending TL leave action reminder:', err));
      }
    }
  } catch (error) {
    logger.error('Error in sendTLLeaveActionReminders:', error);
  }
}

/**
 * Send attendance check-out reminders to all employees
 */
async function sendCheckOutReminders() {
  try {
    const users = await User.find({ 
      status: { $in: ['probation','onroll'] },
      isDeleted: false,
    });

    // Get today's date in IST
    const now = moment().tz('Asia/Kolkata');
    const today = now.clone().startOf('day');

    // Get all attendance records for today where users have checked out
    const todayAttendance = await Attendance.find({
      date: today.toDate(),
      checkInTime: { $exists: true },
      checkOutTime: { $exists: true }, // Only get records where checkout exists
      $or: [
        { status: 'present' },
        { status: 'late_in' },
        { status: 'leave_applied_full' },
        { status: 'leave_applied_first_half' },
        {status: 'early_out'},
        {status: 'late_in_early_out'},
        {status: 'leave_applied_second_half'},
      ]
    }).select('user');

    // Create a set of user IDs who have already checked out
    const checkedOutUserIds = new Set(todayAttendance.map(a => a.user.toString()));

    // Filter users who haven't checked out
    const usersToRemind = users.filter(user => !checkedOutUserIds.has(user._id.toString()));

    // Send reminders only to users who haven't checked out
    for (const user of usersToRemind) {
      const userName = `${user.firstName} ${user.lastName}`;
      
      Helper.sendEmail({
        receiverEmails: [user.email],
        subject: 'Daily Check-out Reminder',
        message: Helper.getAttendanceCheckOutReminder(userName, user.team),
        team: user.team
      }).catch(err => logger.error('Error sending checkout reminder:', err));
    }
  } catch (error) {
    logger.error('Error in sendCheckOutReminders:', error);
  }
}

async function main() {
  try {
    // Connect MongoDB (only if not already connected)
    if (!mongoose.connection.readyState) {
      await mongoose.connect(process.env.MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log("✅ Connected to MongoDB");
    }

    const arg = process.argv[2]; // CLI argument
    if (arg === 'sendFeedbackReminders') {
      await sendFeedbackReminders();
    } else if (arg === 'sendAttendanceReminders') {
      await sendAttendanceReminders();
    } else if (arg === 'sendRegularizationReminders') {
      await sendRegularizationReminders();
    } else if (arg === 'sendTLLeaveActionReminders') {
      await sendTLLeaveActionReminders();
    } else if (arg === 'sendCheckOutReminders') {
      await sendCheckOutReminders();
    } else if (!arg) {
      console.log("ℹ Running all reminder jobs...");
      await sendFeedbackReminders();
      await sendAttendanceReminders();
      await sendRegularizationReminders();
      await sendTLLeaveActionReminders();
      await sendCheckOutReminders();
    } else {
      console.log('❌ Please specify a valid function name: sendFeedbackReminders, sendAttendanceReminders, sendRegularizationReminders, sendTLLeaveActionReminders, or sendCheckOutReminders');
    }

    // Close DB connection after job
    await mongoose.disconnect();
    console.log("✅ Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Error in main runner:", error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  sendFeedbackReminders,
  sendAttendanceReminders,
  sendRegularizationReminders,
  sendTLLeaveActionReminders,
  sendCheckOutReminders
};