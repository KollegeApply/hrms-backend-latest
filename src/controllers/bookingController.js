const httpStatus = require('http-status-codes');
const bookingService = require('../services/bookingService');
const validator = require('../validators/bookingValidator');
const ApiError = require('../utility/ApiError');
const catchAsync = require('../utility/catchAsync');
const Helper = require('../utility/helper');
const logger = require('../config/logger');
const { getTeamEmailConfig } = require('../utility/constants');
const moment = require('moment-timezone');

const listRooms = catchAsync(async (req, res) => {
  const rooms = await bookingService.listRooms();
  res.status(httpStatus.OK).json({ status: true, data: rooms });
});

const getBookings = catchAsync(async (req, res) => {
  const query = await validator.getBookingsQuerySchema.validateAsync(req.query);
  const bookings = await bookingService.getBookings({
    ...query,
    userId: req.user.id
  });
  res.status(httpStatus.OK).json({ status: true, data: bookings });
});

const createBooking = catchAsync(async (req, res) => {
  const body = await validator.createBookingSchema.validateAsync(req.body);
  const created = await bookingService.createBooking({
    userId: req.user.id,
    ...body,
  });
  res.status(httpStatus.StatusCodes.CREATED).json({
    status: true,
    message: 'Booking created successfully',
    data: created,
  });

  // Fire-and-forget email notification: attendees in To, organizer in CC
  try {
    const attendeeEmails = (created?.attendees || []).map(a => a?.email).filter(Boolean);
    const organizerEmail = created?.userId?.email;
    const team = req?.user?.team;
    // Derive safe display names to avoid undefined in email template
    const organizerName = [created?.userId?.firstName, created?.userId?.lastName]
      .filter(Boolean)
      .join(' ') || created?.userId?.email || 'Organizer';

    if (attendeeEmails?.length && team) {
      const subject = `✅ Your booking has been confirmed – ${created?.title}`;
      const displayTeam = getTeamEmailConfig(team);
      const message = `
        <div style="font-family: Arial, sans-serif; max-width: 550px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; background-color: #f9f9f9; color: #333;">
          
          <!-- Greeting -->
          <p style="font-size: 15px; margin: 0 0 12px 0;">Hello Team,</p>
      
          <!-- Intro -->
          <p style="font-size: 14px; margin: 0 0 16px 0;">
            Your booking for <strong>${created?.roomId?.name}</strong> has been successfully confirmed.  
            Please find the details below:
          </p>
      
          <!-- Meeting Details -->
          <div style="padding: 14px; background: #fff; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 16px;">
            <p style="margin: 6px 0; font-size: 14px;">
              <strong>● Title:</strong> ${created?.title}
            </p>
            <p style="margin: 6px 0; font-size: 14px;">
              <strong>● Date & Time:</strong> ${moment(created?.startTime).tz('Asia/Kolkata').format('DD MMM YYYY')} , 
              ${moment(created?.startTime).tz('Asia/Kolkata').format('hh:mm A')} - 
              ${moment(created?.endTime).tz('Asia/Kolkata').format('hh:mm A')}
            </p>
            <p style="margin: 6px 0; font-size: 14px;">
              <strong>● Location:</strong> ${created?.roomId?.name}
            </p>
            <p style="margin: 6px 0; font-size: 14px;">
              <strong>● Booked By:</strong> ${organizerName}
            </p>
          </div>
      
          <!-- Closing -->
          <p style="font-size: 14px; margin: 0 0 12px 0;">
            If you need to make changes, you can edit or cancel the booking from your HRMS portal.
          </p>
          
          <p style="font-size: 14px; margin: 0;">
            Best Regards,<br/>
            <strong>${displayTeam?.TEAM_NAME || 'Company'}</strong>
          </p>
        </div>
      `;

      Helper.sendEmail({
        receiverEmails: attendeeEmails,
        subject,
        message,
        cc: organizerEmail ? [organizerEmail] : [],
        team,
      }).catch(err => logger.error('Failed to send meeting booking email:', err?.message || err));
    } else if (organizerEmail && team) {
      // No attendees: notify organizer directly
      const subject = `✅ Your booking has been confirmed – ${created?.title}`;
      const displayTeam = getTeamEmailConfig(team);
      const message = `
        <div style="font-family: Arial, sans-serif; max-width: 550px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; background-color: #f9f9f9; color: #333;">
          <!-- Greeting -->
          <p style="font-size: 15px; margin: 0 0 12px 0;">Hello ${organizerName},</p>

          <!-- Intro -->
          <p style="font-size: 14px; margin: 0 0 16px 0;">
            Your booking for <strong>${created?.roomId?.name}</strong> has been successfully confirmed.  
            Please find the details below:
          </p>

          <!-- Meeting Details -->
          <div style="padding: 14px; background: #fff; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 16px;">
            <p style="margin: 6px 0; font-size: 14px;"><strong>● Title:</strong> ${created?.title}</p>
            <p style="margin: 6px 0; font-size: 14px;"><strong>● Date & Time:</strong> ${moment(created?.startTime).tz('Asia/Kolkata').format('DD MMM YYYY')} , ${moment(created?.startTime).tz('Asia/Kolkata').format('hh:mm A')} - ${moment(created?.endTime).tz('Asia/Kolkata').format('hh:mm A')}</p>
            <p style="margin: 6px 0; font-size: 14px;"><strong>● Location:</strong> ${created?.roomId?.name}</p>
            <p style="margin: 6px 0; font-size: 14px;"><strong>● Booked By:</strong> ${organizerName}</p>
          </div>

          <!-- Closing -->
          <p style="font-size: 14px; margin: 0 0 12px 0;">If you need to make changes, you can edit or cancel the booking from your HRMS portal.</p>
          <p style="font-size: 14px; margin: 0;">Best Regards,<br/><strong>${displayTeam?.TEAM_NAME || 'Company'}</strong></p>
        </div>
      `;

      Helper.sendEmail({
        receiverEmails: [organizerEmail],
        subject,
        message,
        team,
      }).catch(err => logger.error('Failed to send meeting booking email (organizer only):', err?.message || err));
    }
  } catch (e) {
    logger.error('Booking email dispatch error:', e?.message || e);
  }
});

const cancelBooking = catchAsync(async (req, res) => {
  const params = await validator.idParamSchema.validateAsync({ id: req.params.id });
  const updated = await bookingService.cancelBooking({ id: params.id, user: req.user });
  res.status(httpStatus.OK).json({ status: true, message: 'Booking cancelled', data: updated });

  // Fire-and-forget cancellation email
  try {
    const attendeeEmails = (updated?.attendees || []).map(a => a?.email).filter(Boolean);
    const organizerEmail = updated?.userId?.email;
    const team = req?.user?.team;
    if ((attendeeEmails?.length || organizerEmail) && team) {
      const subject = `❌ Your booking has been cancelled – ${updated?.title}`;
      const displayTeam = getTeamEmailConfig(team);
      const getDisplayName = (u) => ([u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || 'Team');
      const organizerName = getDisplayName(updated?.userId || {});

      // If there are attendees, send one email to all with Team greeting
      if (attendeeEmails?.length) {
        const message = `
          <div style="font-family: Arial, sans-serif; max-width: 550px; border: 1px solid #f3dada; border-radius: 8px; padding: 20px; background-color: #fff8f8; color: #333;">
            
            <!-- Greeting -->
            <p style="font-size: 15px; margin: 0 0 12px 0;">Hello Team,</p>
        
            <!-- Intro -->
            <p style="font-size: 14px; margin: 0 0 16px 0; color: #7F1D1D;">
              Your booking for <strong>${updated?.roomId?.name}</strong> scheduled on 
              <strong>${moment(updated?.startTime).tz('Asia/Kolkata').format('DD MMM YYYY')} at 
              ${moment(updated?.startTime).tz('Asia/Kolkata').format('hh:mm A')}</strong> 
              has been cancelled.
            </p>
        
            <!-- Cancelled Details -->
            <div style="padding: 14px; background: #fff; border: 1px solid #f3dada; border-radius: 6px; margin-bottom: 16px;">
              <p style="margin: 6px 0; font-size: 14px;">
                <strong>● Title:</strong> ${updated?.title}
              </p>
              <p style="margin: 6px 0; font-size: 14px;">
                <strong>● Cancelled By:</strong> ${updated?.cancelledBy || organizerName}
              </p>
              <p style="margin: 6px 0; font-size: 14px;">
                <strong>● Reason:</strong> ${updated?.reason || 'Not specified'}
              </p>
            </div>
        
            <!-- Closing -->
            <p style="font-size: 14px; margin: 0 0 12px 0;">
              You may create a new booking anytime through the HRMS portal.
            </p>
            
            <p style="font-size: 14px; margin: 0;">
              Regards,<br/>
              <strong>${displayTeam?.TEAM_NAME || 'Company'}</strong>
            </p>
          </div>
        `;

        const cc = organizerEmail ? [organizerEmail] : [];
        Helper.sendEmail({
          receiverEmails: attendeeEmails,
          subject,
          message,
          cc,
          team,
        }).catch(err => logger.error('Failed to send meeting cancellation email:', err?.message || err));
      } else if (organizerEmail) {
        // No attendees, notify organizer with personalized greeting
        const message = `
          <div style="font-family: Arial, sans-serif; max-width: 550px; border: 1px solid #f3dada; border-radius: 8px; padding: 20px; background-color: #fff8f8; color: #333;">
            
            <!-- Greeting -->
            <p style="font-size: 15px; margin: 0 0 12px 0;">Hello ${organizerName},</p>
        
            <!-- Intro -->
            <p style="font-size: 14px; margin: 0 0 16px 0; color: #7F1D1D;">
              Your booking for <strong>${updated?.roomId?.name}</strong> scheduled on 
              <strong>${moment(updated?.startTime).tz('Asia/Kolkata').format('DD MMM YYYY')} at 
              ${moment(updated?.startTime).tz('Asia/Kolkata').format('hh:mm A')}</strong> 
              has been cancelled.
            </p>
        
            <!-- Cancelled Details -->
            <div style="padding: 14px; background: #fff; border: 1px solid #f3dada; border-radius: 6px; margin-bottom: 16px;">
              <p style="margin: 6px 0; font-size: 14px;">
                <strong>● Title:</strong> ${updated?.title}
              </p>
              <p style="margin: 6px 0; font-size: 14px;">
                <strong>● Cancelled By:</strong> ${updated?.cancelledBy || organizerName}
              </p>
              <p style="margin: 6px 0; font-size: 14px;">
                <strong>● Reason:</strong> ${updated?.reason || 'Not specified'}
              </p>
            </div>
        
            <!-- Closing -->
            <p style="font-size: 14px; margin: 0 0 12px 0;">
              You may create a new booking anytime through the HRMS portal.
            </p>
            
            <p style="font-size: 14px; margin: 0;">
              Regards,<br/>
              <strong>${displayTeam?.TEAM_NAME || 'Company'}</strong>
            </p>
          </div>
        `;
        Helper.sendEmail({
          receiverEmails: [organizerEmail],
          subject,
          message,
          team,
        }).catch(err => logger.error('Failed to send meeting cancellation email:', err?.message || err));
      }
    }
  } catch (e) {
    logger.error('Booking cancellation email dispatch error:', e?.message || e);
  }
});

const updateBooking = catchAsync(async (req, res) => {
  const params = await validator.idParamSchema.validateAsync({ id: req.params.id });
  const updates = await validator.updateBookingSchema.validateAsync(req.body);
  const updated = await bookingService.updateBooking({ id: params.id, user: req.user, updates });
  res.status(httpStatus.OK).json({ status: true, message: 'Booking updated', data: updated });

  // Fire-and-forget email notification on update
  try {
    const attendeeEmails = (updated?.attendees || []).map(a => a?.email).filter(Boolean);
    const organizerEmail = updated?.userId?.email;
    const team = req?.user?.team;
    if ((attendeeEmails?.length || organizerEmail) && team) {
      const subject = `🔄 Updated booking details – ${updated?.title}`;
      const displayTeam = getTeamEmailConfig(team);
      const getDisplayName = (u) => ([u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || 'Team');
      const organizerName = getDisplayName(updated?.userId || {});
      const updaterName = ([req?.user?.firstName, req?.user?.lastName].filter(Boolean).join(' ') || req?.user?.email || organizerName);

      if (attendeeEmails?.length) {
        const message = `
          <div style=\"font-family: Arial, sans-serif; max-width: 550px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; background-color: #f9f9f9; color: #333;\"> 
            <p style=\"font-size: 15px; margin: 0 0 12px 0;\">Hello Team,</p>
            <p style=\"font-size: 14px; margin: 0 0 16px 0;\">The details of your booking have been updated. Please find the revised schedule:</p>
            <div style=\"padding: 14px; background: #fff; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 16px;\">
              <p style=\"margin: 6px 0; font-size: 14px;\"><strong>● Title:</strong> ${updated?.title}</p>
              <p style=\"margin: 6px 0; font-size: 14px;\"><strong>● New Date & Time:</strong> ${moment(updated?.startTime).tz('Asia/Kolkata').format('DD MMM YYYY')} , ${moment(updated?.startTime).tz('Asia/Kolkata').format('hh:mm A')} - ${moment(updated?.endTime).tz('Asia/Kolkata').format('hh:mm A')}</p>
              <p style=\"margin: 6px 0; font-size: 14px;\"><strong>● New Location:</strong> ${updated?.roomId?.name}</p>
              <p style=\"margin: 6px 0; font-size: 14px;\"><strong>● Updated By:</strong> ${updaterName}</p>
            </div>
            <p style=\"font-size: 14px; margin: 0 0 12px 0;\">Kindly check the updated details and join accordingly.</p>
            <p style=\"font-size: 14px; margin: 0;\">Thanks,<br/><strong>${displayTeam?.TEAM_NAME || 'Company'}</strong></p>
          </div>`;

        Helper.sendEmail({
          receiverEmails: attendeeEmails,
          subject,
          message,
          cc: organizerEmail ? [organizerEmail] : [],
          team,
        }).catch(err => logger.error('Failed to send meeting update email:', err?.message || err));
      } else if (organizerEmail) {
        const message = `
          <div style=\"font-family: Arial, sans-serif; max-width: 550px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; background-color: #f9f9f9; color: #333;\"> 
            <p style=\"font-size: 15px; margin: 0 0 12px 0;\">Hello ${organizerName},</p>
            <p style=\"font-size: 14px; margin: 0 0 16px 0;\">The details of your booking have been updated. Please find the revised schedule:</p>
            <div style=\"padding: 14px; background: #fff; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 16px;\">
              <p style=\"margin: 6px 0; font-size: 14px;\"><strong>● Title:</strong> ${updated?.title}</p>
              <p style=\"margin: 6px 0; font-size: 14px;\"><strong>● New Date & Time:</strong> ${moment(updated?.startTime).tz('Asia/Kolkata').format('DD MMM YYYY')} , ${moment(updated?.startTime).tz('Asia/Kolkata').format('hh:mm A')} - ${moment(updated?.endTime).tz('Asia/Kolkata').format('hh:mm A')}</p>
              <p style=\"margin: 6px 0; font-size: 14px;\"><strong>● New Location:</strong> ${updated?.roomId?.name}</p>
              <p style=\"margin: 6px 0; font-size: 14px;\"><strong>● Updated By:</strong> ${updaterName}</p>
            </div>
            <p style=\"font-size: 14px; margin: 0 0 12px 0;\">Kindly check the updated details and join accordingly.</p>
            <p style=\"font-size: 14px; margin: 0;\">Thanks,<br/><strong>${displayTeam?.TEAM_NAME || 'Company'}</strong></p>
          </div>`;

        Helper.sendEmail({
          receiverEmails: [organizerEmail],
          subject,
          message,
          team,
        }).catch(err => logger.error('Failed to send meeting update email:', err?.message || err));
      }
    }
  } catch (e) {
    logger.error('Booking update email dispatch error:', e?.message || e);
  }
});

const submitMom = catchAsync(async (req, res) => {
  const params = await validator.idParamSchema.validateAsync({ id: req.params.id });
  const body = await validator.submitMomSchema.validateAsync(req.body);
  const result = await bookingService.submitMom({ id: params.id, user: req.user, contentHtml: body.contentHtml });
  res.status(httpStatus.OK).json({ status: true, message: 'MOM sent successfully', data: result });
});

module.exports = { listRooms, getBookings, createBooking, cancelBooking, updateBooking, submitMom };


