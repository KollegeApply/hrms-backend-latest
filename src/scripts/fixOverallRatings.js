const mongoose = require('mongoose');
const Feedback = require('../models/feedbackModel');
const logger = require('../config/logger');

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoURI) {
      throw new Error('No MongoDB URI found in environment variables');
    }
    await mongoose.connect(mongoURI);
    logger.info('✅ Connected to MongoDB');
  } catch (error) {
    logger.error('❌ MongoDB connection error:', error.message);
    throw error;
  }
};

const fixOverallRatings = async () => {
  await connectDB();
  logger.info('🔧 Fixing overall ratings for existing feedback documents...');

  try {
    // Find all feedback documents
    const feedbacks = await Feedback.find({ isDeleted: false });
    logger.info(`📊 Found ${feedbacks.length} feedback documents to check`);

    let fixedCount = 0;
    let skippedCount = 0;

    for (const feedback of feedbacks) {
      let needsUpdate = false;
      const updates = {};

      // Check if overall rating is missing or null
      if (!feedback.rating || feedback.rating.overall === null || feedback.rating.overall === undefined) {
        
        // Calculate overall from individual ratings
        if (feedback.rating && typeof feedback.rating === 'object') {
          const individualRatings = [];
          
          // Handle both Map and Object formats
          if (feedback.rating instanceof Map) {
            for (let [key, value] of feedback.rating) {
              if (key !== 'overall' && typeof value === 'number' && value > 0) {
                individualRatings.push(value);
              }
            }
          } else {
            Object.entries(feedback.rating).forEach(([key, value]) => {
              if (key !== 'overall' && typeof value === 'number' && value > 0) {
                individualRatings.push(value);
              }
            });
          }

          if (individualRatings.length > 0) {
            const calculatedOverall = parseFloat(
              (individualRatings.reduce((sum, rating) => sum + rating, 0) / individualRatings.length).toFixed(1)
            );
            
            // Update the rating object
            if (feedback.rating instanceof Map) {
              feedback.rating.set('overall', calculatedOverall);
            } else {
              updates.rating = { ...feedback.rating, overall: calculatedOverall };
            }
            
            // Also update legacy rating if it exists
            if (feedback.legacyRating) {
              updates.legacyRating = { ...feedback.legacyRating, overall: calculatedOverall };
            }
            
            needsUpdate = true;
            logger.info(`📝 Feedback ${feedback._id}: Calculated overall rating ${calculatedOverall} from ${individualRatings.length} ratings`);
          }
        }
        
        // Check legacy rating as fallback
        else if (feedback.legacyRating) {
          const legacyRatings = [];
          Object.entries(feedback.legacyRating).forEach(([key, value]) => {
            if (key !== 'overall' && typeof value === 'number' && value > 0) {
              legacyRatings.push(value);
            }
          });
          
          if (legacyRatings.length > 0) {
            const calculatedOverall = parseFloat(
              (legacyRatings.reduce((sum, rating) => sum + rating, 0) / legacyRatings.length).toFixed(1)
            );
            
            updates.rating = { overall: calculatedOverall };
            updates.legacyRating = { ...feedback.legacyRating, overall: calculatedOverall };
            
            needsUpdate = true;
            logger.info(`📝 Feedback ${feedback._id}: Calculated overall rating ${calculatedOverall} from legacy ratings`);
          }
        }
      }

      // Update the document if needed
      if (needsUpdate) {
        await Feedback.findByIdAndUpdate(feedback._id, updates);
        fixedCount++;
      } else {
        skippedCount++;
      }
    }

    logger.info('🎉 Overall rating fix complete!');
    logger.info(`📊 Summary:`);
    logger.info(`   - Total documents checked: ${feedbacks.length}`);
    logger.info(`   - Documents fixed: ${fixedCount}`);
    logger.info(`   - Documents skipped: ${skippedCount}`);

  } catch (error) {
    logger.error('❌ Error during overall rating fix:', error);
  } finally {
    await mongoose.disconnect();
    logger.info('🔌 Database connection closed');
  }
};

if (require.main === module) {
  fixOverallRatings();
}

module.exports = { fixOverallRatings };
