const express = require('express');
const controller = require('../controllers/resignationController');
const { authenticateUser, authorizeRole } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticateUser);

router.post('/verify-password', controller.verifyPassword);
router.get('/config', controller.getConfig);
router.get('/cc-users', controller.getCcUsers);
router.post('/', controller.apply);
router.get('/mine', controller.getMine);

router.get('/tl', authorizeRole(['teamlead', 'subteamlead']), controller.getTl);
router.put('/:id/tl-action', authorizeRole(['teamlead', 'subteamlead']), controller.tlAction);

router.get('/hr', authorizeRole(['hr', 'admin', 'subadmin']), controller.getHr);
router.put('/:id/hr-action', authorizeRole(['hr', 'admin', 'subadmin']), controller.hrAction);

module.exports = router;
