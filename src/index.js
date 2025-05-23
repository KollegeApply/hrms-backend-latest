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
    const initCronJobs = async () => {
      const cron = require('node-cron');
      const resetAnnualLeaves = require('./cron/onRollLeaveCron');
      const updateProbationLeavesForAllUsers = require('./cron/probationLeaveCron');

      // Annual Leave Reset - Run at 12:00 AM on Jan 1 every year
      cron.schedule('0 0 1 1 *', async () => {
        try {
          logger.info('🔁 Running scheduled onRoll leave cron job');
          await resetAnnualLeaves();
          logger.info('✅ onRoll leave cron job completed');
        } catch (error) {
          logger.error('❌ onRoll leave cron job failed:', error);
        }
      });

      // Probation Leave Update - Run at 12:05 AM on the 1st of every month
      cron.schedule('0 0 1 * *', async () => {
        try {
          logger.info('🔁 Running scheduled probation leave cron job');
          await updateProbationLeavesForAllUsers();
          logger.info('✅ probation leave cron job completed');
        } catch (error) {
          logger.error('❌ probation leave cron job failed:', error);
        }
      });
    };

    setTimeout(initCronJobs, 1000);
  })
  .catch((err) => {
    logger.error('❌ MongoDB connection error:', err.message);
    process.exit(1); // Exit the application if DB connection fails
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
