const mongoose = require('mongoose');
const { Schema } = mongoose;

const announcementSchema = new Schema(
  {
    title: { 
      type: String, 
      required: true, 
      trim: true 
    },
    content: { 
      type: String, 
      required: true, 
      trim: true 
    },
    date: { 
      type: Date, 
      required: true 
    },
    time: { 
      type: String, 
      required: true 
    },
    category: {
      type: String,
      enum: ['general', 'department'],
      default: 'general',
      required: true
    },
    departmentId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Department',
      required: function() {
        return this.category === 'department';
      }
    },
    createdBy: { 
      type: Schema.Types.ObjectId, 
      ref: 'User', 
      required: true 
    },
    expireInHours: { 
      type: Number,
      default: 24
    },
    isDeleted: { 
      type: Boolean, 
      default: false 
    }
  },
  { timestamps: true }
);

// Index for better query performance
announcementSchema.index({ category: 1, departmentId: 1, isActive: 1, isDeleted: 1 });
announcementSchema.index({ date: 1, time: 1 });

module.exports = mongoose.model('Announcement', announcementSchema);
