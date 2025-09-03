const mongoose = require('mongoose');
const logger = require('../config/logger');
const User = require('../models/userModel');
const EmployeeHistory = require('../models/employeeHistory');
const employeeLeaveBalanceModel = require('../models/employeeLeaveBalanceModel');
const leavePolicyMappingModel = require('../models/leavePolicyMappingModel');
const leaveTypeModel = require('../models/leaveTypeModel');
require('dotenv').config({ path: './.env.development' });

// MongoDB Connection Setup
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    logger.error('❌ MONGO_URI not found in environment variables');
    process.exit(1);
}

mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

mongoose.connection.on('connected', () => {
    logger.info('✅ MongoDB connected');
});

mongoose.connection.on('error', (err) => {
    logger.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// Configuration
const CONFIG = {
    // Make dates configurable - can be overridden via environment variables
    TARGET_MONTH: process.env.TARGET_MONTH || '2025-08',
    DRY_RUN: process.env.DRY_RUN === 'true' || true,
    BATCH_SIZE: parseInt(process.env.BATCH_SIZE) || 1000,
    // Annual leave type ID - should be configurable
    ANNUAL_LEAVE_TYPE_ID: process.env.ANNUAL_LEAVE_TYPE_ID || '6863bf51949349ffc4e649bd'
};

// Utility functions
const formatDate = (dateString) => {
    const [year, month] = dateString.split('-');
    return new Date(`${year}-${month}-01T00:00:00.000Z`);
};

const validateLeaveType = async (leaveTypeId) => {
    try {
        const leaveType = await leaveTypeModel.findById(leaveTypeId);
        if (!leaveType) {
            throw new Error(`Leave type with ID ${leaveTypeId} not found`);
        }
        return leaveType;
    } catch (error) {
        logger.error('❌ Error validating leave type:', error);
        throw error;
    }
};

const processBatch = async (operations, model, operationName) => {
    if (operations.length === 0) {
        logger.info(`📝 No ${operationName} operations to perform`);
        return { processed: 0, errors: 0 };
    }

    try {
        const result = await model.bulkWrite(operations, { ordered: false });
        logger.info(`✅ ${operationName} completed: ${result.modifiedCount} records updated`);
        return { processed: result.modifiedCount, errors: 0 };
    } catch (error) {
        logger.error(`❌ Error in ${operationName}:`, error);
        return { processed: 0, errors: 1 };
    }
};

const runMonthlyLeaveAccrual = async ({ dryRun = CONFIG.DRY_RUN, targetMonth = CONFIG.TARGET_MONTH } = {}) => {
    const session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            logger.info(`📅 Starting monthly leave accrual job for ${targetMonth}...`);
            logger.info(`🔧 Mode: ${dryRun ? 'DRY RUN' : 'LIVE UPDATE'}`);

            // Validate configuration
            const targetDate = formatDate(targetMonth);
            const nextMonthDate = new Date(targetDate);
            nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);

            logger.info(`📅 Processing period: ${targetDate.toISOString()} to ${nextMonthDate.toISOString()}`);

            // Validate annual leave type
            const annualLeaveType = await validateLeaveType(CONFIG.ANNUAL_LEAVE_TYPE_ID);
            logger.info(`✅ Annual leave type validated: ${annualLeaveType.name}`);

            // 1️⃣ Get leave policy mappings for monthly accrual
            const mappings = await leavePolicyMappingModel.find({ accrualType: 'monthly' });
            const mappingMap = new Map();
            mappings.forEach((m) => mappingMap.set(m.leaveTypeId.toString(), m));

            logger.info(`📋 Found ${mappings.length} monthly accrual policies`);

            // 2️⃣ Get all user IDs who ever changed status
            const statusChangedUserIds = await EmployeeHistory.distinct("employeeId", { entity: "status" });
            logger.info(`🔄 Found ${statusChangedUserIds.length} users with status changes`);

            // 3️⃣ Normal monthly accrual: KAP users joined before target month & never changed status
            const normalUsers = await User.find({
                team: "KAP",
                createdAt: { $lt: targetDate },
                status: { $in: ["probation", "onroll"] },
                _id: { $nin: statusChangedUserIds }
            });

            const normalUserIds = normalUsers.map(u => u._id);
            const normalBalances = await employeeLeaveBalanceModel.find({
                userId: { $in: normalUserIds }
            });

            logger.info(`👥 Normal accrual: ${normalUsers.length} users, ${normalBalances.length} balances`);

            // Process normal monthly accrual
            const bulkOpsNormal = [];
            let normalAccrualTotal = 0;

            for (const balance of normalBalances) {
                const mapping = mappingMap.get(balance.leaveTypeId.toString());
                if (!mapping) continue;

                const accrual = mapping.accrualPerMonth || 0;
                normalAccrualTotal += accrual;

                if (dryRun) {
                    logger.info(`📊 User: ${balance.userId}, LeaveType: ${balance.leaveTypeId}, CurrentTotal: ${balance.total}, WillIncrease: ${accrual}`);
                } else {
                    bulkOpsNormal.push({
                        updateOne: {
                            filter: { _id: balance._id },
                            update: { $inc: { accrued: accrual, total: accrual } },
                        },
                    });
                }
            }

            // Execute normal accrual updates
            let normalResults = { processed: 0, errors: 0 };
            if (!dryRun && bulkOpsNormal.length > 0) {
                normalResults = await processBatch(bulkOpsNormal, employeeLeaveBalanceModel, 'normal monthly accrual');
            }

            // 4️⃣ Status change accrual: Add 1 to Annual leave total & carryForwarded for users who changed status in target month
            const statusChanges = await EmployeeHistory.find({
                entity: "status",
                previous: "probation",
                changed: "onroll",
                actionAt: { $gte: targetDate, $lt: nextMonthDate }
            });

            // 2️⃣ Get their user details to filter by team
            const statusChangeUserIds = statusChanges.map(s => s.employeeId);

            const statusChangeUsers = await User.find({
                _id: { $in: statusChangeUserIds },
                team: "KAP" // or whatever team you want to filter
            });

            logger.info(`🔄 Status changes in ${targetMonth}: ${statusChanges.length} users`);

            const filteredUserIds = statusChangeUsers.map(u => u._id);

            // 3️⃣ Now fetch annual leave balances only for filtered users
            const annualBalances = await employeeLeaveBalanceModel.find({
                userId: { $in: filteredUserIds },
                leaveTypeId: CONFIG.ANNUAL_LEAVE_TYPE_ID
            });


            logger.info(`📋 Annual leave balances found: ${annualBalances.length}`);

            // Process annual leave updates
            const bulkOpsAnnual = [];
            let annualUpdateTotal = 0;

            for (const balance of annualBalances) {
                annualUpdateTotal += 1;

                if (dryRun) {
                    logger.info(`📊 User: ${balance.userId}, CurrentTotal: ${balance.total}, CarryForwarded: ${balance.carryForwarded}, WillIncrease: 1`);
                } else {
                    bulkOpsAnnual.push({
                        updateOne: {
                            filter: { _id: balance._id },
                            update: { $inc: { total: 1, carryForwarded: 1 } },
                        },
                    });
                }
            }

            // Execute annual leave updates
            let annualResults = { processed: 0, errors: 0 };
            if (!dryRun && bulkOpsAnnual.length > 0) {
                annualResults = await processBatch(bulkOpsAnnual, employeeLeaveBalanceModel, 'annual leave status change updates');
            }

            // Summary report
            const summary = {
                targetMonth,
                dryRun,
                normalAccrual: {
                    users: normalUsers.length,
                    balances: normalBalances.length,
                    totalAccrual: normalAccrualTotal,
                    processed: normalResults.processed,
                    errors: normalResults.errors
                },
                statusChange: {
                    users: statusChanges.length,
                    balances: annualBalances.length,
                    totalUpdates: annualUpdateTotal,
                    processed: annualResults.processed,
                    errors: annualResults.errors
                }
            };

            logger.info('📊 Monthly Leave Accrual Summary:', summary);

            if (dryRun) {
                logger.info('🔍 DRY RUN COMPLETE - No changes made to database');
            } else {
                logger.info('✅ LIVE UPDATE COMPLETE - Database updated successfully');
            }

            return summary;
        });

    } catch (error) {
        logger.error('❌ Critical error in monthly leave accrual:', error);
        throw error;
    } finally {
        await session.endSession();
    }
};

// Command line interface
const parseArguments = () => {
    const args = process.argv.slice(2);
    const options = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dry-run' || args[i] === '-d') {
            options.dryRun = true;
        } else if (args[i] === '--live' || args[i] === '-l') {
            options.dryRun = false;
        } else if (args[i] === '--month' || args[i] === '-m') {
            options.targetMonth = args[i + 1];
            i++; // Skip next argument as it's the month value
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Usage: node FixLeaveDis.js [options]

Options:
  --dry-run, -d     Run in dry-run mode (default)
  --live, -l        Run in live mode (actual database updates)
  --month, -m       Target month in YYYY-MM format (default: ${CONFIG.TARGET_MONTH})
  --help, -h        Show this help message

Examples:
  node FixLeaveDis.js                    # Dry run for ${CONFIG.TARGET_MONTH}
  node FixLeaveDis.js --live            # Live update for ${CONFIG.TARGET_MONTH}
  node FixLeaveDis.js --month 2025-09   # Dry run for September 2025
  node FixLeaveDis.js --live --month 2025-09  # Live update for September 2025
      `);
            process.exit(0);
        }
    }

    return options;
};

// Run script if executed directly
if (require.main === module) {
    const options = parseArguments();

    runMonthlyLeaveAccrual(options)
        .then((summary) => {
            logger.info('🎉 Script completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            logger.error('💥 Script failed:', error);
            process.exit(1);
        })
        .finally(() => {
            mongoose.disconnect();
        });
}

module.exports = {
    runMonthlyLeaveAccrual,
    CONFIG
};
