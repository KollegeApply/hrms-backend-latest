const mongoose = require('mongoose');

const kpiSchema = new mongoose.Schema({
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true // Now required - only use ObjectId
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

// Create unique index on departmentId where isDeleted is false
kpiSchema.index(
  { departmentId: 1 }, 
  { 
    unique: true, 
    partialFilterExpression: { isDeleted: false } 
  }
);

module.exports = mongoose.model('KPI', kpiSchema);

