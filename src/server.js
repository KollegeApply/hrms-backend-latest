// src/server.js
const express = require('express');
const app = express();
const cors = require('cors');
const multer = require('multer');
const helmet = require('helmet'); // Security middleware
const compression = require('compression'); // Compress responses
const pinoHttp = require('pino-http'); // Optional: structured logging
const { logger } = require('./config/logger'); // Correctly destructure the logger
const { randomUUID } = require('crypto');

// Security Middleware
app.use(helmet());

// Enable CORS - configure origins properly for production
app.use(cors());
app.options('*', cors()); // enable pre-flight requests
app.use(
  pinoHttp({
    logger,
    genReqId: function (req, res) {
      const existingID = req.id ?? req.headers['x-request-id'];
      if (existingID) return existingID;
      const id = randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
  })
);

// Parsing Middleware
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// File Upload Middleware (if needed, configure storage/limits)
// app.use(multer().any()); // Accepts any file uploads - BE CAREFUL IN PRODUCTION

// Compression Middleware
app.use(compression());

// Optional: Request Logging Middleware (after static files, before routes)
// app.use(pinoHttp({ logger }));

// Export the app instance
module.exports = { app };
