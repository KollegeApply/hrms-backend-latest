const mongoose = require('mongoose');

const employeeKpiOverrideSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: false
  },
  kpis: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    maxRating: {
      type: Number,
      default: 5,
      min: 1,
      max: 10
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

employeeKpiOverrideSchema.index(
  { employeeId: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false }
  }
);

module.exports = mongoose.model('EmployeeKpiOverride', employeeKpiOverrideSchema);
