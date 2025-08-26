const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
require('dotenv').config({ path: path.join(__dirname, '../../.env.development') });

// Import models
const User = require('../models/userModel');
const Department = require('../models/departmentModel');

// MongoDB connection string
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

// Function to check if a value is missing (null, undefined, empty string, or empty object)
function isMissing(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && Object.keys(value).length === 0) return true;
  return false;
}

// Function to format date
function formatDate(date) {
  if (!date) return '';
  return moment(date).tz('Asia/Kolkata').format('DD/MM/YYYY');
}

// Main function to export missing employee data
async function exportMissingEmployeeData() {
  try {
    console.log('Starting export of employees with missing data...');
    
    // Get all non-deleted users with populated department and team lead data
    const users = await User.find({ isDeleted: false })
      .populate({
        path: 'department',
        select: 'name',
        match: { isDeleted: false }
      })
      .populate({
        path: 'teamLeadId',
        select: 'firstName lastName employeeId',
        match: { isDeleted: false }
      })
      .populate({
        path: 'subTeamLeadId',
        select: 'firstName lastName employeeId',
        match: { isDeleted: false }
      })
      .sort({ firstName: 1, lastName: 1 });
    
    console.log(`Found ${users.length} total users`);
    
    // Filter users with missing data
    const usersWithMissingData = users.filter(user => {
      const missingJobTitle = isMissing(user.jobTitle);
      const missingDepartment = isMissing(user.department);
      const missingTeamLead = isMissing(user.teamLeadId);
      
      return missingJobTitle || missingDepartment || missingTeamLead;
    });
    
    console.log(`Found ${usersWithMissingData.length} users with missing data`);
    
    if (usersWithMissingData.length === 0) {
      console.log('No users found with missing data');
      return;
    }
    
    // Prepare CSV data
    const csvHeader = 'employeeId,fullName,email,team,missingJobTitle,missingDepartment,missingTeamLead,jobTitle,departmentName,teamLeadName,teamLeadEmployeeId,subTeamLeadName,subTeamLeadEmployeeId,hireDate,status,role\n';
    
    const csvRows = usersWithMissingData.map(user => {
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      const employeeId = user.employeeId || '';
      const email = user.email || '';
      const team = user.team || '';
      
      // Check what's missing
      const missingJobTitle = isMissing(user.jobTitle) ? 'Yes' : 'No';
      const missingDepartment = isMissing(user.department) ? 'Yes' : 'No';
      const missingTeamLead = isMissing(user.teamLeadId) ? 'Yes' : 'No';
      
      // Get current values
      const jobTitle = user.jobTitle || '';
      const departmentName = user.department?.name || '';
      
      // Team Lead info
      const teamLeadName = user.teamLeadId ? 
        `${user.teamLeadId.firstName || ''} ${user.teamLeadId.lastName || ''}`.trim() : '';
      const teamLeadEmployeeId = user.teamLeadId?.employeeId || '';
      
      // Sub Team Lead info
      const subTeamLeadName = user.subTeamLeadId ? 
        `${user.subTeamLeadId.firstName || ''} ${user.subTeamLeadId.lastName || ''}`.trim() : '';
      const subTeamLeadEmployeeId = user.subTeamLeadId?.employeeId || '';
      
      const hireDate = formatDate(user.hireDate);
      const status = user.status || '';
      const role = user.role || '';
      
      // Escape quotes for CSV
      const escapedJobTitle = (jobTitle || '').replace(/"/g, '""');
      const escapedDepartmentName = (departmentName || '').replace(/"/g, '""');
      const escapedTeamLeadName = (teamLeadName || '').replace(/"/g, '""');
      const escapedSubTeamLeadName = (subTeamLeadName || '').replace(/"/g, '""');
      
      // Wrap fields in quotes to handle commas in data
      return `"${employeeId}","${fullName}","${email}","${team}","${missingJobTitle}","${missingDepartment}","${missingTeamLead}","${escapedJobTitle}","${escapedDepartmentName}","${escapedTeamLeadName}","${teamLeadEmployeeId}","${escapedSubTeamLeadName}","${subTeamLeadEmployeeId}","${hireDate}","${status}","${role}"`;
    });
    
    const csvContent = csvHeader + csvRows.join('\n');
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Generate filename with timestamp
    const timestamp = moment().tz('Asia/Kolkata').format('YYYY-MM-DD_HH-mm-ss');
    const filename = `Missing_Employee_Data_${timestamp}.csv`;
    const filepath = path.join(outputDir, filename);
    
    // Write CSV file
    fs.writeFileSync(filepath, csvContent, 'utf8');
    
    console.log(`CSV file exported successfully: ${filepath}`);
    console.log(`Total records exported: ${usersWithMissingData.length}`);
    
    // Display summary
    console.log('\n=== SUMMARY ===');
    const missingJobTitleCount = usersWithMissingData.filter(u => isMissing(u.jobTitle)).length;
    const missingDepartmentCount = usersWithMissingData.filter(u => isMissing(u.department)).length;
    const missingTeamLeadCount = usersWithMissingData.filter(u => isMissing(u.teamLeadId)).length;
    
    console.log(`Users missing jobTitle: ${missingJobTitleCount}`);
    console.log(`Users missing department: ${missingDepartmentCount}`);
    console.log(`Users missing teamLeadId: ${missingTeamLeadCount}`);
    
    // Display sample data
    console.log('\n=== SAMPLE DATA ===');
    console.log('employeeId,fullName,email,team,missingJobTitle,missingDepartment,missingTeamLead,jobTitle,departmentName,teamLeadName');
    if (usersWithMissingData.length > 0) {
      const sample = usersWithMissingData[0];
      const fullName = `${sample.firstName || ''} ${sample.lastName || ''}`.trim();
      const employeeId = sample.employeeId || '';
      const email = sample.email || '';
      const team = sample.team || '';
      const missingJobTitle = isMissing(sample.jobTitle) ? 'Yes' : 'No';
      const missingDepartment = isMissing(sample.department) ? 'Yes' : 'No';
      const missingTeamLead = isMissing(sample.teamLeadId) ? 'Yes' : 'No';
      const jobTitle = sample.jobTitle || '';
      const departmentName = sample.department?.name || '';
      const teamLeadName = sample.teamLeadId ? 
        `${sample.teamLeadId.firstName || ''} ${sample.teamLeadId.lastName || ''}`.trim() : '';
      
      console.log(`${employeeId},${fullName},${email},${team},${missingJobTitle},${missingDepartment},${missingTeamLead},${jobTitle},${departmentName},${teamLeadName}`);
    }
    
  } catch (error) {
    console.error('Error exporting missing employee data:', error);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Function to export missing data for specific team
async function exportMissingDataForTeam(teamName) {
  try {
    console.log(`Starting export of employees with missing data for team: ${teamName}...`);
    
    // Get all non-deleted users for specific team with populated data
    const users = await User.find({ 
      isDeleted: false,
      team: teamName 
    })
      .populate({
        path: 'department',
        select: 'name',
        match: { isDeleted: false }
      })
      .populate({
        path: 'teamLeadId',
        select: 'firstName lastName employeeId',
        match: { isDeleted: false }
      })
      .populate({
        path: 'subTeamLeadId',
        select: 'firstName lastName employeeId',
        match: { isDeleted: false }
      })
      .sort({ firstName: 1, lastName: 1 });
    
    console.log(`Found ${users.length} total users for team ${teamName}`);
    
    // Filter users with missing data
    const usersWithMissingData = users.filter(user => {
      const missingJobTitle = isMissing(user.jobTitle);
      const missingDepartment = isMissing(user.department);
      const missingTeamLead = isMissing(user.teamLeadId);
      
      return missingJobTitle || missingDepartment || missingTeamLead;
    });
    
    console.log(`Found ${usersWithMissingData.length} users with missing data for team ${teamName}`);
    
    if (usersWithMissingData.length === 0) {
      console.log(`No users found with missing data for team ${teamName}`);
      return;
    }
    
    // Prepare CSV data
    const csvHeader = 'employeeId,fullName,email,team,missingJobTitle,missingDepartment,missingTeamLead,jobTitle,departmentName,teamLeadName,teamLeadEmployeeId,subTeamLeadName,subTeamLeadEmployeeId,hireDate,status,role\n';
    
    const csvRows = usersWithMissingData.map(user => {
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      const employeeId = user.employeeId || '';
      const email = user.email || '';
      const team = user.team || '';
      
      // Check what's missing
      const missingJobTitle = isMissing(user.jobTitle) ? 'Yes' : 'No';
      const missingDepartment = isMissing(user.department) ? 'Yes' : 'No';
      const missingTeamLead = isMissing(user.teamLeadId) ? 'Yes' : 'No';
      
      // Get current values
      const jobTitle = user.jobTitle || '';
      const departmentName = user.department?.name || '';
      
      // Team Lead info
      const teamLeadName = user.teamLeadId ? 
        `${user.teamLeadId.firstName || ''} ${user.teamLeadId.lastName || ''}`.trim() : '';
      const teamLeadEmployeeId = user.teamLeadId?.employeeId || '';
      
      // Sub Team Lead info
      const subTeamLeadName = user.subTeamLeadId ? 
        `${user.subTeamLeadId.firstName || ''} ${user.subTeamLeadId.lastName || ''}`.trim() : '';
      const subTeamLeadEmployeeId = user.subTeamLeadId?.employeeId || '';
      
      const hireDate = formatDate(user.hireDate);
      const status = user.status || '';
      const role = user.role || '';
      
      // Escape quotes for CSV
      const escapedJobTitle = (jobTitle || '').replace(/"/g, '""');
      const escapedDepartmentName = (departmentName || '').replace(/"/g, '""');
      const escapedTeamLeadName = (teamLeadName || '').replace(/"/g, '""');
      const escapedSubTeamLeadName = (subTeamLeadName || '').replace(/"/g, '""');
      
      // Wrap fields in quotes to handle commas in data
      return `"${employeeId}","${fullName}","${email}","${team}","${missingJobTitle}","${missingDepartment}","${missingTeamLead}","${escapedJobTitle}","${escapedDepartmentName}","${escapedTeamLeadName}","${teamLeadEmployeeId}","${escapedSubTeamLeadName}","${subTeamLeadEmployeeId}","${hireDate}","${status}","${role}"`;
    });
    
    const csvContent = csvHeader + csvRows.join('\n');
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Generate filename with timestamp
    const timestamp = moment().tz('Asia/Kolkata').format('YYYY-MM-DD_HH-mm-ss');
    const filename = `Missing_Employee_Data_${teamName}_${timestamp}.csv`;
    const filepath = path.join(outputDir, filename);
    
    // Write CSV file
    fs.writeFileSync(filepath, csvContent, 'utf8');
    
    console.log(`CSV file exported successfully: ${filepath}`);
    console.log(`Total records exported: ${usersWithMissingData.length}`);
    
  } catch (error) {
    console.error('Error exporting missing employee data:', error);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Function to export missing data for both SD and KAP teams
async function exportMissingDataForBothTeams() {
  try {
    console.log('Starting export of employees with missing data for both SD and KAP teams...');
    
    const teams = ['SD', 'KAP'];
    let totalExported = 0;
    
    for (const teamName of teams) {
      console.log(`\n--- Processing ${teamName} team ---`);
      
      // Get all non-deleted users for specific team with populated data
      const users = await User.find({ 
        isDeleted: false,
        team: teamName 
      })
        .populate({
          path: 'department',
          select: 'name',
          match: { isDeleted: false }
        })
        .populate({
          path: 'teamLeadId',
          select: 'firstName lastName employeeId',
          match: { isDeleted: false }
        })
        .populate({
          path: 'subTeamLeadId',
          select: 'firstName lastName employeeId',
          match: { isDeleted: false }
        })
        .sort({ firstName: 1, lastName: 1 });
      
      console.log(`Found ${users.length} total users for team ${teamName}`);
      
      // Filter users with missing data
      const usersWithMissingData = users.filter(user => {
        const missingJobTitle = isMissing(user.jobTitle);
        const missingDepartment = isMissing(user.department);
        const missingTeamLead = isMissing(user.teamLeadId);
        
        return missingJobTitle || missingDepartment || missingTeamLead;
      });
      
      console.log(`Found ${usersWithMissingData.length} users with missing data for team ${teamName}`);
      
      if (usersWithMissingData.length === 0) {
        console.log(`No users found with missing data for team ${teamName}`);
        continue;
      }
      
      // Prepare CSV data
      const csvHeader = 'employeeId,fullName,email,team,missingJobTitle,missingDepartment,missingTeamLead,jobTitle,departmentName,teamLeadName,teamLeadEmployeeId,subTeamLeadName,subTeamLeadEmployeeId,hireDate,status,role\n';
      
      const csvRows = usersWithMissingData.map(user => {
        const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
        const employeeId = user.employeeId || '';
        const email = user.email || '';
        const team = user.team || '';
        
        // Check what's missing
        const missingJobTitle = isMissing(user.jobTitle) ? 'Yes' : 'No';
        const missingDepartment = isMissing(user.department) ? 'Yes' : 'No';
        const missingTeamLead = isMissing(user.teamLeadId) ? 'Yes' : 'No';
        
        // Get current values
        const jobTitle = user.jobTitle || '';
        const departmentName = user.department?.name || '';
        
        // Team Lead info
        const teamLeadName = user.teamLeadId ? 
          `${user.teamLeadId.firstName || ''} ${user.teamLeadId.lastName || ''}`.trim() : '';
        const teamLeadEmployeeId = user.teamLeadId?.employeeId || '';
        
        // Sub Team Lead info
        const subTeamLeadName = user.subTeamLeadId ? 
          `${user.subTeamLeadId.firstName || ''} ${user.subTeamLeadId.lastName || ''}`.trim() : '';
        const subTeamLeadEmployeeId = user.subTeamLeadId?.employeeId || '';
        
        const hireDate = formatDate(user.hireDate);
        const status = user.status || '';
        const role = user.role || '';
        
        // Escape quotes for CSV
        const escapedJobTitle = (jobTitle || '').replace(/"/g, '""');
        const escapedDepartmentName = (departmentName || '').replace(/"/g, '""');
        const escapedTeamLeadName = (teamLeadName || '').replace(/"/g, '""');
        const escapedSubTeamLeadName = (subTeamLeadName || '').replace(/"/g, '""');
        
        // Wrap fields in quotes to handle commas in data
        return `"${employeeId}","${fullName}","${email}","${team}","${missingJobTitle}","${missingDepartment}","${missingTeamLead}","${escapedJobTitle}","${escapedDepartmentName}","${escapedTeamLeadName}","${teamLeadEmployeeId}","${escapedSubTeamLeadName}","${subTeamLeadEmployeeId}","${hireDate}","${status}","${role}"`;
      });
      
      const csvContent = csvHeader + csvRows.join('\n');
      
      // Create output directory if it doesn't exist
      const outputDir = path.join(__dirname, 'exports');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Generate filename with timestamp
      const timestamp = moment().tz('Asia/Kolkata').format('YYYY-MM-DD_HH-mm-ss');
      const filename = `Missing_Employee_Data_${teamName}_${timestamp}.csv`;
      const filepath = path.join(outputDir, filename);
      
      // Write CSV file
      fs.writeFileSync(filepath, csvContent, 'utf8');
      
      console.log(`✅ CSV file exported successfully: ${filepath}`);
      console.log(`📊 Total records exported for ${teamName}: ${usersWithMissingData.length}`);
      
      totalExported += usersWithMissingData.length;
      
      // Display summary for this team
      const missingJobTitleCount = usersWithMissingData.filter(u => isMissing(u.jobTitle)).length;
      const missingDepartmentCount = usersWithMissingData.filter(u => isMissing(u.department)).length;
      const missingTeamLeadCount = usersWithMissingData.filter(u => isMissing(u.teamLeadId)).length;
      
      console.log(`📋 ${teamName} Team Summary:`);
      console.log(`   - Users missing jobTitle: ${missingJobTitleCount}`);
      console.log(`   - Users missing department: ${missingDepartmentCount}`);
      console.log(`   - Users missing teamLeadId: ${missingTeamLeadCount}`);
    }
    
    console.log(`\n🎉 Export completed! Total records exported: ${totalExported}`);
    
  } catch (error) {
    console.error('Error exporting missing employee data:', error);
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
  
  if (args.length === 1) {
    // If team name is provided as argument
    const teamName = args[0];
    
    if (!teamName || teamName.trim() === '') {
      console.error('Invalid team name. Usage: node exportMissEmplData.js [teamName]');
      console.error('Example: node exportMissEmplData.js SD');
      console.error('Example: node exportMissEmplData.js KAP');
      console.error('Example: node exportMissEmplData.js both (for both SD and KAP)');
      process.exit(1);
    }
    
    if (teamName.toLowerCase() === 'both') {
      await exportMissingDataForBothTeams();
    } else {
      await exportMissingDataForTeam(teamName);
    }
  } else {
    // Default: Export for both SD and KAP teams
    await exportMissingDataForBothTeams();
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  exportMissingEmployeeData,
  exportMissingDataForTeam,
  exportMissingDataForBothTeams
};
