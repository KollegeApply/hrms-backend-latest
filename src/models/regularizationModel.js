const mongoose = require('mongoose');
const { Schema } = mongoose;

const regularizationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    correctedCheckIn: {
      type: String, // Format: "HH:MM" (24-hour format)
      required: true,
    },
    correctedCheckOut: {
      type: String, // Format: "HH:MM" (24-hour format)
      required: true,
    },
    reason: {
      type: String,
      required: true,
      maxlength: 500,
    },
    type: {
      type: String,
      enum: ['standard', 'emergency'],
      default: 'standard',
    },
    evidence: {
      type: String, // File URL for emergency cases
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
    },
    totalHours: {
      type: Number, // in minutes
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
regularizationSchema.index({ user: 1, date: 1 });
regularizationSchema.index({ status: 1 });
regularizationSchema.index({ createdAt: -1 });

// Pre-save middleware to calculate total hours
regularizationSchema.pre('save', function(next) {
  if (this.correctedCheckIn && this.correctedCheckOut) {
    const [checkInHour, checkInMin] = this.correctedCheckIn.split(':').map(Number);
    const [checkOutHour, checkOutMin] = this.correctedCheckOut.split(':').map(Number);
    
    const checkInMinutes = checkInHour * 60 + checkInMin;
    const checkOutMinutes = checkOutHour * 60 + checkOutMin;
    
    this.totalHours = checkOutMinutes - checkInMinutes;
  }
  next();
});

// Virtual for formatted total hours
regularizationSchema.virtual('formattedTotalHours').get(function() {
  if (!this.totalHours) return '0:00';
  
  const hours = Math.floor(this.totalHours / 60);
  const minutes = this.totalHours % 60;
  return `${hours}:${minutes.toString().padStart(2, '0')}`;
});

// Method to get status display name
regularizationSchema.methods.getStatusDisplayName = function() {
  const statusMap = {
    'pending': 'Pending Approval',
    'approved': 'Approved',
    'rejected': 'Rejected'
  };
  return statusMap[this.status] || this.status;
};

// Method to check if request can be approved by given role
regularizationSchema.methods.canBeApprovedBy = function(role) {
  if (role === 'admin' || role === 'hr' || role === 'teamlead') {
    return this.status === 'pending';
  }
  return false;
};

// Method to check if request can be rejected by given role
regularizationSchema.methods.canBeRejectedBy = function(role) {
  if (role === 'admin' || role === 'hr' || role === 'teamlead') {
    return this.status === 'pending';
  }
  return false;
};

// Static method to get pending approvals for a role
regularizationSchema.statics.getPendingApprovals = function(role, approverId) {
  if (role === 'admin' || role === 'hr' || role === 'teamlead') {
    return this.find({ 
      status: 'pending',
      isDeleted: false 
    }).populate('user', 'name email department');
  }
  
  return [];
};

// Static method to get regularization history for a user
regularizationSchema.statics.getUserHistory = function(userId, filters = {}) {
  const query = {
    user: userId,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .populate('approvedBy', 'name email');
};

// Static method to get statistics
regularizationSchema.statics.getStatistics = function(userId, startDate, endDate) {
  const matchStage = {
    user: mongoose.Types.ObjectId(userId),
    isDeleted: false,
    createdAt: {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    }
  };
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalHours: { $sum: '$totalHours' }
      }
    }
  ]);
};

const Regularization = mongoose.model('Regularization', regularizationSchema);

module.exports = Regularization;
