const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  givenBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  givenTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  from: {
    type: Date,
    required: false, // Optional - can be derived from periodId
  },
  to: {
    type: Date,
    required: false, // Optional - can be derived from periodId
  },
  periodId: {
    type: String,
    required: false, // Optional for backward compatibility
    index: true
  },
  periodType: {
    type: String,
    enum: ['monthly', 'biweekly'],
    required: false // Optional for backward compatibility
  },
  feedback: {
    type: String,
    required: true
  },
  rating: {
    type: Object,
    required: true,
    default: {}
  },
  // Keep legacy fields for backward compatibility
  legacyRating: {
    discipline: { type: Number },
    initiative: { type: Number },
    teamwork: { type: Number },
    ownership: { type: Number },
    skillDevelopment: { type: Number },
    techSkills: { type: Number },
    overall: { type: Number },
  },
  // Reference to the KPI record used (contains all KPI definitions)
  kpiRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KPI',
    required: false
  },
  // Reference to employee-specific KPI override (if used)
  employeeKpiOverrideId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EmployeeKpiOverride',
    required: false
  },
  // Department reference (for better querying)
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: false
  },

  // 🔹 AI-enhanced fields
  sentiment: {
    type: String,
    enum: ['Positive', 'Neutral', 'Negative'],
    default: 'Neutral'
  },
  sentimentScore: {
    type: Number, // numeric score from AI (-1 to 1 or 0–100)
    default: 0
  },
  keywords: {
    type: [String], // extracted themes like "leadership", "deadlines"
    default: []
  },
  aiRecommendation: {
    type: String, // actionable insight (e.g., "Provide time management training")
    default: ''
  },

  isDeleted: {
    type: Boolean,
    default: false
  },
  editRequest: {
    requested: { type: Boolean, default: false },
    approved: { type: Boolean, default: false },
    rejected: { type: Boolean, default: false },
    completed: { type: Boolean, default: false },
  },
  // Approval workflow for STL feedback
  approvalStatus: {
    type: String,
    enum: ['pending_tl_approval', 'approved', 'rejected', 'direct'], // direct = no approval needed
    default: 'direct'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  approvalComments: {
    type: String,
    required: false
  },
  // Store original feedback before TL edits (for STL → Employee feedback)
  originalFeedback: {
    type: String,
    required: false
  },
  originalRating: {
    type: Object,
    required: false,
    default: {}
  },
  editedByTL: {
    type: Boolean,
    default: false
  },
  concernRaised: {
    type: Boolean,
  },
  concernReason: {
    type: String,
  }
}, { timestamps: true });

// Method to get period dates from periodId
feedbackSchema.methods.getPeriodDates = function() {
  if (this.periodId) {
    const { getPeriodById } = require('../utility/periodUtils');
    const period = getPeriodById(this.periodId);
    if (period) {
      return {
        from: period.from,
        to: period.to
      };
    }
  }
  
  // Fallback to stored from/to dates
  return {
    from: this.from,
    to: this.to
  };
};

// Virtual field to get effective from date
feedbackSchema.virtual('effectiveFrom').get(function() {
  if (this.periodId) {
    const { getPeriodById } = require('../utility/periodUtils');
    const period = getPeriodById(this.periodId);
    return period ? period.from : this.from;
  }
  return this.from;
});

// Virtual field to get effective to date
feedbackSchema.virtual('effectiveTo').get(function() {
  if (this.periodId) {
    const { getPeriodById } = require('../utility/periodUtils');
    const period = getPeriodById(this.periodId);
    return period ? period.to : this.to;
  }
  return this.to;
});

// Ensure virtual fields are serialized
feedbackSchema.set('toJSON', { virtuals: true });
feedbackSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Feedbacks', feedbackSchema);
