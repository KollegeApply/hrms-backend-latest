const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    unique: true,
    required: true,
  },
  ticketType: {
    type: String,
    enum: ["Payroll and Salary query","HR & Grievance query","Expenses & Reimbursements","Admin & IT","Backdated attendance","Miscellaneous"],
    required: true,
  },
  subject: {
    type: String,
    required: true,
  },
  issue: {
    type: String,
    required: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'resolved', 'rejected'],
    default: 'pending',
  },
  resolvedAt: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
},{timestamps:true});


const Tickets = mongoose.model('Tickets', ticketSchema);

module.exports = Tickets;