/* eslint-disable no-console */
/* eslint-disable prettier/prettier */
const { MongoClient } = require('mongodb');
const { Types } = require('mongoose');
// SKIPPING Holidays collection

const SPORTSDUNIA_URI = 'mongodb://localhost:27017';
const KOLLEGEAPPLY_URI = 'mongodb://localhost:27017';

const SPORTSDUNIA_DB_NAME = 'sportsdunia_dev';
const KOLLEGEAPPLY_DB_NAME = 'kollegeapply_dev';

const LeavePolicyMap = new Map();
const LeaveTypeMap = new Map();
const DepartmentMap = new Map();

async function MergingLeavePolicies(sportsduniaDb, kollegeapplyDb) {
    try {
        const leavePolicyCollectionKAPP = kollegeapplyDb.collection('leavepolicies');
        const leavePolicyCollectionSD = sportsduniaDb.collection('leavepolicies');

        const leavePoliciesKAPP = await leavePolicyCollectionKAPP.find({}).toArray();

        console.log(`📦 Found ${leavePoliciesKAPP.length} leave policies in KollegeApply database`);

        if (leavePoliciesKAPP.length === 0) {
            console.log('⚠️ No leave policies to migrate');
            return;
        }

        for (const policy of leavePoliciesKAPP) {
            const existingPolicy = await leavePolicyCollectionSD.findOne({ name: policy.name });
            if (existingPolicy) {
                console.log(`🔁 Policy "${policy.name}" already exists in SportsDunia`);
                LeavePolicyMap.set(policy._id.toString(), {
                    name: policy.name,
                    newId: existingPolicy._id
                });
                continue;
            }

            const { insertedId } = await leavePolicyCollectionSD.insertOne(policy);
            console.log(`✅ Inserted policy "${policy.name}" → _id: ${insertedId}`);
        }
    } catch (error) {
        console.error('❌ Error merging policies:', error);
    }
}


async function MergingLeaveTypes(sportsduniaDb, kollegeapplyDb) {
    try {
        const leaveTypeCollectionKAPP = kollegeapplyDb.collection('leavetypes');
        const leaveTypeCollectionSD = sportsduniaDb.collection('leavetypes');

        const leaveTypesKAPP = await leaveTypeCollectionKAPP.find({}).toArray();

        console.log(`📦 Found ${leaveTypesKAPP.length} leave types in KollegeApply database`);

        if (leaveTypesKAPP.length === 0) {
            console.log('⚠️ No leave types to migrate');
            return;
        }

        for (const type of leaveTypesKAPP) {
            const existingType = await leaveTypeCollectionSD.findOne({ code: type.code });
            if (existingType) {
                console.log(`🔁 Type "${type.name}" already exists in SportsDunia`);
                LeaveTypeMap.set(type._id.toString(), {
                    name: type.name,
                    newId: existingType._id
                });
                continue;
            }

            const { insertedId } = await leaveTypeCollectionSD.insertOne(type);
            console.log(`✅ Inserted type "${type.name}" → _id: ${insertedId}`);
        }
    } catch (error) {
        console.error('❌ Error merging types:', error);
    }
}

async function MergingDepartment(sportsduniaDb, kollegeapplyDb) {
    try {
        const departmentsCollectionKAPP = kollegeapplyDb.collection('departments');
        const departmentsCollectionSD = sportsduniaDb.collection('departments');

        const allDepartments = await departmentsCollectionKAPP.find({}).toArray();
        console.log(`📦 Found ${allDepartments.length} departments in KollegeApply DB`);

        for (const department of allDepartments) {
            const existingDepartment = await departmentsCollectionSD.findOne({ name: department.name });
            if (department.name === "Content") { 
                // Didn't creating a new Department for Content as it is already in SportsDunia with different casing, so will be replacing it with the SD departments content ID
                DepartmentMap.set(department._id.toString(), {
                    name: department.name,
                    newId: existingDepartment ? existingDepartment._id : null,
                    isDeleted: department.isDeleted
                })
                continue;
            }
            if (!existingDepartment) {
                console.log("🆕 Department doesn't exist in SportsDunia:", department.name);
                await departmentsCollectionSD.insertOne(department);
                console.log(`✅ Inserted new department "${department.name}" with departmentId: ${department._id}`);
            } else {
                console.log(`🔁 Department "${department.name}" already exists in SportsDunia`);
                DepartmentMap.set(department._id.toString(), {
                    name: department.name,
                    newId: existingDepartment._id,
                    isDeleted: department.isDeleted
                });
            }


        }
    } catch (error) {
        console.error("❌ Error merging departments:", error);
    }
}

// TODO: make sure to add team in the Schema also for users 
async function UpdateUser(sportsduniaDb, kollegeapplyDb) {
    try {
      const SDUsersCollection = sportsduniaDb.collection('users');
      const KAPPUsersCollection = kollegeapplyDb.collection('users');
  
      const kappUsers = await KAPPUsersCollection.find({}).toArray();
      const sdUsers = await SDUsersCollection.find({}).toArray();
  
      const kapBulkOps = kappUsers.map((user) => ({
        updateOne: {
          filter: { _id: user._id },
          update: { $set: { team: 'KAP' } },
        },
      }));
  
      const sdBulkOps = sdUsers.map((user) => ({
        updateOne: {
          filter: { _id: user._id },
          update: { $set: { team: 'SD' } },
        },
      }));
  
      if (kapBulkOps.length > 0) {
        await KAPPUsersCollection.bulkWrite(kapBulkOps);
        console.log(`Updated ${kapBulkOps.length} KAP users`);
      }
  
      if (sdBulkOps.length > 0) {
        await SDUsersCollection.bulkWrite(sdBulkOps);
        console.log(`Updated ${sdBulkOps.length} SD users`);
      }
  
    } catch (error) {
      console.error("Error during UpdateUser:", error);
    }
}
  
  
async function MergingUser(sportsduniaDb, kollegeapplyDb) {
    try {
        const usersCollectionKAPP = kollegeapplyDb.collection('users');
        const usersCollectionSD = sportsduniaDb.collection('users');

        const usersKAPP = await usersCollectionKAPP.find({}).toArray();

        console.log(`📦 Found ${usersKAPP.length} users in KollegeApply database`);

        if (usersKAPP.length === 0) {
            console.log('⚠️ No users to migrate');
            return;
        }

        for (const user of usersKAPP) {
            const existingUser = await usersCollectionSD.findOne({ email: user.email });
            if (existingUser) {
                console.log(`🔁 User "${user.email}" already exists in SportsDunia`);
                continue;
            }

            // Modifying 2 things before inserting
            user.leavePolicyId = LeavePolicyMap.get(user?.leavePolicyId?.toString())?.newId || user.leavePolicyId;
            user.departmentId = DepartmentMap.get(user?.departmentId?.toString())?.newId || user.departmentId;

            const { insertedId } = await usersCollectionSD.insertOne(user);
            console.log(`✅ Inserted user "${user.email}" → _id: ${insertedId}`);
        }
    } catch (error) {
        console.error('❌ Error merging users:', error);
    }
}

async function MergingEmployeeLeaveBalance(sportsduniaDb, kollegeapplyDb) { 
    try {
        const leaveBalanceCollectionKAPP = kollegeapplyDb.collection('employeeleavebalances');
        const leaveBalanceCollectionSD = sportsduniaDb.collection('employeeleavebalances');

        const leaveBalancesKAPP = await leaveBalanceCollectionKAPP.find({}).toArray();

        console.log(`📦 Found ${leaveBalancesKAPP.length} leave balances in KollegeApply database`);

        if (leaveBalancesKAPP.length === 0) {
            console.log('⚠️ No leave balances to migrate');
            return;
        }

        for (const balance of leaveBalancesKAPP) {
            // SD
            const existingBalance = await leaveBalanceCollectionSD.findOne({
                userId: balance.userId,
                leaveTypeId: balance.leaveTypeId
            });

            if (existingBalance) {
                console.log(`🔁 Balance for user "${balance.userId}" and type "${balance.leaveTypeId}" already exists in SportsDunia`);
                continue;
            }

            // Modifying 2 things before inserting
            balance.leaveTypeId = LeaveTypeMap.get(balance?.leaveTypeId?.toString())?.newId || balance.leaveTypeId;

            const { insertedId } = await leaveBalanceCollectionSD.insertOne(balance);
            console.log(`✅ Inserted balance for user "${balance.userId}" and type "${balance.leaveTypeId}" → _id: ${insertedId}`);
        }
    } catch (error) {
        console.error('❌ Error merging employee leave balances:', error);
    }
}

async function MergingLeaveApplications(sportsduniaDb, kollegeapplyDb) { 
    try {
        const leaveApplicationCollectionKAPP = kollegeapplyDb.collection('leaveapplications');
        const leaveApplicationCollectionSD = sportsduniaDb.collection('leaveapplications');

        const leaveApplicationsKAPP = await leaveApplicationCollectionKAPP.find({}).toArray();
        console.log(`📦 Found ${leaveApplicationsKAPP.length} leave applications in KollegeApply database`);


        for (const application of leaveApplicationCollectionKAPP) {
            // SD
            const existingApplication = await leaveApplicationCollectionSD.findOne({
                userId: application.userId,
                leaveTypeId: application.leaveTypeId,
                appliedOn: application.appliedOn,
            });

            if (existingApplication) {
                console.log(`🔁 Application for user "${application.userId}" and type "${application.leaveTypeId}" already exists in SportsDunia`);
                continue;
            }

            // Modifying 2 things before inserting
            application.leaveTypeId = LeaveTypeMap.get(application?.leaveTypeId?.toString())?.newId || application.leaveTypeId;

            const { insertedId } = await leaveApplicationCollectionSD.insertOne(application);
            console.log( `✅ Inserted application for user "${application.userId}" and type "${application.leaveTypeId}" → _id: ${insertedId}`);
        }
    } catch (error) {
        console.error('❌ Error merging leave applications:', error);
    }
}


async function MergingEmployeeHistory(sportsduniaDb, kollegeapplyDb) {
    try {
        const employeeHistoryCollectionKAPP = kollegeapplyDb.collection('employeehistories');
        const employeeHistoryCollectionSD = sportsduniaDb.collection('employeehistories');

        const employeeHistoryKAPP = await employeeHistoryCollectionKAPP.find({}).toArray();

        console.log(`📦 Found ${employeeHistoryKAPP.length} employee history records in KollegeApply database`);

        for(const history of employeeHistoryKAPP) {
            // SD
            const existingHistory = await employeeHistoryCollectionSD.findOne({
                employeeId: history.employeeId,
            });

            if (existingHistory) {
                console.log(`🔁 History for user "${history.employeeId}" already exists in SportsDunia`);
                continue;
            }

            const { insertedId } = await employeeHistoryCollectionSD.insertOne(history);
            console.log(`✅ Inserted history for user "${history.employeeId}" → _id: ${insertedId}`);
        }
        
        
    }catch (error) {
        console.error('❌ Error merging employee history:', error);
    }
}


async function MergingTickets(sportsduniaDb, kollegeapplyDb) {
    try {
        const employeeTicketCollectionKAPP = kollegeapplyDb.collection('tickets');
        const employeeTicketCollectionSD = sportsduniaDb.collection('tickets');

        const employeeTicketsKAPP = await employeeTicketCollectionKAPP.find({}).toArray();

        console.log(`📦 Found ${employeeTicketsKAPP.length} employee ticket records in KollegeApply database`);

        for(const ticket of employeeTicketsKAPP) {
            // SD
            const existingTicket = await employeeTicketCollectionSD.findOne({
                ticketId: ticket.ticketId,
                createdBy: ticket.createdBy,
            });

            if (existingTicket) {
                console.log(`🔁 Ticket for user "${ticket.ticketId}" already exists in SportsDunia`);
                continue;
            }

            const { insertedId } = await employeeTicketCollectionSD.insertOne(ticket);
            console.log(`✅ Inserted ticket for user "${ticket.ticketId}" → _id: ${insertedId}`);
        }
        
        
    }catch (error) {
        console.error('❌ Error merging ticket history:', error);
    }
}

async function MergingFeedback(sportsduniaDb, kollegeapplyDb) { 
    try {
        const feedbackCollectionKAPP = kollegeapplyDb.collection('feedbacks');
        const feedbackCollectionSD = sportsduniaDb.collection('feedbacks');

        const feedbacksKAPP = await feedbackCollectionKAPP.find({}).toArray();

        console.log(`📦 Found ${feedbacksKAPP.length} feedback records in KollegeApply database`);

        for (const feedback of feedbacksKAPP) {
            // SD
            const existingFeedback = await feedbackCollectionSD.findOne({
                userId: feedback.userId,
                createdAt: feedback.createdAt,
            });

            if (existingFeedback) {
                console.log(`🔁 Feedback for user "${feedback.userId}" already exists in SportsDunia`);
                continue;
            }

            const { insertedId } = await feedbackCollectionSD.insertOne(feedback);
            console.log(`✅ Inserted feedback for user "${feedback.userId}" → _id: ${insertedId}`);
        }
    } catch (error) {
        console.error('❌ Error merging feedback:', error);
    }
}

async function MergingAssests(sportsduniaDb, kollegeapplyDb) { 
    try {
        const assetsCollectionKAPP = kollegeapplyDb.collection('assets');
        const assetsCollectionSD = sportsduniaDb.collection('assets');

        const assetsKAPP = await assetsCollectionKAPP.find({}).toArray();

        console.log(`📦 Found ${assetsKAPP.length} assets in KollegeApply database`);

        if (assetsKAPP.length === 0) {
            console.log('⚠️ No assets to migrate');
            return;
        }

        for (const asset of assetsKAPP) {
            const existingAsset = await assetsCollectionSD.findOne({ assetId: asset.assetId });
            if (existingAsset) {
                console.log(`🔁 Asset "${asset.assetId}" already exists in SportsDunia`);
                continue;
            }

            const { insertedId } = await assetsCollectionSD.insertOne(asset);
            console.log(`✅ Inserted asset "${asset.assetId}" → _id: ${insertedId}`);
        }
        
    } catch (error) {
        console.error('❌ Error merging assets:', error);
    }
}

async function MergingAttendance(sportsduniaDb, kollegeapplyDb) { 
    try {
        const attendanceCollectionKAPP = kollegeapplyDb.collection('attendances');
        const attendanceCollectionSD = sportsduniaDb.collection('attendances');
        
        const attendanceKAPP = await attendanceCollectionKAPP.find({}).toArray();

        console.log(`📦 Found ${attendanceKAPP.length} attendance records in KollegeApply database`);

        if (attendanceKAPP.length === 0) {
            console.log('⚠️ No attendance records to migrate');
            return;
        }

        for (const record of attendanceKAPP) {
            const existingRecord = await attendanceCollectionSD.findOne({
                user: record.user,
                date: record.date,
            });

            if (existingRecord) {
                console.log(`🔁 Attendance for user "${record.user}" on "${record.date}" already exists in SportsDunia`);
                continue;
            }

            const { insertedId } = await attendanceCollectionSD.insertOne(record);
            console.log(`✅ Inserted attendance for user "${record.user}" on "${record.date}" → _id: ${insertedId}`);
        }
    } catch (error) {
        console.error('❌ Error merging attendance:', error);
    }
}

async function MergingWFH(sportsduniaDb, kollegeapplyDb) { 
    try {
        const wfhCollectionKAPP = kollegeapplyDb.collection('wfhs');
        const wfhCollectionSD = sportsduniaDb.collection('wfhs');

        const wfhRecordsKAPP = await wfhCollectionKAPP.find({}).toArray();

        console.log(`📦 Found ${wfhRecordsKAPP.length} WFH records in KollegeApply database`);

        if (wfhRecordsKAPP.length === 0) {
            console.log('⚠️ No WFH records to migrate');
            return;
        }

        for (const record of wfhRecordsKAPP) {
            const existingRecord = await wfhCollectionSD.findOne({
                userId: record.userId,
                date: record.date,
            });

            if (existingRecord) {
                console.log(`🔁 WFH for user "${record.userId}" on "${record.date}" already exists in SportsDunia`);
                continue;
            }

            const { insertedId } = await wfhCollectionSD.insertOne(record);
            console.log(`✅ Inserted WFH for user "${record.userId}" on "${record.date}" → _id: ${insertedId}`);
        }
    } catch (error) {
        console.error('❌ Error merging WFH records:', error);
    }
}

async function changeContentDepartmentId(sportsduniaDb) {
  try {
    const userCollection = sportsduniaDb.collection('users');

    const oldDepartmentId = new Types.ObjectId('68136177636d908096e420ce');
    const newDepartmentId = new Types.ObjectId('680f5401b6d574d4b5faaace');

    const userCount = await userCollection.countDocuments({ department: oldDepartmentId });
    console.log(`📦 Found ${userCount} users in the Content department`);

    if (userCount === 0) {
      console.log('⚠️ No users in the Content department to update');
      return;
    }

    const updateResult = await userCollection.updateMany(
      { department: oldDepartmentId },
      { $set: { department: newDepartmentId } }
    );

    console.log(`✅ Updated ${updateResult.modifiedCount} users to the new Content department`);
  } catch (error) {
    console.error('❌ Error changing Content department ID:', error);
  }
}


async function main() {
    const sportsduniaClient = new MongoClient(SPORTSDUNIA_URI);
    const kollegeapplyClient = new MongoClient(KOLLEGEAPPLY_URI);

    try {
        await sportsduniaClient.connect();
        console.log('✅ Connected to SportsDunia database');

        await kollegeapplyClient.connect();
        console.log('✅ Connected to KollegeApply database');

        // eslint-disable-next-line prettier/prettier
        const sportsduniaDb = sportsduniaClient.db(SPORTSDUNIA_DB_NAME);
        const kollegeapplyDb = kollegeapplyClient.db(KOLLEGEAPPLY_DB_NAME);

        await MergingLeavePolicies(sportsduniaDb, kollegeapplyDb);
        await MergingLeaveTypes(sportsduniaDb, kollegeapplyDb);
        await MergingDepartment(sportsduniaDb, kollegeapplyDb);
        await UpdateUser(sportsduniaDb, kollegeapplyDb);
        await MergingUser(sportsduniaDb, kollegeapplyDb);
        await MergingEmployeeLeaveBalance(sportsduniaDb, kollegeapplyDb);
        await MergingLeaveApplications(sportsduniaDb, kollegeapplyDb);
        await MergingEmployeeHistory(sportsduniaDb, kollegeapplyDb);
        await MergingTickets(sportsduniaDb, kollegeapplyDb);
        await MergingFeedback(sportsduniaDb, kollegeapplyDb);
        await MergingAssests(sportsduniaDb, kollegeapplyDb);
        await MergingAttendance(sportsduniaDb, kollegeapplyDb);
        await MergingWFH(sportsduniaDb, kollegeapplyDb);
        await changeContentDepartmentId(sportsduniaDb);
    } catch (error) {
        console.error('❌ Error in main function:', error);
    } finally {
        await sportsduniaClient.close();
        await kollegeapplyClient.close();
        console.log('🔌 Connections closed');
        console.log("📘 LeavePolicy Map", LeavePolicyMap);
        console.log("LeaveTypeMap", LeaveTypeMap)
        console.log("DepartmentMap", DepartmentMap);
    }
}

main();
