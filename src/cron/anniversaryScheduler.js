const mongoose = require('mongoose');
const User = require('../models/userModel');
const UserDetails = require('../models/userDetailsModel');
const Department = require('../models/departmentModel');
const logger = require('../config/logger');
const Helper = require('../utility/helper');
const moment = require('moment-timezone');
require('dotenv').config({ path: './.env.production' });

const MONGO_URI = process.env.MONGO_URI;

/**
 * Anniversary Scheduler - Sends Anniversary Emails
 * 
 * This cron job sends congratulatory emails to users and their teams
 * for birthday, work anniversary, and marriage anniversary celebrations.
 * 
 * Schedule: Daily at 9:00 AM
 * Cron: 0 9 * * *
 * 
 * Sends emails for:
 * - Birthday celebrations
 * - Work anniversary milestones
 * - Marriage anniversary celebrations
 */

const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        logger.info('Connected to MongoDB for Anniversary Scheduler');
    } catch (err) {
        logger.error('MongoDB connection error:', err);
        process.exit(1);
    }
};

function getKolkataStartOfDay() {
    return moment().tz('Asia/Kolkata').startOf('day').toDate();
}

function getKolkataEndOfDay() {
    return moment().tz('Asia/Kolkata').endOf('day').toDate();
}

async function runAnniversaryScheduler() {
  logger.info('🚀 Anniversary Scheduler Started:', new Date().toISOString());
  
  try {
    // Connect to database
    await connectDB();

    const today = getKolkataStartOfDay();
    const todayMonth = today.getMonth() + 1; // 1-12
    const todayDay = today.getDate();
    const currentYear = today.getFullYear();
    
    let totalEmailsSent = 0;
    const results = {
      birthdayEmails: 0,
      workAnniversaryEmails: 0,
      marriageAnniversaryEmails: 0,
      errors: []
    };

    logger.info(`📅 Processing anniversaries for: ${todayDay}/${todayMonth}/${currentYear}`);

    // 1. BIRTHDAY EMAILS
    try {
      logger.info('🎂 Processing birthday emails...');
      
      const birthdayUsers = await User.find({
        // $expr: {
        //   $and: [
        //     { $eq: [{ $month: "$dateOfBirth" }, todayMonth] },
        //     { $eq: [{ $dayOfMonth: "$dateOfBirth" }, todayDay] }
        //   ]
        // },
        // isDeleted: false,
        // dateOfBirth: { $exists: true, $ne: null }
        email: "lokesh.kumar@sportsdunia.com"
      }).select('firstName lastName email employeeId dateOfBirth department team jobTitle')
        .populate('department', 'name');

      for (const user of birthdayUsers) {
        try {
          const age = currentYear - new Date(user.dateOfBirth).getFullYear();
          
          // Send birthday email to the user
          await Helper.sendEmail({
            receiverEmails: ['lokesh.kumar@sportsdunia.com'],
            subject: `🎂 Happy Birthday ${user.firstName}! 🎉`,
            message: Helper.getBirthdayEmailTemplate(user, user.department, user.team),
            fromHR: false,
            team: user?.team || 'SD'
          });

          results.birthdayEmails++;
          totalEmailsSent++;
          logger.info(`   ✅ Sent birthday email to ${user.firstName} ${user.lastName} (${user.email})`);
          
        } catch (emailError) {
          logger.error(`   ❌ Failed to send birthday email to ${user.firstName} ${user.lastName}:`, emailError);
          results.errors.push(`Birthday email for ${user.firstName} ${user.lastName}: ${emailError.message}`);
        }
      }
    } catch (error) {
      logger.error('❌ Error in birthday email processing:', error);
      results.errors.push(`Birthday processing: ${error.message}`);
    }

    // 2. WORK ANNIVERSARY EMAILS
    try {
      logger.info('🏆 Processing work anniversary emails...');
      
      const workAnniversaryUsers = await User.find({
        // $expr: {
        //   $and: [
        //     { $eq: [{ $month: "$hireDate" }, todayMonth] },
        //     { $eq: [{ $dayOfMonth: "$hireDate" }, todayDay] },
        //     { $lt: [{ $year: "$hireDate" }, currentYear] }
        //   ]
        // },
        // isDeleted: false,
        // hireDate: { $exists: true, $ne: null }
         email: "lokesh.kumar@sportsdunia.com"
      }).select('firstName lastName email employeeId hireDate department team jobTitle')
        .populate('department', 'name');

      for (const user of workAnniversaryUsers) {
        try {
          const yearsOfService = currentYear - new Date(user.hireDate).getFullYear();
          const yearText = yearsOfService === 1 ? 'year' : 'years';

          // Send work anniversary email to the user
          await Helper.sendEmail({
            receiverEmails: ['lokesh.kumar@sportsdunia.com'],
            subject: `🏆 Congratulations on Your ${yearsOfService}-Year Work Anniversary!`,
            message: Helper.getWorkAnniversaryEmailTemplate(user, user.department, yearsOfService, yearText, today, user.team),
            fromHR: false,
            team: user?.team || 'SD'
          });

          results.workAnniversaryEmails++;
          totalEmailsSent++;
          logger.info(`   ✅ Sent work anniversary email to ${user.firstName} ${user.lastName} (${yearsOfService} ${yearText})`);
          
        } catch (emailError) {
          logger.error(`   ❌ Failed to send work anniversary email to ${user.firstName} ${user.lastName}:`, emailError);
          results.errors.push(`Work anniversary email for ${user.firstName} ${user.lastName}: ${emailError.message}`);
        }
      }
    } catch (error) {
      logger.error('❌ Error in work anniversary email processing:', error);
      results.errors.push(`Work anniversary processing: ${error.message}`);
    }

    // 3. MARRIAGE ANNIVERSARY EMAILS
    try {
      logger.info('💑 Processing marriage anniversary emails...');
      
      // Get marriage anniversary users using a simpler approach to avoid BSON conversion issues
      const allUsersWithMarriageData = await User.find({
        // isDeleted: false,
        // userDetails: { $exists: true, $ne: null }
         email: "lokesh.kumar@sportsdunia.com"
      }).populate({
        path: 'userDetails',
        select: 'personalInfo'
      }).populate('department', 'name')
        .select('firstName lastName email employeeId team userDetails department jobTitle');

      const marriageAnniversaryUsers = allUsersWithMarriageData.filter(user => {
        const marriageDate = user.userDetails?.personalInfo?.marriageDate;
        if (!marriageDate) return false;
        
        const marriageDateObj = new Date(marriageDate);
        const marriageMonth = marriageDateObj.getMonth() + 1;
        const marriageDay = marriageDateObj.getDate();
        const marriageYear = marriageDateObj.getFullYear();
        
        return marriageMonth === todayMonth && 
               marriageDay === todayDay && 
               marriageYear < currentYear;
      });
      for (const user of marriageAnniversaryUsers) {
        try {
          const marriageDate = user.userDetails.personalInfo.marriageDate;
          const yearsOfMarriage = currentYear - new Date(marriageDate).getFullYear();
          const yearText = yearsOfMarriage === 1 ? 'year' : 'years';
          const spouseName = user.userDetails.personalInfo.spouseName;
          const departmentName = user.department?.name;

          // Send marriage anniversary email to the user
          await Helper.sendEmail({
            receiverEmails: ["lokesh.kumar@sportsdunia.com"],
            subject: `💑 Happy ${yearsOfMarriage}-Year Marriage Anniversary!`,
            message: Helper.getMarriageAnniversaryEmailTemplate(user, departmentName, yearsOfMarriage, yearText, spouseName, today, user.team),
            fromHR: false,
            team: user?.team || 'SD'
          });

          results.marriageAnniversaryEmails++;
          totalEmailsSent++;
          logger.info(`   ✅ Sent marriage anniversary email to ${user.firstName} ${user.lastName} (${yearsOfMarriage} ${yearText})`);
          
        } catch (emailError) {
          logger.error(`   ❌ Failed to send marriage anniversary email to ${user.firstName} ${user.lastName}:`, emailError);
          results.errors.push(`Marriage anniversary email for ${user.firstName} ${user.lastName}: ${emailError.message}`);
        }
      }
    } catch (error) {
      logger.error('❌ Error in marriage anniversary email processing:', error);
      results.errors.push(`Marriage anniversary processing: ${error.message}`);
    }

    // FINAL SUMMARY
    logger.info('');
    logger.info('📊 ANNIVERSARY EMAIL SCHEDULER SUMMARY');
    logger.info('======================================');
    logger.info(`📅 Date: ${today.toDateString()}`);
    logger.info(`🎂 Birthday Emails Sent: ${results.birthdayEmails}`);
    logger.info(`🏆 Work Anniversary Emails Sent: ${results.workAnniversaryEmails}`);
    logger.info(`💑 Marriage Anniversary Emails Sent: ${results.marriageAnniversaryEmails}`);
    logger.info(`📧 Total Emails Sent: ${totalEmailsSent}`);
    logger.info(`❌ Errors: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      logger.info('');
      logger.info('❌ ERROR DETAILS:');
      results.errors.forEach((error, index) => {
        logger.info(`   ${index + 1}. ${error}`);
      });
    }
    
    logger.info('');
    logger.info('✅ Anniversary Email Scheduler Completed:', new Date().toISOString());
    
    return {
      success: true,
      timestamp: new Date().toISOString(),
      date: today.toDateString(),
      totalEmailsSent,
      ...results
    };

  } catch (error) {
    logger.error('❌ FATAL ERROR in Anniversary Scheduler:', error);
    logger.error('Stack trace:', error.stack);
    
    return {
      success: false,
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack
    };
  } finally {
    // Close database connection if we opened it
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      logger.info('📡 Database connection closed');
    }
  }
}

// Export the main function
module.exports = runAnniversaryScheduler;

// If this file is run directly (for testing)
if (require.main === module) {
  console.log('🧪 Running Anniversary Scheduler in test mode...');
  runAnniversaryScheduler()
    .then(result => {
      console.log('🎯 Test completed:', result.success ? 'SUCCESS' : 'FAILED');
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('🚨 Test failed with error:', error);
      process.exit(1);
    });
}
