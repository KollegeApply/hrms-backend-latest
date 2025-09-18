const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
require('dotenv').config({ path: path.join(__dirname, '../../.env.development') });

// Import models
const Assets = require('../models/assetsModel');
const User = require('../models/userModel');

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
  if (!date) return '';
  return moment(date).tz('Asia/Kolkata').format('DD/MM/YYYY');
}

// Function to format datetime to DD/MM/YYYY HH:mm:ss format
function formatDateTime(date) {
  if (!date) return '';
  return moment(date).tz('Asia/Kolkata').format('DD/MM/YYYY HH:mm:ss');
}

// Function to escape CSV field
function escapeCsvField(field) {
  if (field === null || field === undefined) return '';
  const stringField = String(field);
  // Escape quotes by doubling them and wrap in quotes if contains comma, newline, or quote
  if (stringField.includes('"') || stringField.includes(',') || stringField.includes('\n')) {
    return `"${stringField.replace(/"/g, '""')}"`;
  }
  return stringField;
}

// Main function to export asset data
async function exportAssetData() {
  try {
    console.log('Starting export of all asset data...');
    
    // Get all assets with populated user information
    const assets = await Assets.find({})
      .populate({
        path: 'assignee',
        select: 'firstName lastName employeeId email team',
        match: { isDeleted: false }
      })
      .populate({
        path: 'assignedBy',
        select: 'firstName lastName employeeId email',
        match: { isDeleted: false }
      })
      .populate({
        path: 'updatedBy',
        select: 'firstName lastName employeeId email',
        match: { isDeleted: false }
      })
      .sort({ createdAt: -1 });
    
    console.log(`Found ${assets.length} total assets`);
    
    if (assets.length === 0) {
      console.log('No assets found');
      return;
    }
    
    // Filter out assets where assignee is deleted (populate match will return null)
    const validAssets = assets.filter(asset => asset.assignee);
    
    console.log(`Found ${validAssets.length} assets with valid assignees`);
    
    if (validAssets.length === 0) {
      console.log('No assets with valid assignees found');
      return;
    }
    
    // Prepare CSV data
    const csvHeader = [
      'Asset Type',
      'Asset Name', 
      'Serial Number',
      'Laptop Type',
      'Specifications',
      'Assignee ID',
      'Assignee Full Name',
      'Assignee Employee ID',
      'Assignee Email',
      'Assignee Team',
      'Assigned Date',
      'Status',
      'Description',
      'Acknowledged Date',
      'Return Request Date',
      'Return Date',
      'Rejection Reason',
      'Assigned By ID',
      'Assigned By Full Name',
      'Assigned By Employee ID',
      'Assigned By Email',
      'Updated By ID',
      'Updated By Full Name',
      'Updated By Employee ID',
      'Updated By Email',
      'Created At',
      'Updated At'
    ].join(',') + '\n';
    
    const csvRows = validAssets.map(asset => {
      const assigneeFullName = asset.assignee ? 
        `${asset.assignee.firstName || ''} ${asset.assignee.lastName || ''}`.trim() : '';
      const assigneeEmployeeId = asset.assignee?.employeeId || '';
      const assigneeEmail = asset.assignee?.email || '';
      const assigneeTeam = asset.assignee?.team || '';
      
      const assignedByFullName = asset.assignedBy ? 
        `${asset.assignedBy.firstName || ''} ${asset.assignedBy.lastName || ''}`.trim() : '';
      const assignedByEmployeeId = asset.assignedBy?.employeeId || '';
      const assignedByEmail = asset.assignedBy?.email || '';
      
      const updatedByFullName = asset.updatedBy ? 
        `${asset.updatedBy.firstName || ''} ${asset.updatedBy.lastName || ''}`.trim() : '';
      const updatedByEmployeeId = asset.updatedBy?.employeeId || '';
      const updatedByEmail = asset.updatedBy?.email || '';
      
      // Format specifications if it's an object
      let specifications = '';
      if (asset.specifications) {
        if (typeof asset.specifications === 'object') {
          specifications = JSON.stringify(asset.specifications);
        } else {
          specifications = asset.specifications;
        }
      }
      
      const row = [
        escapeCsvField(asset.assetType),
        escapeCsvField(asset.assetName),
        escapeCsvField(asset.serialNumber),
        escapeCsvField(asset.laptopType),
        escapeCsvField(specifications),
        escapeCsvField(asset.assignee?._id),
        escapeCsvField(assigneeFullName),
        escapeCsvField(assigneeEmployeeId),
        escapeCsvField(assigneeEmail),
        escapeCsvField(assigneeTeam),
        escapeCsvField(formatDate(asset.assignedDate)),
        escapeCsvField(asset.status),
        escapeCsvField(asset.description),
        escapeCsvField(formatDate(asset.acknowledgedDate)),
        escapeCsvField(formatDate(asset.returnRequestDate)),
        escapeCsvField(formatDate(asset.returnDate)),
        escapeCsvField(asset.rejectionReason),
        escapeCsvField(asset.assignedBy?._id),
        escapeCsvField(assignedByFullName),
        escapeCsvField(assignedByEmployeeId),
        escapeCsvField(assignedByEmail),
        escapeCsvField(asset.updatedBy?._id),
        escapeCsvField(updatedByFullName),
        escapeCsvField(updatedByEmployeeId),
        escapeCsvField(updatedByEmail),
        escapeCsvField(formatDateTime(asset.createdAt)),
        escapeCsvField(formatDateTime(asset.updatedAt))
      ];
      
      return row.join(',');
    });
    
    const csvContent = csvHeader + csvRows.join('\n');
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Generate filename with timestamp
    const timestamp = moment().tz('Asia/Kolkata').format('YYYY-MM-DD_HH-mm-ss');
    const filename = `Asset_Data_Export_${timestamp}.csv`;
    const filepath = path.join(outputDir, filename);
    
    // Write CSV file
    fs.writeFileSync(filepath, csvContent, 'utf8');
    
    console.log(`CSV file exported successfully: ${filepath}`);
    console.log(`Total records exported: ${validAssets.length}`);
    
    // Display sample data
    console.log('\nSample data (first 3 records):');
    console.log('Asset Type,Asset Name,Assignee Full Name,Assignee Employee ID,Status');
    validAssets.slice(0, 3).forEach(asset => {
      const assigneeFullName = asset.assignee ? 
        `${asset.assignee.firstName || ''} ${asset.assignee.lastName || ''}`.trim() : '';
      const assigneeEmployeeId = asset.assignee?.employeeId || '';
      
      console.log(`${asset.assetType},${asset.assetName},${assigneeFullName},${assigneeEmployeeId},${asset.status}`);
    });
    
    // Display summary statistics
    console.log('\nAsset Summary:');
    const assetTypeCount = {};
    const statusCount = {};
    const teamCount = {};
    
    validAssets.forEach(asset => {
      // Count by asset type
      assetTypeCount[asset.assetType] = (assetTypeCount[asset.assetType] || 0) + 1;
      
      // Count by status
      statusCount[asset.status] = (statusCount[asset.status] || 0) + 1;
      
      // Count by team
      if (asset.assignee?.team) {
        teamCount[asset.assignee.team] = (teamCount[asset.assignee.team] || 0) + 1;
      }
    });
    
    console.log('\nAsset Types:');
    Object.entries(assetTypeCount).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    console.log('\nAsset Status:');
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    
    console.log('\nAssets by Team:');
    Object.entries(teamCount).forEach(([team, count]) => {
      console.log(`  ${team}: ${count}`);
    });
    
  } catch (error) {
    console.error('Error exporting asset data:', error);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Function to export asset data for a specific team
async function exportAssetDataByTeam(teamName) {
  try {
    console.log(`Starting export of asset data for team: ${teamName}...`);
    
    // Get all assets with populated user information filtered by team
    const assets = await Assets.find({})
      .populate({
        path: 'assignee',
        select: 'firstName lastName employeeId email team',
        match: { isDeleted: false, team: teamName }
      })
      .populate({
        path: 'assignedBy',
        select: 'firstName lastName employeeId email',
        match: { isDeleted: false }
      })
      .populate({
        path: 'updatedBy',
        select: 'firstName lastName employeeId email',
        match: { isDeleted: false }
      })
      .sort({ createdAt: -1 });
    
    // Filter out assets where assignee is null (deleted or not in team)
    const teamAssets = assets.filter(asset => asset.assignee);
    
    console.log(`Found ${teamAssets.length} assets for team: ${teamName}`);
    
    if (teamAssets.length === 0) {
      console.log(`No assets found for team: ${teamName}`);
      return;
    }
    
    // Prepare CSV data (same as main export function)
    const csvHeader = [
      'Asset Type',
      'Asset Name', 
      'Serial Number',
      'Laptop Type',
      'Specifications',
      'Assignee ID',
      'Assignee Full Name',
      'Assignee Employee ID',
      'Assignee Email',
      'Assignee Team',
      'Assigned Date',
      'Status',
      'Description',
      'Acknowledged Date',
      'Return Request Date',
      'Return Date',
      'Rejection Reason',
      'Assigned By ID',
      'Assigned By Full Name',
      'Assigned By Employee ID',
      'Assigned By Email',
      'Updated By ID',
      'Updated By Full Name',
      'Updated By Employee ID',
      'Updated By Email',
      'Created At',
      'Updated At'
    ].join(',') + '\n';
    
    const csvRows = teamAssets.map(asset => {
      const assigneeFullName = asset.assignee ? 
        `${asset.assignee.firstName || ''} ${asset.assignee.lastName || ''}`.trim() : '';
      const assigneeEmployeeId = asset.assignee?.employeeId || '';
      const assigneeEmail = asset.assignee?.email || '';
      const assigneeTeam = asset.assignee?.team || '';
      
      const assignedByFullName = asset.assignedBy ? 
        `${asset.assignedBy.firstName || ''} ${asset.assignedBy.lastName || ''}`.trim() : '';
      const assignedByEmployeeId = asset.assignedBy?.employeeId || '';
      const assignedByEmail = asset.assignedBy?.email || '';
      
      const updatedByFullName = asset.updatedBy ? 
        `${asset.updatedBy.firstName || ''} ${asset.updatedBy.lastName || ''}`.trim() : '';
      const updatedByEmployeeId = asset.updatedBy?.employeeId || '';
      const updatedByEmail = asset.updatedBy?.email || '';
      
      // Format specifications if it's an object
      let specifications = '';
      if (asset.specifications) {
        if (typeof asset.specifications === 'object') {
          specifications = JSON.stringify(asset.specifications);
        } else {
          specifications = asset.specifications;
        }
      }
      
      const row = [
        escapeCsvField(asset.assetType),
        escapeCsvField(asset.assetName),
        escapeCsvField(asset.serialNumber),
        escapeCsvField(asset.laptopType),
        escapeCsvField(specifications),
        escapeCsvField(asset.assignee?._id),
        escapeCsvField(assigneeFullName),
        escapeCsvField(assigneeEmployeeId),
        escapeCsvField(assigneeEmail),
        escapeCsvField(assigneeTeam),
        escapeCsvField(formatDate(asset.assignedDate)),
        escapeCsvField(asset.status),
        escapeCsvField(asset.description),
        escapeCsvField(formatDate(asset.acknowledgedDate)),
        escapeCsvField(formatDate(asset.returnRequestDate)),
        escapeCsvField(formatDate(asset.returnDate)),
        escapeCsvField(asset.rejectionReason),
        escapeCsvField(asset.assignedBy?._id),
        escapeCsvField(assignedByFullName),
        escapeCsvField(assignedByEmployeeId),
        escapeCsvField(assignedByEmail),
        escapeCsvField(asset.updatedBy?._id),
        escapeCsvField(updatedByFullName),
        escapeCsvField(updatedByEmployeeId),
        escapeCsvField(updatedByEmail),
        escapeCsvField(formatDateTime(asset.createdAt)),
        escapeCsvField(formatDateTime(asset.updatedAt))
      ];
      
      return row.join(',');
    });
    
    const csvContent = csvHeader + csvRows.join('\n');
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Generate filename with timestamp and team name
    const timestamp = moment().tz('Asia/Kolkata').format('YYYY-MM-DD_HH-mm-ss');
    const filename = `Asset_Data_Export_${teamName}_${timestamp}.csv`;
    const filepath = path.join(outputDir, filename);
    
    // Write CSV file
    fs.writeFileSync(filepath, csvContent, 'utf8');
    
    console.log(`CSV file exported successfully: ${filepath}`);
    console.log(`Total records exported: ${teamAssets.length}`);
    
  } catch (error) {
    console.error('Error exporting asset data by team:', error);
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
    const teamName = args[0].toUpperCase();
    await exportAssetDataByTeam(teamName);
  } else {
    // Default to export all assets
    await exportAssetData();
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  exportAssetData,
  exportAssetDataByTeam
};
