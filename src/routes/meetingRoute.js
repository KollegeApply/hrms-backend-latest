const express = require('express');
const controller = require('../controllers/bookingController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/rooms', authenticateUser, controller.listRooms);
router.get('/bookings', authenticateUser, controller.getBookings);
router.post('/bookings', authenticateUser, controller.createBooking);
router.delete('/bookings/:id', authenticateUser, controller.cancelBooking);
router.put('/bookings/:id', authenticateUser, controller.updateBooking);
router.post('/bookings/:id/mom', authenticateUser, controller.submitMom);

module.exports = router;


