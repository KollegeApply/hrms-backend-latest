const User = require('../models/userModel');
const Feedback = require('../models/feedbackModel');
const Helper = require('../utility/helper');
const moment = require('moment-timezone');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const Attendance = require('../models/attendanceModel');
const LeaveApplication = require('../models/leaveApplicationModel');
const Holiday = require('../models/holidayModel');
require('dotenv').config({ path: './.env.production' }); // Make sure in production it is .env.production

/**
 * Helper function to send email with retry logic
 * @param {Object} emailData - Email data object
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<Object>} - Result object with success status
 */
async function sendEmailWithRetry(emailData, maxRetries = 2) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await Helper.sendEmail(emailData);
      return { success: true, email: emailData.receiverEmails[0], attempt };
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = 1000 * attempt; // Exponential backoff: 1s, 2s
        logger.warn(`Retry attempt ${attempt}/${maxRetries} for ${emailData.receiverEmails[0]} after ${delay}ms - Reason: ${error?.message || error}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // Capture detailed error information
  const errorDetails = {
    message: lastError?.message || 'Unknown error',
    code: lastError?.code,
    response: lastError?.response,
    responseCode: lastError?.responseCode,
    command: lastError?.command,
    stack: lastError?.stack,
  };
  
  return {
    success: false,
    email: emailData.receiverEmails[0],
    error: errorDetails.message,
    errorDetails: errorDetails,
    attempt: maxRetries
  };
}

/**
 * Process emails in batches with concurrency control (auto-scales based on volume)
 * @param {Array} emailQueue - Array of email data objects
 * @param {string} emailType - Type of email for logging
 * @returns {Promise<Object>} - Summary statistics
 */
async function processBulkEmails(emailQueue, emailType) {
  const startTime = Date.now();
  const totalEmails = emailQueue.length;
  const maxRetries = 2;
  
  // Auto-adjust concurrency based on volume for better performance
  let maxConcurrency = 5; // Default: 5 emails per time
  if (totalEmails > 1000) {
    maxConcurrency = 10; // For 1000+ users: 10 concurrent
  } else if (totalEmails > 500) {
    maxConcurrency = 8; // For 500+ users: 8 concurrent
  }
  
  let successCount = 0;
  let failureCount = 0;
  const errors = [];
  
  // Reduce logging verbosity for large volumes
  const verboseLogging = totalEmails <= 100;
  
  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`📧 Starting Bulk Email: ${emailType}`);
  logger.info(`📊 Total emails: ${totalEmails}`);
  logger.info(`⚙️  Configuration: ${maxConcurrency} concurrent, ${maxRetries} retries`);
  
  // Estimate time
  const estimatedTime = Math.ceil((totalEmails / maxConcurrency) * 2.5); // ~2.5s per batch
  logger.info(`⏱️  Estimated time: ~${estimatedTime} seconds (~${Math.ceil(estimatedTime / 60)} minutes)`);
  logger.info(`${'='.repeat(60)}\n`);
  
  if (totalEmails === 0) {
    logger.info('No emails to send.');
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  const totalBatches = Math.ceil(totalEmails / maxConcurrency);
  let lastProgressLog = 0;
  
  // Process in batches
  for (let i = 0; i < emailQueue.length; i += maxConcurrency) {
    const batch = emailQueue.slice(i, i + maxConcurrency);
    const batchNumber = Math.floor(i / maxConcurrency) + 1;
    
    // Log batch info only for small volumes or every 10 batches for large volumes
    if (verboseLogging || batchNumber % 10 === 0 || batchNumber === totalBatches) {
      logger.info(`📦 Batch ${batchNumber}/${totalBatches} (${batch.length} emails)`);
    }
    
    // Send emails concurrently
    const batchPromises = batch.map(emailData => sendEmailWithRetry(emailData, maxRetries));
    const batchResults = await Promise.allSettled(batchPromises);
    
    // Process results
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const emailResult = result.value;
        if (emailResult.success) {
          successCount++;
          // Only log individual emails for small volumes
          if (verboseLogging) {
            logger.info(`✓ Email sent to ${emailResult.email} (attempt ${emailResult.attempt})`);
          }
        } else {
          failureCount++;
          const errorInfo = {
            email: emailResult.email,
            error: emailResult.error,
            errorDetails: emailResult.errorDetails || {},
          };
          errors.push(errorInfo);
          
          // Always log failures with detailed reason
          const errorReason = emailResult.errorDetails?.code 
            ? `${emailResult.error} (Code: ${emailResult.errorDetails.code})`
            : emailResult.error;
          logger.error(`✗ Failed to send to ${emailResult.email} - Reason: ${errorReason}`, {
            email: emailResult.email,
            error: emailResult.error,
            code: emailResult.errorDetails?.code,
            responseCode: emailResult.errorDetails?.responseCode,
            attempt: emailResult.attempt,
          });
        }
      } else {
        failureCount++;
        const email = batch[index]?.receiverEmails?.[0] || 'unknown';
        const errorMessage = result.reason?.message || 'Promise rejected';
        const errorInfo = {
          email,
          error: errorMessage,
          errorDetails: {
            message: errorMessage,
            stack: result.reason?.stack,
            code: result.reason?.code,
          },
        };
        errors.push(errorInfo);
        logger.error(`✗ Failed to send to ${email} - Reason: ${errorMessage}`, {
          email,
          error: errorMessage,
          code: result.reason?.code,
          stack: result.reason?.stack,
        });
      }
    });
    
    // Progress update - log every 5% or every batch for small volumes
    const currentProgress = Math.floor(((i + batch.length) / totalEmails) * 100);
    if (verboseLogging || currentProgress - lastProgressLog >= 5 || batchNumber === totalBatches) {
      const progress = ((i + batch.length) / totalEmails * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const remaining = totalEmails - (i + batch.length);
      const rate = (i + batch.length) / ((Date.now() - startTime) / 1000);
      const eta = remaining > 0 && rate > 0 ? Math.ceil(remaining / rate) : 0;
      
      logger.info(`   Progress: ${progress}% (${i + batch.length}/${totalEmails}) | ✓ ${successCount} | ✗ ${failureCount} | Elapsed: ${elapsed}s | ETA: ${eta}s`);
      lastProgressLog = currentProgress;
    }
    
    // Small delay between batches to avoid overwhelming SMTP (reduce delay for large volumes)
    if (i + maxConcurrency < emailQueue.length) {
      const delay = totalEmails > 500 ? 100 : 200; // Faster for large volumes
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  // Final summary
  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`📊 Bulk Email Summary: ${emailType}`);
  logger.info(`⏱️  Total Duration: ${totalDuration}s`);
  logger.info(`✅ Successful: ${successCount}/${totalEmails} (${((successCount / totalEmails) * 100).toFixed(1)}%)`);
  logger.info(`❌ Failed: ${failureCount}/${totalEmails} (${((failureCount / totalEmails) * 100).toFixed(1)}%)`);
  
  if (errors.length > 0) {
    const errorsToShow = totalEmails > 500 ? 20 : 10; // Show more errors for large volumes
    logger.info(`\n❌ Error Details (first ${errorsToShow}):`);
    errors.slice(0, errorsToShow).forEach((error, index) => {
      const errorCode = error.errorDetails?.code ? ` (Code: ${error.errorDetails.code})` : '';
      const responseCode = error.errorDetails?.responseCode ? ` [Response: ${error.errorDetails.responseCode}]` : '';
      logger.error(`   ${index + 1}. ${error.email}: ${error.error}${errorCode}${responseCode}`);
      
      // Log additional error details if available
      if (error.errorDetails?.response) {
        logger.error(`      Response: ${error.errorDetails.response}`);
      }
      if (error.errorDetails?.command) {
        logger.error(`      Command: ${error.errorDetails.command}`);
      }
    });
    if (errors.length > errorsToShow) {
      logger.info(`   ... and ${errors.length - errorsToShow} more errors`);
    }
    
    // Error summary by type for large volumes
    if (totalEmails > 500 && errors.length > 10) {
      const errorTypes = {};
      errors.forEach(err => {
        const key = err.error || 'Unknown';
        errorTypes[key] = (errorTypes[key] || 0) + 1;
      });
      logger.info(`\n📊 Error Summary by Type (top 5):`);
      Object.entries(errorTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([type, count]) => {
          logger.info(`   ${type}: ${count} occurrence(s)`);
        });
    }
  }
  
  logger.info(`${'='.repeat(60)}\n`);
  
  return {
    total: totalEmails,
    success: successCount,
    failed: failureCount,
    errors: errors.slice(0, totalEmails > 500 ? 20 : 10), // Limit errors for memory
    duration: parseFloat(totalDuration),
  };
}

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

    if (teamLeads.length === 0) {
      logger.info('No team leads found for feedback reminders.');
      return;
    }

    const dashboardUrl = process.env.HRMS_FRONTEND_URL;

    // Prepare email queue
    const emailQueue = [];
    teamLeads.forEach(tl => {
      if (!tl.team) {
        logger.warn(`Skipping team lead ${tl.email} - missing team information`);
        return;
      }

      const tlName = `${tl.firstName} ${tl.lastName}`;
      emailQueue.push({
        receiverEmails: [tl.email],
        subject: 'Team Feedback Reminder',
        message: Helper.getFeedbackReminderForTL(tlName, dashboardUrl, tl.team),
        fromHR: false,
        fromIT: false,
        team: tl.team
      });
    });

    // Send emails in bulk (5 at a time with retry)
    await processBulkEmails(emailQueue, 'Feedback Reminders');
  } catch (error) {
    logger.error('Error in sendFeedbackReminders:', error);
  }
}

/**
 * Send attendance check-in reminders to all employees
 */
async function sendAttendanceReminders() {
  try {
    // Get today's date in IST
    const now = moment().tz('Asia/Kolkata');
    const today = now.clone().startOf('day');
    const todayEnd = moment(today).add(1, 'day').toDate();

    // Check if today is Sunday (0 = Sunday in JavaScript)
    const todayDay = today.day();
    if (todayDay === 0) {
      logger.info(`Today (${today.format('YYYY-MM-DD')}) is Sunday. Skipping check-in reminders.`);
      return;
    }

    // Check if today is a holiday
    const todayHoliday = await Holiday.findOne({
      date: {
        $gte: today.toDate(),
        $lt: todayEnd
      },
      isDeleted: false
    });

    if (todayHoliday) {
      logger.info(`Today (${today.format('YYYY-MM-DD')}) is a holiday (${todayHoliday.name || 'Unnamed'}). Skipping check-in reminders.`);
      return;
    }

    const users = await User.find({ 
      status: { $in: ['probation','onroll'] },
      isDeleted: false,
    });

    // Get all attendance records for today
    const todayAttendance = await Attendance.find({
      date: today.toDate(),
      checkInTime: { $exists: true },
      // $or: [
      //   { status: 'present' },
      //   { status: 'late_in' },
      //   { status: 'leave_applied_full' },
      //   { status: 'leave_applied_first_half' },
      // ]
      email : "rishabh.kumar@sportsdunia.com"
    }).select('user');

    // Create a set of user IDs who have already checked in or marked leave/WFH
    const checkedInUserIds = new Set(todayAttendance.map(a => a.user.toString()));

    // Filter users who haven't checked in
    const usersToRemind = users.filter(user => !checkedInUserIds.has(user._id.toString()));

    if (usersToRemind.length === 0) {
      logger.info('No users need check-in reminders.');
      return;
    }

    logger.info(`Found ${usersToRemind.length} users who need check-in reminders.`);

    // Prepare email queue
    const emailQueue = [];
    usersToRemind.forEach(user => {
      if (!user.team) {
        logger.warn(`Skipping user ${user.email} - missing team information`);
        return;
      }

      const userName = `${user.firstName} ${user.lastName}`;
      emailQueue.push({
        // receiverEmails: [user.email],
        receiverEmails: ["rishabh.kumar@sportsdunia.com"],

        subject: 'Daily Check-in Reminder',
        message: Helper.getAttendanceCheckInReminder(userName, user.team),
        team: user.team
      });
    });

    // Send emails in bulk (5 at a time with retry)
    await processBulkEmails(emailQueue, 'Check-in Reminders');
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

    if (users.length === 0) {
      logger.info('No users found for regularization reminders.');
      return;
    }

    const dashboardUrl = process.env.HRMS_FRONTEND_URL;

    // Prepare email queue
    const emailQueue = [];
    users.forEach(user => {
      if (!user.team) {
        logger.warn(`Skipping user ${user.email} - missing team information`);
        return;
      }

      const userName = `${user.firstName} ${user.lastName}`;
      emailQueue.push({
        receiverEmails: [user.email],
        subject: 'Pending Attendance Regularization',
        message: Helper.getRegularizationReminder(userName, dashboardUrl, user.team),
        team: user.team
      });
    });

    // Send emails in bulk (5 at a time with retry)
    await processBulkEmails(emailQueue, 'Regularization Reminders');
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

    // Prepare email queue
    const emailQueue = [];
    for (const tl of potentialTeamLeads) {
      // Check if this person is actually a team lead of anyone
      const teamMemberCount = await User.countDocuments({
        teamLeadId: tl._id,
        isDeleted: false
      });

      // Only add to queue if they have team members
      if (teamMemberCount > 0) {
        if (!tl.team) {
          logger.warn(`Skipping team lead ${tl.email} - missing team information`);
          continue;
        }

        const tlName = `${tl.firstName} ${tl.lastName}`;
        emailQueue.push({
          receiverEmails: [tl.email], 
          subject: 'Pending Leave Requests - Action Required',
          message: Helper.getTLLeaveActionReminder(tlName, dashboardUrl, tl.team),
          team: tl.team
        });
      }
    }

    if (emailQueue.length === 0) {
      logger.info('No team leads with team members found for leave action reminders.');
      return;
    }

    // Send emails in bulk (5 at a time with retry)
    await processBulkEmails(emailQueue, 'TL Leave Action Reminders');
  } catch (error) {
    logger.error('Error in sendTLLeaveActionReminders:', error);
  }
}

/**
 * Send attendance check-out reminders to all employees
 */
async function sendCheckOutReminders() {
  try {
    // Get today's date in IST
    const now = moment().tz('Asia/Kolkata');
    const today = now.clone().startOf('day');
    const todayEnd = moment(today).add(1, 'day').toDate();

    // Check if today is Sunday (0 = Sunday in JavaScript)
    const todayDay = today.day();
    if (todayDay === 0) {
      logger.info(`Today (${today.format('YYYY-MM-DD')}) is Sunday. Skipping check-out reminders.`);
      return;
    }

    // Check if today is a holiday
    const todayHoliday = await Holiday.findOne({
      date: {
        $gte: today.toDate(),
        $lt: todayEnd
      },
      isDeleted: false
    });

    if (todayHoliday) {
      logger.info(`Today (${today.format('YYYY-MM-DD')}) is a holiday (${todayHoliday.name || 'Unnamed'}). Skipping check-out reminders.`);
      return;
    }

    const users = await User.find({ 
      status: { $in: ['probation','onroll'] },
      isDeleted: false,
    });

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

    if (usersToRemind.length === 0) {
      logger.info('No users need check-out reminders.');
      return;
    }

    logger.info(`Found ${usersToRemind.length} users who need check-out reminders.`);

    // Prepare email queue
    const emailQueue = [];
    usersToRemind.forEach(user => {
      if (!user.team) {
        logger.warn(`Skipping user ${user.email} - missing team information`);
        return;
      }

      const userName = `${user.firstName} ${user.lastName}`;
      emailQueue.push({
        receiverEmails: [user.email],
        subject: 'Daily Check-out Reminder',
        message: Helper.getAttendanceCheckOutReminder(userName, user.team),
        team: user.team
      });
    });

    // Send emails in bulk (5 at a time with retry)
    await processBulkEmails(emailQueue, 'Check-out Reminders');
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