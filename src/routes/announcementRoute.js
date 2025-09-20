const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/announcementController');
const { authenticateUser } = require('../middleware/authMiddleware');


// Apply authentication middleware to protected routes
router.use(authenticateUser);

// Create announcement
router.post('/', announcementController.createAnnouncement);

// Get announcements (with filters)
router.get('/', announcementController.getAnnouncements);

// Get user-specific announcements
router.get('/user', announcementController.getUserAnnouncements);

// Get announcement by ID
router.get('/:id', announcementController.getAnnouncementById);

// Update announcement
router.put('/:id', announcementController.updateAnnouncement);

// Delete announcement
router.delete('/:id', announcementController.deleteAnnouncement);

module.exports = router;
