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
  from : {
    type: Date,
    required : true,
  },
  to : {
    type: Date,
    required : true,
  },
  feedback: {
    type: String,
    required: true
  },
  rating: {
    discipline : {
        type : Number,
        required : true,
    },
    initiative : {
        type : Number,
        required : true,
    },
    teamwork : {
        type : Number,
        required : true,
    },
    ownership : {
        type : Number,
        required : true,
    },
    skillDevelopment : {
        type : Number,
        required : true,
    },
    techSkills : {
        type : Number,
    },
    overall : {
        type : Number,
        required : true,
    },
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
  concernRaised : {
    type: Boolean,
  },
  concernReason : {
    type: String,
  }
}, { timestamps: true });

module.exports = mongoose.model('Feedbacks', feedbackSchema);
