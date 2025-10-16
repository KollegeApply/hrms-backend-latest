const express = require('express');
const router = express.Router();
const personalEventController = require('../controllers/personalEventController');
const personalEventValidator = require('../validators/personalEventValidator');
const { authenticateUser } = require('../middleware/authMiddleware');

// Apply authentication middleware to all routes
router.use(authenticateUser);

// Create a new personal event
router.post(
  '/',
  async (req, res, next) => {
    try {
      const validatedData = await personalEventValidator.createPersonalEventSchema.validateAsync(req.body);
      req.body = validatedData;
      next();
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.details[0].message,
      });
    }
  },
  personalEventController.createPersonalEvent
);

// Get all personal events for the authenticated user
router.get('/', personalEventController.getPersonalEvents);

// Get a specific personal event by ID
router.get(
  '/:id',
  async (req, res, next) => {
    try {
      const validatedData = await personalEventValidator.personalEventIdSchema.validateAsync(req.params);
      req.params = validatedData;
      next();
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.details[0].message,
      });
    }
  },
  personalEventController.getPersonalEventById
);

// Update a personal event
router.put(
  '/:id',
  async (req, res, next) => {
    try {
      const validatedParams = await personalEventValidator.personalEventIdSchema.validateAsync(req.params);
      const validatedBody = await personalEventValidator.updatePersonalEventSchema.validateAsync(req.body);
      req.params = validatedParams;
      req.body = validatedBody;
      next();
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.details[0].message,
      });
    }
  },
  personalEventController.updatePersonalEvent
);

// Delete a personal event
router.delete(
  '/:id',
  async (req, res, next) => {
    try {
      const validatedData = await personalEventValidator.personalEventIdSchema.validateAsync(req.params);
      req.params = validatedData;
      next();
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.details[0].message,
      });
    }
  },
  personalEventController.deletePersonalEvent
);

module.exports = router;
