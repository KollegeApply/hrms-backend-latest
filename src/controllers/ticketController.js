const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const TicketService = require('../services/ticketService');
const ticketValidator = require('../validators/ticketValidator');
const logger = require('../config/logger');
const User = require('../models/userModel');
const { HR_EMAIL, IT_EMAIL, getTeamEmailConfig } = require('../utility/constants');
const Helper = require('../utility/helper');
const { uploadToAzure } = require('../utility/azureBlob');
const { transformDocumentPaths } = require('../utility/common');

const createTicket = catchAsync(async (req, res) => {
  const createdBy = req?.user?.id;
  const team = req?.user?.team;
  const { ticketData } = req.body;
  // Parse ticketData when sent as multipart/form-data (it will be a JSON string)
  let parsedTicketData = ticketData;
  if (typeof ticketData === 'string') {
    try {
      parsedTicketData = JSON.parse(ticketData);
    } catch (e) {
      return res.status(httpStatus.BAD_REQUEST).json({
        status: false,
        message: 'Invalid payload for ticketData',
      });
    }
  }
  parsedTicketData = parsedTicketData || {};
  
  // Handle image upload if present
  let imageUrl = null;
  if (req.file) {
    try {
      imageUrl = await uploadToAzure(req.file.buffer, req.file.originalname, 'hrms-tickets/');
      logger.info(`Image uploaded successfully for ticket: ${imageUrl}`);
    } catch (error) {
      logger.error('Failed to upload image:', error);
      return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: 'Failed to upload image. Please try again.',
      });
    }
  }
  
  const validatedData = await ticketValidator.createTicketSchema.validateAsync({ 
    ...parsedTicketData, 
    createdBy,
    imageUrl 
  });
  const newTicket = await TicketService.createTicket(validatedData);
  
  // Transform image URL to full URL if present
  if (newTicket.imageUrl) {
    const transformedPaths = transformDocumentPaths({ imageUrl: newTicket.imageUrl });
    newTicket.imageUrl = transformedPaths.imageUrl;
  }

  const sendMail = req?.body?.sendMail;

  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const createdByUser = await User.findById(createdBy);
    const configEmails = getTeamEmailConfig(team);
    const teamEmails = [configEmails?.HR_EMAIL];
    const ccEmails = [createdByUser?.email];

    if (newTicket.ticketType === "Admin & IT") {
      teamEmails.push(configEmails?.IT_EMAIL);
    } else if (newTicket.ticketType === "HRMS Query") {
      // HRMS Query tickets are handled by HR team
      teamEmails.push(configEmails?.HRMS_QUERY_EMAIL);
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
      cc:ccEmails,
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
  
  // Transform image URLs to full URLs if present
  if (result.tickets && Array.isArray(result.tickets)) {
    result.tickets = result.tickets.map(ticket => {
      if (ticket.imageUrl) {
        const transformedPaths = transformDocumentPaths({ imageUrl: ticket.imageUrl });
        ticket.imageUrl = transformedPaths.imageUrl;
      }
      return ticket;
    });
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Tickets fetched successfully.',
    data: result,
  });
});

const getTicketById = catchAsync(async (req, res) => {
  const {id} = req.params;
  const result = await TicketService.getTicketById(id);
  
  // Transform image URL to full URL if present
  if (result.imageUrl) {
    const transformedPaths = transformDocumentPaths({ imageUrl: result.imageUrl });
    result.imageUrl = transformedPaths.imageUrl;
  }

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
        validatedData?.actionReason || updatedTicket?.actionReason || ''
      );

      let ccEmails = [configEmails?.HR_EMAIL];
      let fromIT;

      if(updatedTicket?.ticketType === "Admin & IT"){
        ccEmails = [req?.user?.email];
        fromIT = true;
      } else if(updatedTicket?.ticketType === "HRMS Query"){
        // HRMS Query tickets are handled by HR team
        ccEmails = [configEmails?.HR_EMAIL, configEmails?.HRMS_QUERY_EMAIL];
        fromIT = false;
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
