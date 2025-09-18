const mongoose = require('mongoose');
const { Schema } = mongoose;

const roomSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
    },
    location: {
      type: String,
      required: true,
      trim: true,
    },
    amenities: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['available', 'unavailable', 'maintenance'],
      default: 'available',
      required: true,
    },
    image: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

roomSchema.index({ name: 1, location: 1 }, { unique: true });
roomSchema.index({ status: 1, capacity: 1 });

const Rooms = mongoose.model('Rooms', roomSchema);

module.exports = Rooms;


