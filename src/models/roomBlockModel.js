const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A room blocked for one specific day (IST calendar day, `YYYY-MM-DD`).
 * The block only ever covers that day: the next day has no document, so the
 * room is automatically open again even if the user forgot to switch it off.
 */
const roomBlockSchema = new Schema(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'Rooms', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    blockedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

roomBlockSchema.index({ roomId: 1, date: 1 }, { unique: true });
roomBlockSchema.index({ date: 1 });

const RoomBlock = mongoose.model('RoomBlock', roomBlockSchema);

module.exports = RoomBlock;
