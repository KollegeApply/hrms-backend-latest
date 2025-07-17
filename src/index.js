// Load environment variables based on NODE_ENV
if (process.env.NODE_ENV) {
  require('dotenv').config({
    path: `.env.${process.env.NODE_ENV}`,
  });
} else {
  require('dotenv').config(); // Default to .env
}

// Import logger
const logger = require('./config/logger');

// Validate essential environment variables (optional but recommended)
const requiredEnv = ['MONGO_URI', 'SECRET_KEY', 'PORT'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  logger.error(
    `FATAL ERROR: Missing required environment variables: ${missingEnv.join(', ')}`
  );
  process.exit(1); // Exit if critical configuration is missing
}

const mongoose = require('mongoose');

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    // Use new connection management features
    // useNewUrlParser: true, // No longer needed in Mongoose 6+
    // useUnifiedTopology: true // No longer needed in Mongoose 6+
    // Add other options if needed, e.g., serverSelectionTimeoutMS
  })
  .then(() => {
    logger.info(`🗄️ MongoDB connected successfully.`);
    // Start the Express server ONLY after DB connection is successful
    require('./expressServer');
  })
  .catch((err) => {
    logger.error('❌ MongoDB connection error:', err.message);
    console.log(err);
    // process.exit(1); // Exit the application if DB connection fails
  });

// Graceful shutdown handling (optional but good practice)
const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    logger.info(`\n${signal} received. Closing connections...`);
    try {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed.');
      // Close server if it's exported or accessible here
      // server.close(() => { logger.info('HTTP server closed.'); });
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  });
});
