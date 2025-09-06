# Production Deployment Summary - LOP for Probation Users

## Quick Deployment Command

For production database, run this single command:

```bash
cd hrms-backend
node src/db-script/deployLopForProbation.js
```

## What This Does

1. **Adds LOP to Probation Policy** - Allows probation users to apply for LOP leaves
2. **Creates LOP balance records** - For all existing probation users (87 users in current DB)
3. **Enables half-day LOP** - Probation users can take first/second half LOP leaves
4. **Enables usage tracking** - LOP leave usage is tracked in balance records

## Files to Deploy

### Backend
- `src/services/leaveService.js` - LOP balance tracking
- `src/services/employeeLeaveBalanceService.js` - LOP filtering
- `src/services/userService.js` - User creation with LOP
- `src/utility/helper.js` - Email templates

### Frontend  
- `components/leave/leave-policy.jsx` - LOP form options
- `components/leave/leave-table.jsx` - LOP display

## Rollback (If Needed)

```bash
node src/db-script/rollbackLopForProbation.js
```

## Expected Result

**Before:** Probation users can only apply for Probation leave
**After:** Probation users can apply for Probation + LOP leaves (both with half-day options)

## Verification

After deployment, test:
1. Probation user can see LOP in leave type dropdown
2. Can apply for LOP leave with half-day options
3. LOP leave approval updates balance tracking
4. Email notifications show LOP information correctly

## Database Impact

- **Safe operation** - No existing data is modified
- **Additive only** - Only adds new records, doesn't change existing ones
- **Reversible** - Can be rolled back if needed

## Support

The deployment script provides detailed output and will show exactly what was done. If any issues occur, the rollback script can restore the previous state.
