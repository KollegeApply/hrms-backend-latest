const express = require('express');
const {
  authenticateUser,
  authorizeRole,
} = require('../middleware/authMiddleware');
const ticketController = require('../controllers/ticketController');
const { USER_ROLES } = require('../utility/constants');

const router = express.Router();

router.use(authenticateUser);

router.post('/',ticketController.createTicket);

router.get('/',ticketController.getAllTickets);

router.get('/:id',ticketController.getTicketById);

router.patch('/:id', authorizeRole([USER_ROLES?.ADMIN,USER_ROLES?.SUBADMIN,USER_ROLES?.HR,USER_ROLES?.IT]), ticketController.updateTicket);

module.exports = router;