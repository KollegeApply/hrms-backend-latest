const mongoose = require('mongoose');
const { Schema } = mongoose;
const {
  VALID_USER_ROLES,
  VALID_EMPLOYEE_STATUS,
  USER_ROLES,
  EMPLOYEE_STATUS,
} = require('../utility/constants');

const userSchema = new Schema(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/\S+@\S+\.\S+/, 'Please use a valid email address.'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      select: false, // Do not return password by default
    },
    employeeId: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple null values but unique if value exists
      trim: true,
    },
    jobTitle: {
      type: String,
      trim: true,
    },
    department: {
      // type: String,
      type: mongoose.Schema.Types.ObjectId,
      trim: true,
      ref: 'Department',
    },
    hireDate: {
      type: Date,
    },
    phoneNumber: {
      type: String,
      trim: true,
    },
    teamLeadId: {
      type: mongoose.Schema.Types.ObjectId,
      // required: true,
      ref: 'User',
    },
    subTeamLeadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    hrPocId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    address: {
      // Optional: More detailed address structure can be added
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },
    workType: {
      type: String,
      enum: ['WFH', 'WFO'],
      required: true,
    },
    role: {
      type: String,
      enum: {
        values: VALID_USER_ROLES,
        message: 'Invalid user role: {VALUE}',
      },
      default: USER_ROLES.EMPLOYEE,
      required: true,
    },
    status: {
      type: String,
      enum: {
        values: VALID_EMPLOYEE_STATUS,
        message: 'Invalid employee status: {VALUE}',
      },
      default: EMPLOYEE_STATUS.PROBATION,
      required: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      // select: false, // Hide by default unless explicitly queried
    },
    workingDays: {
      type: Number,
      default: 6,
    },
    leavePolicyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LeavePolicy',
    },
    dateOfBirth: {
      type: Date,
      required: false,
    },
    // Add other relevant HRMS fields as needed:
    // reportingManager: { type: Schema.Types.ObjectId, ref: 'User' },
    // emergencyContact: { name: String, phone: String, relationship: String },
    passwordResetOtp: {
      type: String,
      required: false,
      select: false, // Don't return OTP by default
    },
    passwordResetOtpExpires: {
      type: Date,
      required: false,
      select: false, // Don't return expiry by default
    },
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Candidate',
      required: false,
    },
    teamName:{
      type: String,
      required: true
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// Indexes for better query performance
// userSchema.index({ email: 1 });
// userSchema.index({ employeeId: 1 });
userSchema.index({ firstName: 'text', lastName: 'text', email: 'text' }); // For text search

// Method to exclude password when converting to JSON
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString(); // Map _id to id
    delete ret._id;
    delete ret.__v;
    delete ret.password; // Ensure password is never sent
    delete ret.isDeleted; // Usually don't send this either
    return ret;
  },
});

// Method to exclude password when converting to a plain object
userSchema.set('toObject', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.password;
    delete ret.isDeleted;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

module.exports = User;
