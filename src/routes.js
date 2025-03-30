// src/routes.js
const express = require('express');
const userRoutes = require('./routes/userRoutes');
// const otherRoutes = require('./routes/otherRoutes'); // Example for future routes

const router = express.Router();

const apiVersion = process.env.API_VERSION || 'v1';

const defaultRoutes = [
  {
    path: `/api/${apiVersion}/users`,
    route: userRoutes,
  },
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
