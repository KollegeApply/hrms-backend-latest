// src/routes.js
const express = require('express');
const userRoutes = require('./routes/userRoutes');
const holidayRoutes = require('./routes/holidayRoute');
const departmentRoutes = require('./routes/departmentRoute');
const attendanceRoutes = require('./routes/attendanceRoute');
const leaveRoutes = require('./routes/leaveRoute');
const wfhRoutes = require('./routes/wfhRoute');
const thirdPartyRoutes = require('./routes/thirdpartyRoute')
const requestRoutes = require('./routes/requestRoute')
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
    path: `/api/${apiVersion}/request`,
    route: requestRoutes
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
