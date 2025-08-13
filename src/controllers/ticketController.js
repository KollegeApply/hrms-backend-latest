const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const TicketService = require('../services/ticketService');
const ticketValidator = require('../validators/ticketValidator');
const logger = require('../config/logger');
const User = require('../models/userModel');
const { HR_EMAIL, IT_EMAIL, getTeamEmailConfig } = require('../utility/constants');
const Helper = require('../utility/helper');

const createTicket = catchAsync(async (req, res) => {
  const createdBy = req?.user?.id;
  const team = req?.user?.team;
  const { ticketData } = req.body;
  const validatedData = await ticketValidator.createTicketSchema.validateAsync({ ...ticketData, createdBy });
  const newTicket = await TicketService.createTicket(validatedData);

  const sendMail = req?.body?.sendMail;

  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const createdByUser = await User.findById(createdBy);
    const configEmails = getTeamEmailConfig(team);
    const teamEmails = [configEmails?.HR_EMAIL];

    if (newTicket.ticketType === "Admin & IT") {
      teamEmails.push(configEmails?.IT_EMAIL);
    }

    const emailSubject = `New Ticket Raised - ${newTicket.subject}`;
    const emailMessage = Helper.getTicketCreatedEmailForTeam(
      newTicket.subject,
      newTicket.ticketType,
      createdByUser.firstName,
      process.env.HRMS_FRONTEND_URL,
      newTicket.ticketId,
      team,
    );

    Helper.sendEmail({
      receiverEmails: teamEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: false,
      fromIT: false,
      team,
    }).catch((err) => {
      logger.error(`Failed to send ticket creation email:`, err);
    });
  }

  res.status(httpStatus.CREATED).json({
    status: true,
    message: 'Ticket raised successfully.',
    data: newTicket,
  });
});


const getAllTickets = catchAsync(async (req, res) => {
  const user  = req.user;
  const query = req.query;
  const team = req.user.team;
  const result = await TicketService.getAllTickets(user,query,team);

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Tickets fetched successfully.',
    data: result,
  });
});

const getTicketById = catchAsync(async (req, res) => {
  const {id} = req.params;
  const result = await TicketService.getTicketById(id);

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Tickets fetched successfully.',
    data: result,
  });
});

const updateTicket = catchAsync(async (req, res) => {
  const { id } = req.params;
  const {updateData} = req?.body;
  const team = req.user.team;
  const validatedData = await ticketValidator.updateTicketSchema.validateAsync(updateData);
  const updatedTicket = await TicketService.updateTicket(id, validatedData, req.user);

  const sendMail = req?.body?.sendMail;

  if (
    sendMail &&
    process.env.HRMS_FRONTEND_URL &&
    ["rejected", "resolved"].includes(validatedData.status)
  ) {
    const employee = await User.findById(updatedTicket?.createdBy);
    const configEmails = getTeamEmailConfig(team);

    if (employee?.email) {
      const emailSubject = `Your Ticket has been ${validatedData.status}`;
      const emailMessage = Helper.getTicketStatusUpdateEmail(
        employee.firstName,
        updatedTicket.subject,
        validatedData.status,
        process.env.HRMS_FRONTEND_URL,
        updatedTicket.ticketId,
        team,
      );

      let ccEmails = [configEmails?.HR_EMAIL];
      let fromIT;

      if(updatedTicket?.ticketType === "Admin & IT"){
        ccEmails = [req?.user?.email];
        fromIT = true;
      }
      
      Helper.sendEmail({
        receiverEmails: [employee.email],
        subject: emailSubject,
        message: emailMessage,
        fromHR: !fromIT,
        fromIT: fromIT,
        cc: ccEmails,
        team,
      }).catch((err) => {
        logger.error(`Failed to send ticket update email:`, err);
      });
    }
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Ticket updated successfully.',
    data: updatedTicket,
  });
});



module.exports = {
  createTicket,
  getAllTickets,
  getTicketById,
  updateTicket,
};
