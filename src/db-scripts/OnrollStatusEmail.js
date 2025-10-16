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

const moment = require('moment-timezone');

const EmployeeHistory = require('../models/employeeHistory');
const User = require('../models/userModel');
const Helper = require('../utility/helper');

async function sendOnrollStatusEmails() {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log('🔌 Connected to MongoDB');

        // Define the cutoff date (August 14, 2025 - from this day onwards)
        const cutoffDate = new Date('2025-08-14T00:00:00.000+00:00');

        console.log(`📅 Searching for status changes from ${cutoffDate.toISOString()} onwards`);

        // Find all employeeHistory records where status changed from probation to onroll
        // from August 14, 2025 onwards
        const statusChanges = await EmployeeHistory.find({
            entity: 'status',
            previous: 'probation',
            changed: 'onroll',
            $or: [
                { actionAt: { $gte: cutoffDate } },
                { actionAt: null, createdAt: { $gte: cutoffDate } }
            ]
        })

        console.log(`📋 Found ${statusChanges.length} status change records`);

        if (statusChanges.length === 0) {
            console.log('ℹ️ No status changes found matching the criteria');
            return;
        }

        let emailsSent = 0;
        let emailsFailed = 0;
        let skipped = 0;

        for (const change of statusChanges) {
            try {
                // Fetch the employee details
                const employee = await User.findById(change.employeeId);

                if (!employee) {
                    console.log(`⚠️ Employee not found for ID: ${change.employeeId}`);
                    skipped++;
                    continue;
                }

                // Check if employee's current status is still 'onroll'
                if (employee.status !== 'onroll') {
                    console.log(`⚠️ Skipping ${employee.firstName} ${employee.lastName} - Current status is ${employee.status}, not onroll`);
                    skipped++;
                    continue;
                }

                // Prepare email data
                const userName = `${employee.firstName} ${employee.lastName}`;
                const jobTitle = employee.jobTitle || 'Team Member';
                const team = employee.team;
                const conversionDate = change.actionAt || change.createdAt;

                const formattedDate = moment(conversionDate)
                    .tz('Asia/Kolkata')      
                    .format('DD MMMM YYYY');

                console.log(`📅 Formatted date: ${formattedDate}`);

                console.log(`📧 Sending email to ${userName} (${employee.email})`);

                // Generate email content using the fullTimeConversion template
                const emailContent = Helper.fullTimeConversion(
                    userName,
                    formattedDate,
                    jobTitle,
                    team
                );

                // Send email
                await Helper.sendEmail({
                    receiverEmails: [employee.email],
                    subject: 'You’ve Earned Full-Time Status! Congratulations !!',
                    message: emailContent,
                    fromHR: true,
                    team: team,
                });

                console.log(`✅ Email sent successfully to ${userName} (${employee.email})`);
                emailsSent++;

            } catch (error) {
                console.error(`❌ Error processing employee ${change.employeeId}:`, error.message);
                emailsFailed++;
            }
        }

        console.log('\n📊 Summary:');
        console.log(`   ✅ Emails sent: ${emailsSent}`);
        console.log(`   ❌ Emails failed: ${emailsFailed}`);
        console.log(`   ⏭️  Skipped: ${skipped}`);
        console.log(`   📋 Total records processed: ${statusChanges.length}`);

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Run the script
sendOnrollStatusEmails();

