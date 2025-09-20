const User = require('../models/userModel');
const logger = require('../config/logger');
const Helper = require('../utility/helper');
const Ticket = require('../models/ticketModel');
const httpStatus = require('http-status');
const ApiError = require('../utility/ApiError');
const { default: mongoose } = require('mongoose');

class TicketService {
  async createTicket(ticketData) {
    const ticketId = await this.generateUniqueTicketId();

    const newTicket = await Ticket.create({
      ...ticketData,
      ticketId,
    });

    return newTicket;
  }


  async generateUniqueTicketId(length = 5) {
    const generateId = () => {
      const remainingLength = length - 1;
      const randomPart = Math.floor(Math.random() * Math.pow(10, remainingLength))
        .toString()
        .padStart(remainingLength, '0');
      return '1' + randomPart;
    };

    let ticketId = generateId();

    const exists = await Ticket.exists({ ticketId });

    if (exists) {
      ticketId = generateId();

      const secondCheck = await Ticket.exists({ ticketId });
      if (secondCheck) {
        throw new Error('Failed to generate unique ticket ID. Try again.');
      }
    }

    return ticketId;
  }

async getAllTickets(currentUser, query = {}, team) {
  const { status, search } = query;
  const allowedRoles = ['admin', 'hr', 'subadmin'];

  const matchStage = {};

  if (!allowedRoles.includes(currentUser.role)) {
    if (currentUser.role === "IT") {
      matchStage['$or'] = [
        { ticketType: "Admin & IT" },
        { createdBy: new mongoose.Types.ObjectId(currentUser.id) }
      ];
    } else {
      matchStage['createdBy'] = new mongoose.Types.ObjectId(currentUser.id);
    }
  }

  if (status) {
    matchStage.status = status;
  }

  const searchStage = search
    ? {
        $or: [
          { ticketId: { $regex: search, $options: 'i' } },
          { ticketType: { $regex: search, $options: 'i' } },
          { subject: { $regex: search, $options: 'i' } },
          { 'createdByData.firstName': { $regex: search, $options: 'i' } },
          { 'createdByData.lastName': { $regex: search, $options: 'i' } },
          { 'createdByData.employeeId': { $regex: search, $options: 'i' } }
        ]
      }
    : {};

  const tickets = await Ticket.aggregate([
    { $match: matchStage },

    {
      $lookup: {
        from: 'users',
        localField: 'createdBy',
        foreignField: '_id',
        as: 'createdByData'
      }
    },
    { $unwind: '$createdByData' },

    { $match: { 'createdByData.team': team } },

    {
      $lookup: {
        from: 'users',
        localField: 'resolvedBy',
        foreignField: '_id',
        as: 'resolvedByData'
      }
    },
    { $unwind: { path: '$resolvedByData', preserveNullAndEmptyArrays: true } },

    ...(search ? [{ $match: searchStage }] : []),

    { $sort: { createdAt: -1 } }
  ]);

  return tickets;
}




  async getTicketById(id) {
    const ticket = await Ticket.findById(id).populate([
      {
        path: "createdBy",
        populate: "firstName lastName email employeeId"
      },
      {
        path: "resolvedBy",
        populate: "firstName lastName email employeeId"
      }
    ]).sort({ createdAt: -1 });

    if (!ticket) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'Ticket not found.'
      );
    }
    return ticket;
  };

  async updateTicket(id, updatedData, currentUser) {
    const allowedStatuses = ['resolved', 'rejected', 'in_progress'];

    const { status, actionReason } = updatedData;

    if (!allowedStatuses.includes(status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid status update");
    }

    const updateFields = {
      status,
    };

    if (status === 'resolved' || status === 'rejected') {
      updateFields.resolvedBy = currentUser?.id;
      updateFields.resolvedAt = new Date();
      if (actionReason) {
        updateFields.actionReason = actionReason;
      }
    }

    const updatedTicket = await Ticket.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true }
    );

    if (!updatedTicket) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Ticket not updated");
    }

    return updatedTicket;
  }

}

module.exports = new TicketService();