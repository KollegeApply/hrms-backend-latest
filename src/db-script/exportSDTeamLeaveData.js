const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
require('dotenv').config({ path: path.join(__dirname, '../../.env.development') });



// Import models
const LeaveApplication = require('../models/leaveApplicationModel');
const User = require('../models/userModel');
const LeaveType = require('../models/leaveTypeModel');

// MongoDB connection string - update this with your actual connection string
const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/hrms';

// Function to connect to MongoDB
async function connectToDatabase() {
  try {
    if (!MONGODB_URI) {
      console.error('Error: MONGO_URI environment variable is not set');
      console.error('Please set MONGO_URI in your .env.development file or as an environment variable');
      process.exit(1);
    }
    
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB successfully');
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    console.error('Please check your MONGO_URI connection string');
    process.exit(1);
  }
}

// Function to format date to DD/MM/YYYY format
function formatDate(date) {
  return moment(date).tz('Asia/Kolkata').format('DD/MM/YYYY');
}

// Function to format leave dates array to readable string
function formatLeaveDates(dates) {
  if (!dates || dates.length === 0) return '';
  
  if (dates.length === 1) {
    return formatDate(dates[0]);
  }
  
  const fromDate = formatDate(dates[0]);
  const toDate = formatDate(dates[dates.length - 1]);
  return `${fromDate} to ${toDate}`;
}

// Function to format applied on date
function formatAppliedOn(date) {
  return moment(date).tz('Asia/Kolkata').format('DD/MM/YYYY HH:mm:ss');
}

// Main function to export leave data
async function exportSDTeamLeaveData() {
  try {
    console.log('Starting export of SD team leave data with leave dates in August...');
    
    // Define August 2024 date range (you can modify the year as needed)
    const augustStart = moment('2025-08-01').startOf('month').toDate();
    const augustEnd = moment('2025-08-31').endOf('month').toDate();
    
    console.log(`Exporting data from ${formatDate(augustStart)} to ${formatDate(augustEnd)}`);
    
    // Get all leave applications for SD team where leave dates fall in August
    const leaveApplications = await LeaveApplication.find({
      isDeleted: false,
      dates: {
        $elemMatch: {
          $gte: augustStart,
          $lte: augustEnd
        }
      }
    })
    .populate({
      path: 'userId',
      match: { team: 'SD', isDeleted: false },
      select: 'firstName lastName employeeId'
    })
    .populate({
      path: 'leaveTypeId',
      select: 'name'
    })
    .sort({ appliedOn: -1 });
    
    // Filter out applications where user is not in SD team or user is deleted
    const sdTeamLeaves = leaveApplications.filter(leave => leave.userId);
    
    console.log(`Found ${sdTeamLeaves.length} leave applications for SD team with leave dates in August`);
    
    if (sdTeamLeaves.length === 0) {
      console.log('No leave applications found for SD team with leave dates in August');
      return;
    }
    
    // Prepare CSV data
    const csvHeader = 'fullName,employeeId,leaveType,totalDays,leaveDates,reason,status,appliedOn\n';
    
    const csvRows = sdTeamLeaves.map(leave => {
      const fullName = `${leave.userId.firstName || ''} ${leave.userId.lastName || ''}`.trim();
      const employeeId = leave.userId.employeeId || '';
      const leaveType = leave.leaveTypeId?.name || '';
      const totalDays = leave.totalDays || 0;
      const leaveDates = formatLeaveDates(leave.dates);
      const reason = (leave.leaveReason || '').replace(/"/g, '""'); // Escape quotes for CSV
      const status = leave.status || '';
      const appliedOn = formatAppliedOn(leave.appliedOn);
      
      // Wrap fields in quotes to handle commas in data
      return `"${fullName}","${employeeId}","${leaveType}","${totalDays}","${leaveDates}","${reason}","${status}","${appliedOn}"`;
    });
    
    const csvContent = csvHeader + csvRows.join('\n');
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Generate filename with timestamp
    const timestamp = moment().tz('Asia/Kolkata').format('YYYY-MM-DD_HH-mm-ss');
    const filename = `SD_Team_Leave_Data_August_${timestamp}.csv`;
    const filepath = path.join(outputDir, filename);
    
    // Write CSV file
    fs.writeFileSync(filepath, csvContent, 'utf8');
    
    console.log(`CSV file exported successfully: ${filepath}`);
    console.log(`Total records exported: ${sdTeamLeaves.length}`);
    
    // Display sample data
    console.log('\nSample data:');
    console.log('fullName,employeeId,leaveType,totalDays,leaveDates,reason,status,appliedOn');
    if (sdTeamLeaves.length > 0) {
      const sample = sdTeamLeaves[0];
      const fullName = `${sample.userId.firstName || ''} ${sample.userId.lastName || ''}`.trim();
      const employeeId = sample.userId.employeeId || '';
      const leaveType = sample.leaveTypeId?.name || '';
      const totalDays = sample.totalDays || 0;
      const leaveDates = formatLeaveDates(sample.dates);
      const reason = sample.leaveReason || '';
      const status = sample.status || '';
      const appliedOn = formatAppliedOn(sample.appliedOn);
      
      console.log(`${fullName},${employeeId},${leaveType},${totalDays},${leaveDates},${reason},${status},${appliedOn}`);
    }
    
  } catch (error) {
    console.error('Error exporting leave data:', error);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Function to export data for a specific year and month
async function exportLeaveDataForMonth(year, month) {
  try {
    console.log(`Starting export of SD team leave data with leave dates in ${month}/${year}...`);
    
    // Define date range for the specified month
    const monthStart = moment(`${year}-${month.toString().padStart(2, '0')}-01`).startOf('month').toDate();
    const monthEnd = moment(`${year}-${month.toString().padStart(2, '0')}-01`).endOf('month').toDate();
    
    console.log(`Exporting data from ${formatDate(monthStart)} to ${formatDate(monthEnd)}`);
    
    // Get all leave applications for SD team where leave dates fall in the specified month
    const leaveApplications = await LeaveApplication.find({
      isDeleted: false,
      dates: {
        $elemMatch: {
          $gte: monthStart,
          $lte: monthEnd
        }
      }
    })
    .populate({
      path: 'userId',
      match: { team: 'SD', isDeleted: false },
      select: 'firstName lastName employeeId'
    })
    .populate({
      path: 'leaveTypeId',
      select: 'name'
    })
    .sort({ appliedOn: -1 });
    
    // Filter out applications where user is not in SD team or user is deleted
    const sdTeamLeaves = leaveApplications.filter(leave => leave.userId);
    
    console.log(`Found ${sdTeamLeaves.length} leave applications for SD team with leave dates in ${month}/${year}`);
    
    if (sdTeamLeaves.length === 0) {
      console.log(`No leave applications found for SD team with leave dates in ${month}/${year}`);
      return;
    }
    
    // Prepare CSV data
    const csvHeader = 'fullName,employeeId,leaveType,totalDays,leaveDates,reason,status,appliedOn\n';
    
    const csvRows = sdTeamLeaves.map(leave => {
      const fullName = `${leave.userId.firstName || ''} ${leave.userId.lastName || ''}`.trim();
      const employeeId = leave.userId.employeeId || '';
      const leaveType = leave.leaveTypeId?.name || '';
      const totalDays = leave.totalDays || 0;
      const leaveDates = formatLeaveDates(leave.dates);
      const reason = (leave.leaveReason || '').replace(/"/g, '""'); // Escape quotes for CSV
      const status = leave.status || '';
      const appliedOn = formatAppliedOn(leave.appliedOn);
      
      // Wrap fields in quotes to handle commas in data
      return `"${fullName}","${employeeId}","${leaveType}","${totalDays}","${leaveDates}","${reason}","${status}","${appliedOn}"`;
    });
    
    const csvContent = csvHeader + csvRows.join('\n');
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Generate filename with month and year
    const monthName = moment(`${year}-${month.toString().padStart(2, '0')}-01`).format('MMMM');
    const timestamp = moment().tz('Asia/Kolkata').format('YYYY-MM-DD_HH-mm-ss');
    const filename = `SD_Team_Leave_Data_${monthName}_${year}_${timestamp}.csv`;
    const filepath = path.join(outputDir, filename);
    
    // Write CSV file
    fs.writeFileSync(filepath, csvContent, 'utf8');
    
    console.log(`CSV file exported successfully: ${filepath}`);
    console.log(`Total records exported: ${sdTeamLeaves.length}`);
    
  } catch (error) {
    console.error('Error exporting leave data:', error);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Main execution
async function main() {
  await connectToDatabase();
  
  // Check command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 2) {
    // If year and month are provided as arguments
    const year = parseInt(args[0]);
    const month = parseInt(args[1]);
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      console.error('Invalid year or month. Usage: node exportSDTeamLeaveData.js [year] [month]');
      console.error('Example: node exportSDTeamLeaveData.js 2024 8');
      process.exit(1);
    }
    
    await exportLeaveDataForMonth(year, month);
  } else {
    // Default to August 2024
    await exportSDTeamLeaveData();
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  exportSDTeamLeaveData,
  exportLeaveDataForMonth
};
