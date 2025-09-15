const { MongoClient } = require('mongodb');
const { Types } = require('mongoose');
const path = require('path');
require('dotenv').config({ path: './.env.production' });
// require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.development') });

const SPORTSDUNIA_URI = process.env.SPORTSDUNIA_URI;
const KOLLEGEAPPLY_URI = process.env.KOLLEGEAPPLY_URI;


const SAFETY_CONFIG = {
    DRY_RUN: false, 
    CREATE_BACKUP: true, 
    VALIDATE_DATA: true, 
    MAX_BATCH_SIZE: 100, 
    RETRY_ATTEMPTS: 3, 
};

const MIGRATION_STATS = {
    totalRecords: 0,
    migratedRecords: 0,
    skippedRecords: 0,
    failedRecords: 0,
    startTime: null,
    endTime: null
};

const LeavePolicyMap = new Map();
const LeaveTypeMap = new Map();
const DepartmentMap = new Map();
const UserMap = new Map();


async function validateDatabaseConnections(sportsduniaDb, kollegeapplyDb) {
    try {
        console.log(' Validating database connections...');
        
        const sdCollections = await sportsduniaDb.listCollections().toArray();
        console.log(` SportsDunia connected. Collections: ${sdCollections.length}`);
        
        const kapCollections = await kollegeapplyDb.listCollections().toArray();
        console.log(` KollegeApply connected. Collections: ${kapCollections.length}`);
        
        return true;
    } catch (error) {
        console.error(' Database connection validation failed:', error);
        return false;
    }
}

async function createBackup(kollegeapplyDb) {
    if (!SAFETY_CONFIG.CREATE_BACKUP) {
        console.log(' Backup creation disabled');
        return true;
    }
    
    try {
        console.log(' Creating backup of KollegeApply database...');
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const backupDbName = `kap_backup_${timestamp}`;
        
        const backupDb = kollegeapplyDb.client.db(backupDbName);
        
        const collections = await kollegeapplyDb.listCollections().toArray();
        
        for (const collection of collections) {
            const sourceCollection = kollegeapplyDb.collection(collection.name);
            const backupCollection = backupDb.collection(collection.name);
            
            const documents = await sourceCollection.find({}).toArray();
            if (documents.length > 0) {
                await backupCollection.insertMany(documents);
                console.log(` Backed up ${documents.length} documents from ${collection.name}`);
            }
        }
        
        console.log(` Backup created: ${backupDbName}`);
        return true;
    } catch (error) {
        console.error(' Backup creation failed:', error);
        return false;
    }
}

async function validateDataIntegrity(sportsduniaDb, kollegeapplyDb) {
    if (!SAFETY_CONFIG.VALIDATE_DATA) {
        console.log(' Data validation disabled');
        return true;
    }
    
    try {
        console.log(' Validating data integrity...');
        
        const requiredCollections = ['users', 'departments', 'leavepolicies', 'leavetypes'];
        const sdCollections = await sportsduniaDb.listCollections().toArray();
        const kapCollections = await kollegeapplyDb.listCollections().toArray();
        
        const sdCollectionNames = sdCollections.map(c => c.name);
        const kapCollectionNames = kapCollections.map(c => c.name);
        
        for (const collection of requiredCollections) {
            if (!sdCollectionNames.includes(collection)) {
                console.error(` Required collection missing in SD: ${collection}`);
                return false;
            }
            if (!kapCollectionNames.includes(collection)) {
                console.error(` Required collection missing in KAP: ${collection}`);
                return false;
            }
        }
        
        console.log(' Data integrity validation passed');
        return true;
    } catch (error) {
        console.error(' Data integrity validation failed:', error);
        return false;
    }
}

async function detectConflicts(sportsduniaDb, kollegeapplyDb) {
    try {
        console.log(' Detecting potential conflicts...');
        
        const conflicts = [];
        
        const sdUsers = await sportsduniaDb.collection('users').find({}).toArray();
        const kapUsers = await kollegeapplyDb.collection('users').find({}).toArray();
        
        const sdEmails = new Set(sdUsers.map(u => u.email?.toLowerCase()));
        const kapEmails = new Set(kapUsers.map(u => u.email?.toLowerCase()));
        
        const emailConflicts = [...sdEmails].filter(email => kapEmails.has(email));
        if (emailConflicts.length > 0) {
            conflicts.push({
                type: 'email_conflict',
                count: emailConflicts.length,
                details: emailConflicts.slice(0, 5),
            });
        }
        
        const sdDepts = await sportsduniaDb.collection('departments').find({}).toArray();
        const kapDepts = await kollegeapplyDb.collection('departments').find({}).toArray();
        
        const sdDeptNames = new Set(sdDepts.map(d => d.name?.toLowerCase()));
        const kapDeptNames = new Set(kapDepts.map(d => d.name?.toLowerCase()));
        
        const deptConflicts = [...sdDeptNames].filter(name => kapDeptNames.has(name));
        if (deptConflicts.length > 0) {
            conflicts.push({
                type: 'department_conflict',
                count: deptConflicts.length,
                details: deptConflicts.slice(0, 5)
            });
        }
        
        if (conflicts.length > 0) {
            console.log(' Potential conflicts detected:');
            conflicts.forEach(conflict => {
                console.log(`  - ${conflict.type}: ${conflict.count} conflicts`);
                if (conflict.details) {
                    console.log(`    Examples: ${conflict.details.join(', ')}`);
                }
            });
        } else {
            console.log(' No conflicts detected');
        }
        
        return conflicts;
    } catch (error) {
        console.error(' Conflict detection failed:', error);
        return [];
    }
}

async function createUserMapping(kollegeapplyDb, sportsduniaDb) {
    try {
        const usersCollectionSD = sportsduniaDb.collection('users');
        const usersCollectionKAPP = kollegeapplyDb.collection('users');

        const usersSD = await usersCollectionSD.find({}).toArray();
        console.log(` Creating user mapping for ${usersSD.length} SD users`);

        let existingUsers = 0;
        let newUsers = 0;

        for (const user of usersSD) {
            if (!user.email) {
                console.log(` Skipping user without email: ${user._id}`);
                continue;
            }

            const existingUser = await usersCollectionKAPP.findOne({ 
                email: { $regex: new RegExp(`^${user.email}$`, 'i') } 
            });
            
            if (existingUser) {
                UserMap.set(user._id.toString(), {
                    email: user.email,
                    newId: existingUser._id,
                    isExisting: true,
                    conflict: false
                });
                existingUsers++;
                console.log(` Mapped existing user "${user.email}": ${user._id} → ${existingUser._id}`);
            } else {
                UserMap.set(user._id.toString(), {
                    email: user.email,
                    newId: null,
                    isExisting: false,
                    conflict: false
                });
                newUsers++;
            }
        }
        
        console.log(` User mapping created. Existing: ${existingUsers}, New: ${newUsers}, Total: ${UserMap.size}`);
    } catch (error) {
        console.error(' Error creating user mapping:', error);
        throw error;
    }
}

async function updateUserMappingsAfterInsertion(kollegeapplyDb, sportsduniaDb) {
    try {
        const usersCollectionSD = sportsduniaDb.collection('users');
        const usersCollectionKAPP = kollegeapplyDb.collection('users');

        const usersSD = await usersCollectionSD.find({}).toArray();
        
        for (const user of usersSD) {
            const userMapping = UserMap.get(user._id.toString());
            if (userMapping && !userMapping.isExisting) {
                const newUser = await usersCollectionKAPP.findOne({ email: user.email });
                if (newUser) {
                    userMapping.newId = newUser._id;
                    console.log(` Updated user mapping for "${user.email}": ${user._id} → ${newUser._id}`);
                }
            }
        }
    } catch (error) {
        console.error(' Error updating user mappings:', error);
    }
}

function mapReferencedIds(document, mappingType) {
    const mappedDoc = { ...document };
    
    switch (mappingType) {
        case 'user':
            if (mappedDoc.userId) {
                const userMapping = UserMap.get(mappedDoc.userId.toString());
                if (userMapping?.newId) {
                    mappedDoc.userId = userMapping.newId;
                }
            }
            if (mappedDoc.user) {
                const userMapping = UserMap.get(mappedDoc.user.toString());
                if (userMapping?.newId) {
                    mappedDoc.user = userMapping.newId;
                }
            }
            if (mappedDoc.createdBy) {
                const userMapping = UserMap.get(mappedDoc.createdBy.toString());
                if (userMapping?.newId) {
                    mappedDoc.createdBy = userMapping.newId;
                }
            }
            if (mappedDoc.updatedBy) {
                const userMapping = UserMap.get(mappedDoc.updatedBy.toString());
                if (userMapping?.newId) {
                    mappedDoc.updatedBy = userMapping.newId;
                }
            }
            if (mappedDoc.edittedBy) {
                const userMapping = UserMap.get(mappedDoc.edittedBy.toString());
                if (userMapping?.newId) {
                    mappedDoc.edittedBy = userMapping.newId;
                }
            }
            break;
            
        case 'department':
            if (mappedDoc.department) {
                const deptMapping = DepartmentMap.get(mappedDoc.department.toString());
                if (deptMapping?.newId) {
                    mappedDoc.department = deptMapping.newId;
                }
            }
            break;
            
        case 'leaveType':
            if (mappedDoc.leaveTypeId) {
                const leaveTypeMapping = LeaveTypeMap.get(mappedDoc.leaveTypeId.toString());
                if (leaveTypeMapping?.newId) {
                    mappedDoc.leaveTypeId = leaveTypeMapping.newId;
                }
            }
            break;
            
        case 'leavePolicy':
            if (mappedDoc.leavePolicyId) {
                const policyMapping = LeavePolicyMap.get(mappedDoc.leavePolicyId.toString());
                if (policyMapping?.newId) {
                    mappedDoc.leavePolicyId = policyMapping.newId;
                }
            }
            break;
    }
    
    return mappedDoc;
}

async function validateMigrationResults(kollegeapplyDb, sportsduniaDb) {
    try {
        console.log('\n Validating migration results...');
        
        const validationResults = [];
        
        const sdUserCount = await sportsduniaDb.collection('users').countDocuments();
        const kapUserCount = await kollegeapplyDb.collection('users').countDocuments();
        validationResults.push({
            collection: 'users',
            source: sdUserCount,
            target: kapUserCount,
            status: kapUserCount >= sdUserCount ? '' : ''
        });
        
        const sdDeptCount = await sportsduniaDb.collection('departments').countDocuments();
        const kapDeptCount = await kollegeapplyDb.collection('departments').countDocuments();
        validationResults.push({
            collection: 'departments',
            source: sdDeptCount,
            target: kapDeptCount,
            status: kapDeptCount >= sdDeptCount ? '' : ''
        });
        
        const sdPolicyCount = await sportsduniaDb.collection('leavepolicies').countDocuments();
        const kapPolicyCount = await kollegeapplyDb.collection('leavepolicies').countDocuments();
        validationResults.push({
            collection: 'leavepolicies',
            source: sdPolicyCount,
            target: kapPolicyCount,
            status: kapPolicyCount >= sdPolicyCount ? '' : ''
        });
        
        const sdTypeCount = await sportsduniaDb.collection('leavetypes').countDocuments();
        const kapTypeCount = await kollegeapplyDb.collection('leavetypes').countDocuments();
        validationResults.push({
            collection: 'leavetypes',
            source: sdTypeCount,
            target: kapTypeCount,
            status: kapTypeCount >= sdTypeCount ? '' : ''
        });
        
        console.log(' Migration Validation Results:');
        validationResults.forEach(result => {
            console.log(`  ${result.status} ${result.collection}: ${result.source} → ${result.target}`);
        });
        
        const allValid = validationResults.every(r => r.status === '');
        if (allValid) {
            console.log(' All validations passed!');
        } else {
            console.log(' Some validations failed. Please review the results.');
        }
        
        return allValid;
    } catch (error) {
        console.error(' Validation failed:', error);
        return false;
    }
}

async function MergingLeavePolicies(kollegeapplyDb, sportsduniaDb) {
    try {
        const leavePolicyCollectionSD = sportsduniaDb.collection('leavepolicies');
        const leavePolicyCollectionKAPP = kollegeapplyDb.collection('leavepolicies');

        const leavePoliciesSD = await leavePolicyCollectionSD.find({}).toArray();

        console.log(` Found ${leavePoliciesSD.length} leave policies in SportsDunia database`);

        if (leavePoliciesSD.length === 0) {
            console.log(' No leave policies to migrate');
            return;
        }

        for (const policy of leavePoliciesSD) {
            const existingPolicy = await leavePolicyCollectionKAPP.findOne({ name: policy.name });
            if (existingPolicy) {
                console.log(` Policy "${policy.name}" already exists in KollegeApply`);
                LeavePolicyMap.set(policy._id.toString(), {
                    name: policy.name,
                    newId: existingPolicy._id
                });
                MIGRATION_STATS.skippedRecords++;
                continue;
            }

            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert policy "${policy.name}" (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await leavePolicyCollectionKAPP.insertOne(policy);
                console.log(` Inserted policy "${policy.name}" → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
    } catch (error) {
        console.error(' Error merging policies:', error);
    }
}


async function MergingLeaveTypes(kollegeapplyDb, sportsduniaDb) {
    try {
        const leaveTypeCollectionSD = sportsduniaDb.collection('leavetypes');
        const leaveTypeCollectionKAPP = kollegeapplyDb.collection('leavetypes');

        const leaveTypesSD = await leaveTypeCollectionSD.find({}).toArray();

        console.log(` Found ${leaveTypesSD.length} leave types in SportsDunia database`);

        if (leaveTypesSD.length === 0) {
            console.log(' No leave types to migrate');
            return;
        }

        for (const type of leaveTypesSD) {
            const existingType = await leaveTypeCollectionKAPP.findOne({ code: type.code });
            if (existingType) {
                console.log(` Type "${type.name}" already exists in KollegeApply`);
                LeaveTypeMap.set(type._id.toString(), {
                    name: type.name,
                    newId: existingType._id
                });
                continue;
            }

            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert type "${type.name}" (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await leaveTypeCollectionKAPP.insertOne(type);
                console.log(` Inserted type "${type.name}" → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
    } catch (error) {
        console.error(' Error merging types:', error);
    }
}

async function MergingDepartment(kollegeapplyDb, sportsduniaDb) {
    try {
        const departmentsCollectionSD = sportsduniaDb.collection('departments');
        const departmentsCollectionKAPP = kollegeapplyDb.collection('departments');
        const usersCollectionSD = sportsduniaDb.collection('users');

        const allDepartments = await departmentsCollectionSD.find({}).toArray();
        console.log(` Found ${allDepartments.length} departments in SportsDunia DB`);

        const kapDepartments = await departmentsCollectionKAPP.find({}).toArray();
        const kapDepartmentMap = new Map();
        kapDepartments.forEach(dept => {
            kapDepartmentMap.set(dept.name.toLowerCase(), dept);
        });

        console.log(` Found ${kapDepartments.length} departments in KAP for mapping`);

        for (const department of allDepartments) {
            if (department.isDeleted) {
                console.log(` Skipping deleted department "${department.name}" from SportsDunia`);
                continue;
            }

            const existingDepartment = await departmentsCollectionKAPP.findOne({ 
                name: { $regex: new RegExp(`^${department.name}$`, 'i') },
                isDeleted: { $ne: true }
            });
            
            let anyExistingDepartment = existingDepartment;
            if (!existingDepartment) {
                anyExistingDepartment = await departmentsCollectionKAPP.findOne({ 
                    name: { $regex: new RegExp(`^${department.name}$`, 'i') }
                });
            }

            if (department.name.toLowerCase() === "content") {
                if (existingDepartment) {
                    console.log(` Active Content department found in KollegeApply (${existingDepartment.name})`);
                    
                    const departmentUpdate = { ...department };
                    delete departmentUpdate.isDeleted;
                    delete departmentUpdate._id;
                    
                    if (SAFETY_CONFIG.DRY_RUN) {
                        console.log(` Would update Content department with SD data (DRY RUN)`);
                    } else {
                        const updateResult = await departmentsCollectionKAPP.updateOne(
                            { _id: existingDepartment._id },
                            { $set: departmentUpdate }
                        );
                        if (updateResult.modifiedCount > 0) {
                            console.log(` Updated Content department with SD data`);
                        } else {
                            console.log(` No changes needed for Content department`);
                        }
                    }
                    
                    DepartmentMap.set(department._id.toString(), {
                        name: department.name,
                        newId: existingDepartment._id,
                        isDeleted: existingDepartment.isDeleted 
                    });
                } else if (anyExistingDepartment) {
                    console.log(` Found deleted Content department in KollegeApply - will create new active one`);
                    const newDepartment = { ...department, isDeleted: false };
                    
                    if (SAFETY_CONFIG.DRY_RUN) {
                        console.log(` Would create new active Content department (DRY RUN)`);
                    } else {
                        const { insertedId } = await departmentsCollectionKAPP.insertOne(newDepartment);
                        console.log(` Created new active Content department with ID: ${insertedId}`);
                        
                        DepartmentMap.set(department._id.toString(), {
                            name: department.name,
                            newId: insertedId,
                            isDeleted: false
                        });
                    }
                } else {
                    console.log(` Content department not found in KollegeApply - creating new`);
                    DepartmentMap.set(department._id.toString(), {
                        name: department.name,
                        newId: null,
                        isDeleted: department.isDeleted
                    });
                }
                continue;
            }

            if (!existingDepartment) {
                if (anyExistingDepartment) {
                    console.log(` Found deleted "${department.name}" department in KollegeApply - will create new active one`);
                    const newDepartment = { ...department, isDeleted: false };
                    
                    if (SAFETY_CONFIG.DRY_RUN) {
                        console.log(` Would create new active department "${department.name}" (DRY RUN)`);
                        DepartmentMap.set(department._id.toString(), {
                            name: department.name,
                            newId: null,
                            isDeleted: false
                        });
                    } else {
                        const { insertedId } = await departmentsCollectionKAPP.insertOne(newDepartment);
                        console.log(` Created new active department "${department.name}" with ID: ${insertedId}`);
                        
                        DepartmentMap.set(department._id.toString(), {
                            name: department.name,
                            newId: insertedId,
                            isDeleted: false
                        });
                    }
                } else {
                    if (SAFETY_CONFIG.DRY_RUN) {
                        console.log(` Would create new department "${department.name}" (DRY RUN)`);
                        DepartmentMap.set(department._id.toString(), {
                            name: department.name,
                            newId: null,
                            isDeleted: department.isDeleted
                        });
                    } else {
                        console.log(` Department "${department.name}" doesn't exist in KollegeApply - creating new`);
                        const { insertedId } = await departmentsCollectionKAPP.insertOne(department);
                        console.log(` Inserted new department "${department.name}" with ID: ${insertedId}`);
                        
                        // Add to mapping for new departments
                        DepartmentMap.set(department._id.toString(), {
                            name: department.name,
                            newId: insertedId,
                            isDeleted: department.isDeleted
                        });
                    }
                }
            } else {
                console.log(` Active department "${department.name}" already exists in KollegeApply (${existingDepartment.name})`);
                
                const departmentUpdate = { ...department };
                delete departmentUpdate.isDeleted;
                delete departmentUpdate._id;
                
                if (SAFETY_CONFIG.DRY_RUN) {
                    console.log(` Would update department "${department.name}" with SD data (DRY RUN)`);
                } else {
                    const updateResult = await departmentsCollectionKAPP.updateOne(
                        { _id: existingDepartment._id },
                        { $set: departmentUpdate }
                    );
                    if (updateResult.modifiedCount > 0) {
                        console.log(` Updated department "${department.name}" with SD data`);
                    } else {
                        console.log(` No changes needed for department "${department.name}"`);
                    }
                }
                
                DepartmentMap.set(department._id.toString(), {
                    name: department.name,
                    newId: existingDepartment._id,
                    isDeleted: existingDepartment.isDeleted
                });
            }
        }

        console.log(`\n Updating SD users' department assignments...`);
        const sdUsers = await usersCollectionSD.find({}).toArray();
        
        for (const user of sdUsers) {
            if (!user.department) {
                console.log(` User ${user.email} has no department assigned`);
                continue;
            }

            const originalDept = allDepartments.find(d => d._id.toString() === user.department.toString());
            if (!originalDept) {
                console.log(` User ${user.email} has invalid department ID: ${user.department}`);
                continue;
            }

            const matchingKapDept = kapDepartmentMap.get(originalDept.name.toLowerCase());
            
            if (matchingKapDept) {
                if (SAFETY_CONFIG.DRY_RUN) {
                    console.log(` Would update user "${user.email}" department from "${originalDept.name}" to "${matchingKapDept.name}" (DRY RUN)`);
                } else {
                    const updateResult = await usersCollectionSD.updateOne(
                        { _id: user._id },
                        { $set: { department: matchingKapDept._id } }
                    );
                    if (updateResult.modifiedCount > 0) {
                        console.log(` Updated user "${user.email}" department from "${originalDept.name}" to "${matchingKapDept.name}"`);
                    }
                }
            } else {
                console.log(` No matching KAP department found for "${originalDept.name}" - user "${user.email}" will keep original department`);
            }
        }

        console.log(` Department mapping completed. Total mappings: ${DepartmentMap.size}`);
    } catch (error) {
        console.error(" Error merging departments:", error);
    }
}

async function FixDepartmentAssignments(kollegeapplyDb, sportsduniaDb) {
    try {
        const usersCollectionKAPP = kollegeapplyDb.collection('users');
        const departmentsCollectionKAPP = kollegeapplyDb.collection('departments');
        
        const kapDepartments = await departmentsCollectionKAPP.find({}).toArray();
        const kapDepartmentMap = new Map();
        kapDepartments.forEach(dept => {
            kapDepartmentMap.set(dept.name.toLowerCase(), dept);
        });
        
        console.log(` Found ${kapDepartments.length} departments in KAP for assignment fixing`);
        
        const allKapUsers = await usersCollectionKAPP.find({}).toArray();
        
        const sdUsersInKap = allKapUsers.filter(user => user.team === 'SD');
        console.log(` Found ${sdUsersInKap.length} SD users in KAP database`);
        
        for (const user of sdUsersInKap) {
            if (!user.department) {
                console.log(` SD user ${user.email} has no department assigned`);
                continue;
            }
            
            const userDepartment = kapDepartments.find(dept => dept._id.toString() === user.department.toString());
            if (!userDepartment) {
                console.log(` SD user ${user.email} has invalid department ID: ${user.department}`);
                continue;
            }
            
            if (userDepartment.isDeleted) {
                console.log(` SD user ${user.email} is assigned to deleted department: ${userDepartment.name}`);
                
                const activeDepartment = kapDepartments.find(dept => 
                    dept.name.toLowerCase() === userDepartment.name.toLowerCase() && 
                    !dept.isDeleted
                );
                
                if (activeDepartment) {
                    if (SAFETY_CONFIG.DRY_RUN) {
                        console.log(` Would fix user "${user.email}" department from deleted "${userDepartment.name}" to active "${activeDepartment.name}" (DRY RUN)`);
                    } else {
                        const updateResult = await usersCollectionKAPP.updateOne(
                            { _id: user._id },
                            { $set: { department: activeDepartment._id } }
                        );
                        if (updateResult.modifiedCount > 0) {
                            console.log(` Fixed user "${user.email}" department from deleted "${userDepartment.name}" to active "${activeDepartment.name}"`);
                        }
                    }
                } else {
                    console.log(` No active department found for "${userDepartment.name}" - user "${user.email}" will keep deleted department`);
                }
            }
        }
    } catch (error) {
        console.error(" Error fixing department assignments:", error);
    }
}

async function FixTeamAssignments(kollegeapplyDb, sportsduniaDb) {
    try {
        const usersCollectionKAPP = kollegeapplyDb.collection('users');
        
        const allKapUsers = await usersCollectionKAPP.find({}).toArray();
        console.log(` Found ${allKapUsers.length} total users in KAP database`);
        
        const sdUsersCollection = sportsduniaDb.collection('users');
        const sdUsers = await sdUsersCollection.find({}).toArray();
        const sdEmails = new Set(sdUsers.map(u => u.email.toLowerCase()));
        
        let kapUsersFixed = 0;
        let sdUsersFixed = 0;
        
        for (const user of allKapUsers) {
            const isSDUser = sdEmails.has(user.email.toLowerCase());
            
            if (isSDUser && user.team !== 'SD') {
                if (SAFETY_CONFIG.DRY_RUN) {
                    console.log(` Would fix user "${user.email}" team from "${user.team}" to "SD" (DRY RUN)`);
                } else {
                    const updateResult = await usersCollectionKAPP.updateOne(
                        { _id: user._id },
                        { $set: { team: 'SD' } }
                    );
                    if (updateResult.modifiedCount > 0) {
                        console.log(` Fixed user "${user.email}" team from "${user.team}" to "SD"`);
                        sdUsersFixed++;
                    }
                }
            } else if (!isSDUser && user.team !== 'KAP') {
                if (SAFETY_CONFIG.DRY_RUN) {
                    console.log(` Would fix user "${user.email}" team from "${user.team}" to "KAP" (DRY RUN)`);
                } else {
                    const updateResult = await usersCollectionKAPP.updateOne(
                        { _id: user._id },
                        { $set: { team: 'KAP' } }
                    );
                    if (updateResult.modifiedCount > 0) {
                        console.log(` Fixed user "${user.email}" team from "${user.team}" to "KAP"`);
                        kapUsersFixed++;
                    }
                }
            }
        }
        
        if (!SAFETY_CONFIG.DRY_RUN) {
            console.log(` Team assignment summary: ${kapUsersFixed} KAP users fixed, ${sdUsersFixed} SD users fixed`);
        }
        
    } catch (error) {
        console.error(" Error fixing team assignments:", error);
    }
}

async function UpdateUserTeams(kollegeapplyDb, sportsduniaDb) {
    try {
      const KAPPUsersCollection = kollegeapplyDb.collection('users');
      const SDUsersCollection = sportsduniaDb.collection('users');
  
      const kapUsers = await KAPPUsersCollection.find({}).toArray();
      const kapUsersToUpdate = kapUsers.filter(user => !user.team);
      const kapBulkOps = kapUsersToUpdate.map((user) => ({
        updateOne: {
          filter: { _id: user._id },
          update: { $set: { team: 'KAP' } },
        },
      }));
  
      const sdUsers = await SDUsersCollection.find({}).toArray();
      const sdUsersToUpdate = sdUsers.filter(user => !user.team);
      const sdBulkOps = sdUsersToUpdate.map((user) => ({
        updateOne: {
          filter: { _id: user._id },
          update: { $set: { team: 'SD' } },
        },
      }));
  
      if (SAFETY_CONFIG.DRY_RUN) {
        console.log(` Would update ${kapBulkOps.length} KAP users with team 'KAP' (DRY RUN)`);
        console.log(` Would update ${sdBulkOps.length} SD users with team 'SD' (DRY RUN)`);
        console.log(` KAP users: ${kapUsers.length} total, ${kapUsersToUpdate.length} need team assignment`);
        console.log(` SD users: ${sdUsers.length} total, ${sdUsersToUpdate.length} need team assignment`);
      } else {
        if (kapBulkOps.length > 0) {
          await KAPPUsersCollection.bulkWrite(kapBulkOps);
          console.log(` Updated ${kapBulkOps.length} KAP users with team 'KAP'`);
        } else {
          console.log(` All KAP users already have team assigned`);
        }
    
        if (sdBulkOps.length > 0) {
          await SDUsersCollection.bulkWrite(sdBulkOps);
          console.log(` Updated ${sdBulkOps.length} SD users with team 'SD'`);
        } else {
          console.log(` All SD users already have team assigned`);
        }
      }
  
    } catch (error) {
      console.error("Error during UpdateUserTeams:", error);
    }
}
  
  
async function MergingUser(kollegeapplyDb, sportsduniaDb) {
    try {
        const usersCollectionSD = sportsduniaDb.collection('users');
        const usersCollectionKAPP = kollegeapplyDb.collection('users');

        const usersSD = await usersCollectionSD.find({}).toArray();

        console.log(` Found ${usersSD.length} users in SportsDunia database`);

        if (usersSD.length === 0) {
            console.log(' No users to migrate');
            return;
        }

        for (const user of usersSD) {
            const existingUser = await usersCollectionKAPP.findOne({ email: user.email });
            if (existingUser) {
                console.log(` User "${user.email}" already exists in KollegeApply`);
                continue;
            }

            let userToInsert = { ...user };
            
            userToInsert.leavePolicyId = LeavePolicyMap.get(user?.leavePolicyId?.toString())?.newId || user.leavePolicyId;
            userToInsert.department = DepartmentMap.get(user?.department?.toString())?.newId || user.department;
            
            userToInsert = mapReferencedIds(userToInsert, 'user');

            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert user "${user.email}" (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await usersCollectionKAPP.insertOne(userToInsert);
                console.log(` Inserted user "${user.email}" → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
        
        await updateUserMappingsAfterInsertion(kollegeapplyDb, sportsduniaDb);
    } catch (error) {
        console.error(' Error merging users:', error);
    }
}

async function MergingEmployeeLeaveBalance(kollegeapplyDb, sportsduniaDb) { 
    try {
        const leaveBalanceCollectionSD = sportsduniaDb.collection('employeeleavebalances');
        const leaveBalanceCollectionKAPP = kollegeapplyDb.collection('employeeleavebalances');

        const leaveBalancesSD = await leaveBalanceCollectionSD.find({}).toArray();

        console.log(` Found ${leaveBalancesSD.length} leave balances in SportsDunia database`);

        if (leaveBalancesSD.length === 0) {
            console.log(' No leave balances to migrate');
            return;
        }

        const existingKapBalances = await leaveBalanceCollectionKAPP.countDocuments();
        console.log(` Found ${existingKapBalances} existing leave balances in KAP database`);

        for (const balance of leaveBalancesSD) {
            const userMapping = UserMap.get(balance.userId?.toString());
            if (!userMapping?.newId) {
                console.log(` Skipping balance - user mapping not found for userId: ${balance.userId}`);
                continue;
            }

            const existingBalance = await leaveBalanceCollectionKAPP.findOne({
                userId: userMapping.newId,
                leaveTypeId: balance.leaveTypeId,
                year: balance.year
            });

            if (existingBalance) {
                console.log(` Leave balance for user "${userMapping.email}" and type "${balance.leaveTypeId}" already exists in KAP - skipping`);
                MIGRATION_STATS.skippedRecords++;
                continue;
            }

            let balanceToInsert = mapReferencedIds(balance, 'user');
            balanceToInsert = mapReferencedIds(balanceToInsert, 'leaveType');
            
            delete balanceToInsert._id;

            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert balance for user "${userMapping.email}" and type "${balance.leaveTypeId}" (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await leaveBalanceCollectionKAPP.insertOne(balanceToInsert);
                console.log(` Inserted balance for user "${userMapping.email}" and type "${balance.leaveTypeId}" → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
    } catch (error) {
        console.error(' Error merging employee leave balances:', error);
    }
}

async function MergingLeaveApplications(kollegeapplyDb, sportsduniaDb) { 
    try {
        const leaveApplicationCollectionSD = sportsduniaDb.collection('leaveapplications');
        const leaveApplicationCollectionKAPP = kollegeapplyDb.collection('leaveapplications');

        const leaveApplicationsSD = await leaveApplicationCollectionSD.find({}).toArray();
        console.log(` Found ${leaveApplicationsSD.length} leave applications in SportsDunia database`);

        const existingKapApplications = await leaveApplicationCollectionKAPP.countDocuments();
        console.log(` Found ${existingKapApplications} existing leave applications in KAP database`);

        for (const application of leaveApplicationsSD) {
            const userMapping = UserMap.get(application.userId?.toString());
            if (!userMapping?.newId) {
                console.log(` Skipping application - user mapping not found for userId: ${application.userId}`);
                continue;
            }

            const existingApplication = await leaveApplicationCollectionKAPP.findOne({
                userId: userMapping.newId,
                leaveTypeId: application.leaveTypeId,
                fromDate: application.fromDate,
                toDate: application.toDate
            });

            if (existingApplication) {
                console.log(` Leave application for user "${userMapping.email}" already exists in KAP - skipping`);
                MIGRATION_STATS.skippedRecords++;
                continue;
            }

            let applicationToInsert = mapReferencedIds(application, 'user');
            applicationToInsert = mapReferencedIds(applicationToInsert, 'leaveType');
            
            delete applicationToInsert._id;

            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert application for user "${userMapping.email}" and type "${application.leaveTypeId}" (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await leaveApplicationCollectionKAPP.insertOne(applicationToInsert);
                console.log(` Inserted application for user "${userMapping.email}" and type "${application.leaveTypeId}" → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
    } catch (error) {
        console.error(' Error merging leave applications:', error);
    }
}


async function MergingEmployeeHistory(kollegeapplyDb, sportsduniaDb) {
    try {
        const employeeHistoryCollectionSD = sportsduniaDb.collection('employeehistories');
        const employeeHistoryCollectionKAPP = kollegeapplyDb.collection('employeehistories');

        const employeeHistorySD = await employeeHistoryCollectionSD.find({}).toArray();

        console.log(` Found ${employeeHistorySD.length} employee history records in SportsDunia database`);

        for(const history of employeeHistorySD) {
            const userMapping = UserMap.get(history.employeeId?.toString());
            if (!userMapping?.newId) {
                console.log(` Skipping history - user mapping not found for employeeId: ${history.employeeId}`);
                continue;
            }

            const existingHistory = await employeeHistoryCollectionKAPP.findOne({
                employeeId: userMapping.newId,
            });

            if (existingHistory) {
                console.log(` History for user "${userMapping.email}" already exists in KollegeApply`);
                continue;
            }

            const historyToInsert = mapReferencedIds(history, 'user');

            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert history for user "${userMapping.email}" (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await employeeHistoryCollectionKAPP.insertOne(historyToInsert);
                console.log(` Inserted history for user "${userMapping.email}" → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
        
        
    }catch (error) {
        console.error(' Error merging employee history:', error);
    }
}


async function MergingTickets(kollegeapplyDb, sportsduniaDb) {
    try {
        const employeeTicketCollectionSD = sportsduniaDb.collection('tickets');
        const employeeTicketCollectionKAPP = kollegeapplyDb.collection('tickets');

        const employeeTicketsSD = await employeeTicketCollectionSD.find({}).toArray();

        console.log(` Found ${employeeTicketsSD.length} employee ticket records in SportsDunia database`);

        for(const ticket of employeeTicketsSD) {
            const userMapping = UserMap.get(ticket.createdBy?.toString());
            if (!userMapping?.newId) {
                console.log(` Skipping ticket - user mapping not found for createdBy: ${ticket.createdBy}`);
                continue;
            }

            const existingTicket = await employeeTicketCollectionKAPP.findOne({
                ticketId: ticket.ticketId,
                createdBy: userMapping.newId,
            });

            if (existingTicket) {
                console.log(` Ticket "${ticket.ticketId}" for user "${userMapping.email}" already exists in KollegeApply`);
                continue;
            }

            const ticketToInsert = mapReferencedIds(ticket, 'user');

            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert ticket "${ticket.ticketId}" for user "${userMapping.email}" (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await employeeTicketCollectionKAPP.insertOne(ticketToInsert);
                console.log(` Inserted ticket "${ticket.ticketId}" for user "${userMapping.email}" → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
        
        
    }catch (error) {
        console.error(' Error merging ticket history:', error);
    }
}

async function MergingFeedback(kollegeapplyDb, sportsduniaDb) { 
    try {
        const feedbackCollectionSD = sportsduniaDb.collection('feedbacks');
        const feedbackCollectionKAPP = kollegeapplyDb.collection('feedbacks');

        const feedbacksSD = await feedbackCollectionSD.find({}).toArray();

        console.log(` Found ${feedbacksSD.length} feedback records in SportsDunia database`);

        for (const feedback of feedbacksSD) {
            const existingFeedback = await feedbackCollectionKAPP.findOne({
                givenBy: feedback.givenBy,
                givenTo: feedback.givenTo,
                from: feedback.from,
                to: feedback.to,
            });

            if (existingFeedback) {
                console.log(` Feedback already exists in KollegeApply`);
                continue;
            }

            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert feedback (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await feedbackCollectionKAPP.insertOne(feedback);
                console.log(` Inserted feedback → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
    } catch (error) {
        console.error(' Error merging feedback:', error);
    }
}

async function MergingAssests(kollegeapplyDb, sportsduniaDb) { 
    try {
        const assetsCollectionSD = sportsduniaDb.collection('assets');
        const assetsCollectionKAPP = kollegeapplyDb.collection('assets');

        const assetsSD = await assetsCollectionSD.find({}).toArray();

        console.log(` Found ${assetsSD.length} assets in SportsDunia database`);

        if (assetsSD.length === 0) {
            console.log(' No assets to migrate');
            return;
        }

        for (const asset of assetsSD) {
            const existingAsset = await assetsCollectionKAPP.findOne({ 
                assetName: asset.assetName,
                assignee: asset.assignee
            });
            
            if (existingAsset) {
                console.log(` Asset "${asset.assetName}" already exists in KollegeApply`);
                continue;
            }

            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert asset "${asset.assetName}" (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await assetsCollectionKAPP.insertOne(asset);
                console.log(` Inserted asset "${asset.assetName}" → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
        
    } catch (error) {
        console.error(' Error merging assets:', error);
    }
}

async function MergingAttendance(kollegeapplyDb, sportsduniaDb) { 
    try {
        const attendanceCollectionSD = sportsduniaDb.collection('attendances');
        const attendanceCollectionKAPP = kollegeapplyDb.collection('attendances');
        
        const attendanceSD = await attendanceCollectionSD.find({}).toArray();

        console.log(` Found ${attendanceSD.length} attendance records in SportsDunia database`);

        if (attendanceSD.length === 0) {
            console.log(' No attendance records to migrate');
            return;
        }

        for (const record of attendanceSD) {
            const userMapping = UserMap.get(record.user?.toString());
            if (!userMapping?.newId) {
                console.log(` Skipping attendance - user mapping not found for user: ${record.user}`);
                continue;
            }

            const existingRecord = await attendanceCollectionKAPP.findOne({
                user: userMapping.newId,
                date: record.date,
            });

            if (existingRecord) {
                console.log(` Attendance for user "${userMapping.email}" on "${record.date}" already exists in KollegeApply`);
                continue;
            }

            const recordToInsert = mapReferencedIds(record, 'user');

            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert attendance for user "${userMapping.email}" on "${record.date}" (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await attendanceCollectionKAPP.insertOne(recordToInsert);
                console.log(` Inserted attendance for user "${userMapping.email}" on "${record.date}" → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
    } catch (error) {
        console.error(' Error merging attendance:', error);
    }
}

async function MergingWFH(kollegeapplyDb, sportsduniaDb) { 
    try {
        const wfhCollectionSD = sportsduniaDb.collection('wfhs');
        const wfhCollectionKAPP = kollegeapplyDb.collection('wfhs');

        const wfhRecordsSD = await wfhCollectionSD.find({}).toArray();

        console.log(` Found ${wfhRecordsSD.length} WFH records in SportsDunia database`);

        if (wfhRecordsSD.length === 0) {
            console.log(' No WFH records to migrate');
            return;
        }

        for (const record of wfhRecordsSD) {
            const userMapping = UserMap.get(record.userId?.toString());
            if (!userMapping?.newId) {
                console.log(` Skipping WFH - user mapping not found for userId: ${record.userId}`);
                continue;
            }

            const existingRecord = await wfhCollectionKAPP.findOne({
                userId: userMapping.newId,
                date: record.date,
            });

            if (existingRecord) {
                console.log(` WFH for user "${userMapping.email}" on "${record.date}" already exists in KollegeApply`);
                continue;
            }

            const recordToInsert = mapReferencedIds(record, 'user');

            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert WFH for user "${userMapping.email}" on "${record.date}" (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await wfhCollectionKAPP.insertOne(recordToInsert);
                console.log(` Inserted WFH for user "${userMapping.email}" on "${record.date}" → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
    } catch (error) {
        console.error(' Error merging WFH records:', error);
    }
}

async function MergingHolidays(kollegeapplyDb, sportsduniaDb) { 
    try {
        const holidayCollectionSD = sportsduniaDb.collection('holidays');
        const holidayCollectionKAPP = kollegeapplyDb.collection('holidays');

        const holidaysSD = await holidayCollectionSD.find({}).toArray();

        console.log(` Found ${holidaysSD.length} holidays in SportsDunia database`);

        if (holidaysSD.length === 0) {
            console.log(' No holidays to migrate');
            return;
        }

        if (SAFETY_CONFIG.DRY_RUN) {
            const existingHolidaysCount = await holidayCollectionKAPP.countDocuments();
            console.log(` Would delete all ${existingHolidaysCount} existing holidays in KAP (DRY RUN)`);
        } else {
            const deleteResult = await holidayCollectionKAPP.deleteMany({});
            console.log(`🗑️ Deleted ${deleteResult.deletedCount} existing holidays from KAP`);
        }

        for (const holiday of holidaysSD) {
            if (SAFETY_CONFIG.DRY_RUN) {
                console.log(` Would insert holiday "${holiday.name}" on "${holiday.date}" (DRY RUN)`);
                MIGRATION_STATS.migratedRecords++;
            } else {
                const { insertedId } = await holidayCollectionKAPP.insertOne(holiday);
                console.log(` Inserted holiday "${holiday.name}" on "${holiday.date}" → _id: ${insertedId}`);
                MIGRATION_STATS.migratedRecords++;
            }
        }
    } catch (error) {
        console.error(' Error merging holidays:', error);
    }
}

async function changeContentDepartmentName(sportsduniaDb) {
  try {
    const departmentsCollection = sportsduniaDb.collection('departments');

    const contentDepartment = await departmentsCollection.findOne({ 
      name: { $regex: /^content$/i } 
    });

    if (!contentDepartment) {
      console.log(' Content department not found in SportsDunia');
      return;
    }

    console.log(` Found Content department: ${contentDepartment.name} (ID: ${contentDepartment._id})`);

    if (SAFETY_CONFIG.DRY_RUN) {
      console.log(` Would update Content department name from "${contentDepartment.name}" to "Content" (DRY RUN)`);
    } else {
      const updateResult = await departmentsCollection.updateOne(
        { _id: contentDepartment._id },
        { $set: { name: "Content" } }
      );

      if (updateResult.modifiedCount > 0) {
        console.log(` Updated Content department name from "${contentDepartment.name}" to "Content"`);
      } else {
        console.log(' No changes made to Content department name');
      }
    }
  } catch (error) {
    console.error(' Error changing Content department name:', error);
  }
}


async function main() {
    const sportsduniaClient = new MongoClient(SPORTSDUNIA_URI);
    const kollegeapplyClient = new MongoClient(KOLLEGEAPPLY_URI);

    try {
        console.log('🚀 Starting SD to KAP Migration Process...');
        console.log('=' .repeat(60));
        
        MIGRATION_STATS.startTime = new Date();
        
        await sportsduniaClient.connect();
        console.log(' Connected to SportsDunia database');

        await kollegeapplyClient.connect();
        console.log(' Connected to KollegeApply database');

        const sportsduniaDb = sportsduniaClient.db();
        const kollegeapplyDb = kollegeapplyClient.db();

        console.log('\n STEP 1: Pre-migration Validation');
        console.log('-'.repeat(40));
        
        const connectionValid = await validateDatabaseConnections(sportsduniaDb, kollegeapplyDb);
        if (!connectionValid) {
            throw new Error('Database connection validation failed');
        }

        const dataValid = await validateDataIntegrity(sportsduniaDb, kollegeapplyDb);
        if (!dataValid) {
            throw new Error('Data integrity validation failed');
        }

        const conflicts = await detectConflicts(sportsduniaDb, kollegeapplyDb);
        if (conflicts.length > 0) {
            console.log(' Conflicts detected. Migration will proceed but conflicts will be handled.');
        }

        console.log('\n STEP 2: Creating Backup');
        console.log('-'.repeat(40));
        
        const backupCreated = await createBackup(kollegeapplyDb);
        if (!backupCreated) {
            console.log(' Backup creation failed, but continuing with migration...');
        }

        if (SAFETY_CONFIG.DRY_RUN) {
            console.log('\n DRY RUN MODE - Simulating migration without making changes');
            console.log('-'.repeat(40));
            console.log('This is a test run. Set SAFETY_CONFIG.DRY_RUN = false to perform actual migration.');
        }

        console.log('\n STEP 4: Migration Execution');
        console.log('-'.repeat(40));
        
        await changeContentDepartmentName(sportsduniaDb);
        
        await createUserMapping(kollegeapplyDb, sportsduniaDb);
        
        const migrationSteps = [
            { name: 'Leave Policies', func: () => MergingLeavePolicies(kollegeapplyDb, sportsduniaDb) },
            { name: 'Leave Types', func: () => MergingLeaveTypes(kollegeapplyDb, sportsduniaDb) },
            { name: 'Departments', func: () => MergingDepartment(kollegeapplyDb, sportsduniaDb) },
            { name: 'User Team Assignment', func: () => UpdateUserTeams(kollegeapplyDb, sportsduniaDb) },
            { name: 'Users', func: () => MergingUser(kollegeapplyDb, sportsduniaDb) },
            { name: 'Fix Department Assignments', func: () => FixDepartmentAssignments(kollegeapplyDb, sportsduniaDb) },
            { name: 'Fix Team Assignments', func: () => FixTeamAssignments(kollegeapplyDb, sportsduniaDb) },
            { name: 'Employee Leave Balances', func: () => MergingEmployeeLeaveBalance(kollegeapplyDb, sportsduniaDb) },
            { name: 'Leave Applications', func: () => MergingLeaveApplications(kollegeapplyDb, sportsduniaDb) },
            { name: 'Employee History', func: () => MergingEmployeeHistory(kollegeapplyDb, sportsduniaDb) },
            { name: 'Tickets', func: () => MergingTickets(kollegeapplyDb, sportsduniaDb) },
            { name: 'Feedback', func: () => MergingFeedback(kollegeapplyDb, sportsduniaDb) },
            { name: 'Assets', func: () => MergingAssests(kollegeapplyDb, sportsduniaDb) },
            { name: 'Attendance', func: () => MergingAttendance(kollegeapplyDb, sportsduniaDb) },
            { name: 'WFH Records', func: () => MergingWFH(kollegeapplyDb, sportsduniaDb) },
            { name: 'Holidays', func: () => MergingHolidays(kollegeapplyDb, sportsduniaDb) }
        ];

        for (const step of migrationSteps) {
            try {
                console.log(`\n ${SAFETY_CONFIG.DRY_RUN ? 'Simulating' : 'Migrating'} ${step.name}...`);
                await step.func();
                console.log(` ${step.name} ${SAFETY_CONFIG.DRY_RUN ? 'simulation' : 'migration'} completed`);
            } catch (error) {
                console.error(` ${step.name} ${SAFETY_CONFIG.DRY_RUN ? 'simulation' : 'migration'} failed:`, error);
                MIGRATION_STATS.failedRecords++;
            }
        }

        console.log('\n STEP 5: Post-migration Validation');
        console.log('-'.repeat(40));
        
        const validationPassed = await validateMigrationResults(kollegeapplyDb, sportsduniaDb);
        if (!validationPassed) {
            console.log(' Migration validation failed. Please review the results.');
        }

        console.log('\n STEP 6: Migration Summary');
        console.log('-'.repeat(40));
        
        MIGRATION_STATS.endTime = new Date();
        const duration = MIGRATION_STATS.endTime - MIGRATION_STATS.startTime;
        
        console.log(`  Total Duration: ${Math.round(duration / 1000)} seconds`);
        console.log(` Total Records Processed: ${MIGRATION_STATS.totalRecords}`);
        console.log(` Successfully Migrated: ${MIGRATION_STATS.migratedRecords}`);
        console.log(`  Skipped (Already Exists): ${MIGRATION_STATS.skippedRecords}`);
        console.log(` Failed: ${MIGRATION_STATS.failedRecords}`);
        
        console.log('\n Mapping Summary:');
        console.log(`  - Leave Policies: ${LeavePolicyMap.size}`);
        console.log(`  - Leave Types: ${LeaveTypeMap.size}`);
        console.log(`  - Departments: ${DepartmentMap.size}`);
        console.log(`  - Users: ${UserMap.size}`);

        if (SAFETY_CONFIG.DRY_RUN) {
            console.log('\n DRY RUN SUMMARY');
            console.log('-'.repeat(40));
            console.log('This was a simulation. No actual changes were made to the database.');
            console.log('To perform the actual migration, set SAFETY_CONFIG.DRY_RUN = false');
        } else if (validationPassed && MIGRATION_STATS.failedRecords === 0) {
            console.log('\n Migration completed successfully!');
        } else {
            console.log('\n Migration completed with warnings. Please review the results.');
        }
        
    } catch (error) {
        console.error('\n CRITICAL ERROR in migration:', error);
        console.error('Please check the backup and review the error before retrying.');
        process.exit(1);
    } finally {
        try {
            await sportsduniaClient.close();
            await kollegeapplyClient.close();
            console.log('\n Database connections closed');
        } catch (error) {
            console.error('Error closing connections:', error);
        }
    }
}

main();
