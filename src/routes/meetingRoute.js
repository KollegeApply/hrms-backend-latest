const express = require('express');
const controller = require('../controllers/bookingController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/rooms', authenticateUser, controller.listRooms);
// Per-day room block toggle: GET blocks for a day, PUT to switch one room on/off.
router.get('/room-blocks', authenticateUser, controller.listRoomBlocks);
router.put('/rooms/:id/block', authenticateUser, controller.setRoomBlock);
router.get('/bookings',authenticateUser, controller.getBookings);
router.post('/bookings', authenticateUser, controller.createBooking);
router.delete('/bookings/:id', authenticateUser, controller.cancelBooking);
router.put('/bookings/:id', authenticateUser, controller.updateBooking);
router.post('/bookings/:id/mom', authenticateUser, controller.submitMom);

module.exports = router;


