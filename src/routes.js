// src/routes.js
const express = require('express');
const userRoutes = require('./routes/userRoutes');
const holidayRoutes = require('./routes/holidayRoute');
const departmentRoutes = require('./routes/departmentRoute');
const attendanceRoutes = require('./routes/attendanceRoute');
const leaveRoutes = require('./routes/leaveRoute');
const wfhRoutes = require('./routes/wfhRoute');
const thirdPartyRoutes = require('./routes/thirdpartyRoute');
const statsRoutes = require('./routes/statsRoute');
const assetRoutes = require('./routes/assetRoute');
const ticketRoutes = require('./routes/ticketRoute')
const meetingRoutes = require('./routes/meetingRoute');
const feedbackRoutes = require('./routes/feedbackRoute');
const candidateRoutes = require('./routes/candidateRoute');
const regularizationRoutes = require('./routes/regularizationRoute');
const aiTestRoutes = require('./routes/aiTestRoute');
const personalEventRoutes = require('./routes/personalEventRoute');
const announcementRoutes = require('./routes/announcementRoute');
const kpiRoutes = require('./routes/kpiRoute');
const biometricWebhookRoutes = require('./routes/biometricWebhookRoute');
// const otherRoutes = require('./routes/otherRoutes'); // Example for future routes

const router = express.Router();

const apiVersion = process.env.API_VERSION || 'v1';

const defaultRoutes = [
  {
    path: `/api/${apiVersion}/users`,
    route: userRoutes,
  },
  {
    path: `/api/${apiVersion}/holiday`,
    route: holidayRoutes,
  },
  {
    path: `/api/${apiVersion}/department`,
    route: departmentRoutes,
  },
  {
    path: `/api/${apiVersion}/attendance`,
    route: attendanceRoutes,
  },
  {
    path: `/api/${apiVersion}/leave`,
    route: leaveRoutes,
  },
  {
    path: `/api/${apiVersion}/wfh`,
    route: wfhRoutes,
  },
  {
    path: `/api/${apiVersion}/thirdParty`,
    route: thirdPartyRoutes,
  },
  {
    path: `/api/${apiVersion}/stats`,
    route: statsRoutes,
  },
  {
    path: `/api/${apiVersion}/assets`,
    route: assetRoutes,
  },
  {
    path: `/api/${apiVersion}/tickets`,
    route: ticketRoutes,
  },
  {
    path: `/api/${apiVersion}/feedbacks`,
    route: feedbackRoutes,
  },
  {
    path: `/api/${apiVersion}/candidates`,
    route: candidateRoutes,
  },
  {
    path: `/api/${apiVersion}/regularization`,
    route: regularizationRoutes,
  },
  {
    path: `/api/${apiVersion}/ai`,
    route: aiTestRoutes,
  },
  {
    path: `/api/${apiVersion}/personal-events`,
    route: personalEventRoutes,
  },
  {
    path: `/api/${apiVersion}/announcements`,
    route: announcementRoutes,
  }
  ,
  {
    path: `/api/${apiVersion}/meetings`,
    route: meetingRoutes,
  },
  {
    path: `/api/${apiVersion}/kpis`,
    route: kpiRoutes,
  },
  {
    path: `/api/${apiVersion}/webhook`,
    route: biometricWebhookRoutes,
  }
  // Add other route configurations here
  // {
  //   path: `/api/${apiVersion}/departments`,
  //   route: departmentRoutes,
  // },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});


module.exports = router;
