// const mongoose = require("mongoose");

// // 🔹 Toggle this flag: true = test only, false = actually migrate
// const DRY_RUN = true;

// // Connections for both DBs
// const db1 = mongoose.createConnection("mongodb://localhost:27017/db1");
// const db2 = mongoose.createConnection("mongodb://localhost:27017/db2");

// // Define schema (same for both DBs)
// const attendanceSchema = new mongoose.Schema({
//   checkInLocation: {
//     latitude: Number,
//     longitude: Number,
//   },
//   user: Object,
//   checkInTime: Date,
//   status: String,
//   checkInMode: String,
//   date: Date,
// }, { timestamps: true });

// // Models
// const AttendanceDB1 = db1.model("Attendance", attendanceSchema);
// const AttendanceDB2 = db2.model("Attendance", attendanceSchema);

// async function migrateData() {
//   try {
//     // Define the date range for createdAt = 2025-08-16 (full day UTC)
//     const start = new Date("2025-08-16T00:00:00.000Z");
//     const end = new Date("2025-08-16T23:59:59.999Z");

//     // Fetch records from db2 where createdAt falls on 2025-08-16
//     const records = await AttendanceDB2.find({
//       createdAt: { $gte: start, $lte: end }
//     });

//     if (records.length === 0) {
//       console.log("No records found for given createdAt range.");
//       return;
//     }

//     // Normalize date for db1 format
//     const normalizedRecords = records.map(r => {
//       const obj = r.toObject();
//       obj.date = new Date("2025-08-16T00:00:00.000Z"); // force to db1 style
//       return obj;
//     });

//     if (DRY_RUN) {
//       console.log(`🚀 DRY RUN MODE: Found ${normalizedRecords.length} records`);
//       console.log("Sample record to insert:", normalizedRecords[0]); // show 1st as sample
//       console.log("✅ No data inserted into db1 (test mode only).");
//     } else {
//       // Insert into db1
//       await AttendanceDB1.insertMany(normalizedRecords);
//       console.log(`${normalizedRecords.length} records migrated successfully with normalized date format!`);
//     }
//   } catch (error) {
//     console.error("Migration failed:", error);
//   } finally {
//     await db1.close();
//     await db2.close();
//   }
// }

// migrateData();

// ===============================
// CONFIGURATION
// ===============================
const DRY_RUN = true; // set to false to actually migrate
const EXCLUDE_USER_ID = "681375076d17108b28a7b15f";

// ===============================
// DATE SETUP
// ===============================
const today = new Date();
today.setHours(0, 0, 0, 0);
const tomorrow = new Date(today);
tomorrow.setDate(today.getDate() + 1);

print(`📅 Migrating documents updated between ${today.toISOString()} and ${tomorrow.toISOString()}`);
if (DRY_RUN) print("🛑 DRY RUN MODE: No changes will be made");

// ===============================
// 1️⃣ Migrate approved leave applications
// ===============================
const leaveApps = db.leaveapplications.find({
  status: {$in: ["approved", "pending"]},
  updatedAt: { $gte: today, $lt: tomorrow }
}).toArray();

if (leaveApps.length === 0) {
  print("❌ No leave applications to migrate today");
} else {
  print(`📄 Found ${leaveApps.length} approved leave application(s) to migrate`);
  leaveApps.forEach(app => print(` - userId: ${app.userId}, leaveId: ${app._id}`));
  
  if (!DRY_RUN) {
    db.leaveapplications_migration.insertMany(leaveApps);
    print("✅ Leave applications migrated successfully");
  } else {
    print("📝 DRY RUN: Leave applications NOT migrated");
  }
}

// ===============================
// 2️⃣ Migrate attendances except specific userId
// ===============================
const attendances = db.attendances.find({
  updatedAt: { $gte: today, $lt: tomorrow },
  userId: { $ne: EXCLUDE_USER_ID }
}).toArray();

if (attendances.length === 0) {
  print(`❌ No attendances to migrate today (after excluding userId ${EXCLUDE_USER_ID})`);
} else {
  print(`📄 Found ${attendances.length} attendance document(s) to migrate`);
  attendances.forEach(att => print(` - userId: ${att.userId}, attendanceId: ${att._id}`));
  
  if (!DRY_RUN) {
    db.attendances_migration.insertMany(attendances);
    print("✅ Attendance documents migrated successfully");
  } else {
    print("📝 DRY RUN: Attendance documents NOT migrated");
  }
}

print("🏁 Migration script finished");
