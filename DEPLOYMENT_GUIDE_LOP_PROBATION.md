# LOP Leave for Probation Users - Deployment Guide

## Overview
This guide covers deploying the LOP (Loss of Pay) leave functionality for probation users to production.

## Prerequisites
- Access to production database
- Updated backend code deployed
- Updated frontend code deployed
- Backup of production database (recommended)

## Deployment Steps

### 1. Database Migration
Run the deployment script to add LOP functionality for probation users:

```bash
# Navigate to backend directory
cd hrms-backend

# Run the deployment script
node src/db-script/deployLopForProbation.js
```

**What this script does:**
- ✅ Adds LOP to Probation Policy
- ✅ Creates LOP balance records for existing probation users
- ✅ Verifies the deployment
- ✅ Provides summary of changes

### 2. Code Deployment
Deploy the updated code that includes:

**Backend Changes:**
- `src/services/leaveService.js` - LOP balance tracking
- `src/services/employeeLeaveBalanceService.js` - LOP filtering logic
- `src/services/userService.js` - User creation with LOP balances
- `src/utility/helper.js` - Email templates with LOP support

**Frontend Changes:**
- `components/leave/leave-policy.jsx` - LOP form options
- `components/leave/leave-table.jsx` - LOP display logic

### 3. Verification
After deployment, verify:

1. **Probation users can see LOP leave option**
2. **LOP leaves can be applied with half-day options**
3. **LOP leave approval updates balance tracking**
4. **Email notifications include LOP information**
5. **Leave table displays LOP with half-day info**

## Rollback (If Needed)

If you need to rollback the changes:

```bash
# Run the rollback script
node src/db-script/rollbackLopForProbation.js
```

**What this script does:**
- ✅ Removes LOP from Probation Policy
- ✅ Deletes LOP balance records for probation users
- ✅ Reverts to previous state

## Environment-Specific Commands

### Development
```bash
NODE_ENV=development node src/db-script/deployLopForProbation.js
```

### Staging
```bash
NODE_ENV=staging node src/db-script/deployLopForProbation.js
```

### Production
```bash
NODE_ENV=production node src/db-script/deployLopForProbation.js
```

## Expected Results

### Before Deployment
- Probation users: Only Probation leave available
- Onroll users: Annual, Casual/Sick, LOP available

### After Deployment
- Probation users: Probation + LOP leaves available
- Onroll users: Annual, Casual/Sick, LOP available (unchanged)

### Database Changes
- New LeavePolicyMapping for LOP in Probation Policy
- New EmployeeLeaveBalance records for probation users
- No changes to existing onroll user data

## Monitoring

After deployment, monitor:
1. **Error logs** for any LOP-related issues
2. **Leave applications** to ensure LOP is working
3. **Balance calculations** for accuracy
4. **Email notifications** for proper formatting

## Support

If issues occur:
1. Check the deployment script output for errors
2. Verify database connectivity
3. Check application logs
4. Use rollback script if necessary

## Files Modified

### Database Scripts
- `src/db-script/deployLopForProbation.js` - Main deployment script
- `src/db-script/rollbackLopForProbation.js` - Rollback script

### Backend Code
- `src/services/leaveService.js`
- `src/services/employeeLeaveBalanceService.js`
- `src/services/userService.js`
- `src/utility/helper.js`

### Frontend Code
- `components/leave/leave-policy.jsx`
- `components/leave/leave-table.jsx`

## Success Criteria

✅ Probation users can apply for LOP leaves
✅ LOP leaves support half-day options
✅ LOP leave usage is tracked in balance records
✅ Email notifications include LOP information
✅ Leave table displays LOP with half-day details
✅ No impact on existing onroll user functionality
