const mongoose = require('mongoose');
const { VALID_CANDIDATE_STATUS, CANDIDATE_STATUS } = require('../utility/constants');
const { Schema } = mongoose;

const CandidateSchema = new Schema({
  pointOfContact: { type: Schema.Types.ObjectId, ref: 'User' },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  personalEmail: { type: String, required: true },
  phoneNumber: { type: String },
  employeeStatus: { type: String },
  designation: { type: String },
  department: { type: Schema.Types.ObjectId, ref: 'Department' },
  reportingLocation: { type: String },
  status: {
    type: String,
    enum: {
      values: VALID_CANDIDATE_STATUS,
      message: 'Invalid candidate status: {VALUE}',
    },
    default: CANDIDATE_STATUS.PENDING,
  },
  requestsSent: {
    byod: { type: Boolean, default: false },
    byov: { type: Boolean, default: false }
  },
  isDeleted: { type: Boolean, default: false },
  userDetails: { type: Schema.Types.ObjectId, ref: 'UserDetails' }
}, { timestamps: true });

module.exports = mongoose.model('Candidates', CandidateSchema);
