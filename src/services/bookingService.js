const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');
const Booking = require('../models/bookingModel');
const Rooms = require('../models/roomModel');
const Helper = require('../utility/helper');
const { getTeamEmailConfig } = require('../utility/constants');
const moment = require('moment-timezone');

class BookingService {
  async listRooms() {
    return Rooms.find({}).sort({ name: 1 });
  }

  async getBookings({ roomId, date, startTime, endTime, status, userType, userId }) {
    ('=== getBookings called ===');
    ('Parameters:', { roomId, date, startTime, endTime, status, userType, userId });
    
    const query = { isDeleted: false };
    if (roomId) query.roomId = roomId;
    // status parameter ignored after soft-delete migration

    // User filtering based on userType
    if (userType === 'my' && userId) {
      // Filter for bookings where user is the organizer or an attendee
      query.$or = [
        { userId: userId },
        { attendees: { $in: [userId] } }
      ];
      ('Applied user filter:', query.$or);
    }

    // Time range filtering
    if (date) {
      const d = new Date(date);
      const dayStart = new Date(d);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);
      query.startTime = { $lt: dayEnd };
      query.endTime = { $gt: dayStart };
    } else if (startTime && endTime) {
      query.startTime = { $lt: new Date(endTime) };
      query.endTime = { $gt: new Date(startTime) };
    }

    ('Final query:', JSON.stringify(query, null, 2));
    
    const result = await Booking.find(query)
      .populate('roomId')
      .populate('userId', 'firstName lastName email')
      .populate('attendees', 'firstName lastName email')
      .sort({ startTime: 1 });
    
    ('Query result count:', result.length);
    ('Query results:', result.map(r => ({ 
      id: r._id, 
      title: r.title, 
      userId: r.userId, 
      attendees: r.attendees,
      startTime: r.startTime 
    })));
    
    return result;
  }

  async createBooking({ userId, roomId, title, startTime, endTime, attendees = [] }) {
    const room = await Rooms.findById(roomId);
    if (!room) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Room not found');
    }

    // Overlap check for same room, pending/confirmed
    const overlap = await Booking.findOne({
      roomId,
      isDeleted: false,
      startTime: { $lt: new Date(endTime) },
      endTime: { $gt: new Date(startTime) },
    });

    if (overlap) {
      throw new ApiError(httpStatus.CONFLICT, 'Room is already booked for this time slot');
    }

    const doc = await Booking.create({
      roomId,
      userId,
      title,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      attendees,
      isDeleted: false,
    });

    const populated = await Booking.findById(doc._id)
      .populate('roomId')
      .populate('userId', 'firstName lastName email')
      .populate('attendees', 'firstName lastName email');
    return populated;
  }

  async cancelBooking({ id, user }) {
    const booking = await Booking.findById(id);
    if (!booking) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
    }

    // Only creator or admin/hr can cancel
    const isOwner = booking.userId.toString() === user.id;
    const isAdmin = ['admin', 'subadmin', 'hr'].includes(user.role);
    const isAttendee = Array.isArray(booking.attendees) && booking.attendees.some(a => a.toString() === user.id);
    if (!isOwner && !isAdmin && !isAttendee) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Not allowed to cancel this booking');
    }

    if (booking.isDeleted) return booking;
    booking.isDeleted = true;
    await booking.save();
    return Booking.findById(booking._id)
      .populate('roomId')
      .populate('userId', 'firstName lastName email')
      .populate('attendees', 'firstName lastName email');
  }

  async updateBooking({ id, user, updates }) {
    const booking = await Booking.findById(id);
    if (!booking) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
    }

    const isOwner = booking.userId.toString() === user.id;
    const isAdmin = ['admin', 'subadmin', 'hr'].includes(user.role);
    if (!isOwner && !isAdmin) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Not allowed to edit this booking');
    }

    // If start/end/room changed, check overlap
    const nextRoom = updates.roomId || booking.roomId;
    const nextStart = updates.startTime ? new Date(updates.startTime) : booking.startTime;
    const nextEnd = updates.endTime ? new Date(updates.endTime) : booking.endTime;

    const overlap = await Booking.findOne({
      _id: { $ne: booking._id },
      roomId: nextRoom,
      isDeleted: false,
      startTime: { $lt: nextEnd },
      endTime: { $gt: nextStart },
    });
    if (overlap) {
      throw new ApiError(httpStatus.CONFLICT, 'Room is already booked for this time slot');
    }

    if (updates.title !== undefined) booking.title = updates.title;
    if (updates.roomId) booking.roomId = updates.roomId;
    if (updates.startTime) booking.startTime = nextStart;
    if (updates.endTime) booking.endTime = nextEnd;
    if (updates.attendees) booking.attendees = updates.attendees;

    await booking.save();
    return Booking.findById(booking._id)
      .populate('roomId')
      .populate('userId', 'firstName lastName email')
      .populate('attendees', 'firstName lastName email');
  }

  async submitMom({ id, user, contentHtml }) {
    const booking = await Booking.findById(id)
      .populate('userId', 'firstName lastName email')
      .populate('attendees', 'firstName lastName email');
    if (!booking) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
    }
    const isOwner = booking.userId?.toString?.() === user.id || booking.userId?._id?.toString?.() === user.id;

    // Save MOM into document (new optional field)
    booking.minutesOfMeeting = contentHtml;
    await booking.save();

    const attendeeEmails = (booking.attendees || []).map(a => a?.email).filter(Boolean);
    const organizerEmail = booking.userId?.email;
    const team = user?.team || 'SD';
    const displayTeam = getTeamEmailConfig(team);

    const subject = `📝 Minutes of Meeting – ${booking?.title} (${moment(booking?.startTime).tz('Asia/Kolkata').format('DD MMM YYYY')})`;
    const attendeeNames = (booking?.attendees || [])
      .map(a => {
        const full = [a?.firstName, a?.lastName].filter(Boolean).join(' ').trim();
        return full || a?.email || '';
      })
      .filter(Boolean)
      .join(', ');

    const message = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; background-color: #f9f9f9; color: #333;">
    
        <!-- Greeting -->
        <p style="font-size: 15px; margin: 0 0 12px 0;">Hello Team,</p>
    
        <!-- Intro -->
        <p style="font-size: 14px; margin: 0 0 16px 0;">
          Please find below the Minutes of Meeting (MoM) for the session held on 
          <strong>${moment(booking?.startTime).tz('Asia/Kolkata').format('DD MMM YYYY')}</strong>.
        </p>
    
        <!-- Meeting Details -->
        <div style="padding: 14px; background: #fff; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 16px;">
          <p style="margin: 6px 0; font-size: 14px;">
            <strong>● Title:</strong> ${booking?.title}
          </p>
          <p style="margin: 6px 0; font-size: 14px;">
            <strong>● Date & Time:</strong> ${moment(booking?.startTime).tz('Asia/Kolkata').format('DD MMM YYYY')} , 
            ${moment(booking?.startTime).tz('Asia/Kolkata').format('hh:mm A')} - 
            ${moment(booking?.endTime).tz('Asia/Kolkata').format('hh:mm A')}
          </p>
          <p style="margin: 6px 0; font-size: 14px;">
            <strong>● Attendees:</strong> ${attendeeNames}
          </p>
          <p style="margin: 6px 0; font-size: 14px;">
            <strong>● Facilitator:</strong> ${booking?.organizerName || `${user?.firstName} ${user?.lastName}`}
          </p>
        </div>
    
        <!-- Discussion Points -->
        <div style="margin-bottom: 16px;">
          <p style="font-size: 14px; margin: 0 0 6px 0;"><strong>Discussion Points:</strong></p>
          <div style="font-size: 14px; padding-left: 10px;">
            ${contentHtml || "<p>No discussion points recorded.</p>"}
          </div>
        </div>
    
        <!-- Closing -->
        <p style="font-size: 14px; margin: 0;">
          Best Regards,<br/>
          <strong>${displayTeam?.TEAM_NAME || 'Company'}</strong>
        </p>
      </div>
    `;
    
  
  

    if (attendeeEmails.length) {
      await Helper.sendEmail({
        receiverEmails: attendeeEmails,
        subject,
        message,
        cc: organizerEmail ? [organizerEmail] : [],
        team,
      });
    } else if (organizerEmail) {
      await Helper.sendEmail({ receiverEmails: [organizerEmail], subject, message, team });
    }

    return { id: booking._id };
  }
}

module.exports = new BookingService();


