const mongoose = require('mongoose');
const path = require('path');
const Rooms = require('../models/roomModel');

const envPaths = [
  path.resolve(__dirname, '../../.env.development'),
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env'),
];

for (const envPath of envPaths) {
  try {
    require('dotenv').config({ path: envPath });
    break;
  } catch (error) {}
}

const ROOM_UPDATES = [
  { _id: '68d0c6bb15c3091a3dd35575', name: 'ADHYAYAN (M-1)', type: 'meeting', capacity: 3, amenities: ['Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd3557c', name: 'VIDYALAYA (M-2)', type: 'meeting', capacity: 4, amenities: ['Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd35578', name: 'VEDA (M-3)', type: 'meeting', capacity: 3, amenities: ['Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd3557d', name: 'VIKRAMSHILA (M-4)', type: 'meeting', capacity: 5, amenities: ['LED 50"', 'Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd3557a', name: 'TAPAS (M-5)', type: 'meeting', capacity: 3, amenities: ['Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd35576', name: 'MANAN (M-6)', type: 'meeting', capacity: 3, amenities: ['Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd35577', name: 'ANVESHAN (M-7)', type: 'meeting', capacity: 3, amenities: ['Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd3557e', name: 'SHIKHAR (M-8)', type: 'meeting', capacity: 6, amenities: ['LED 55"', 'Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd35574', name: 'VYUHA (M-9)', type: 'meeting', capacity: 3, amenities: ['Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd3557f', name: 'NAVODAYANETRA (M-10)', type: 'meeting', capacity: 6, amenities: ['LED 55"', 'Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd35579', name: 'YUDHITVA (M-11)', type: 'meeting', capacity: 3, amenities: ['Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd3557b', name: 'VICE CITY (M-12)', type: 'meeting', capacity: 4, amenities: ['LED 50"', 'Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd35590', name: 'MESSI (M-13)', type: 'meeting', capacity: 3, amenities: ['LED 50"', 'Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd35591', name: 'VIRAT (M-14)', type: 'meeting', capacity: 4, amenities: ['LED 55"', 'Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd35592', name: 'PAVILLION (M-15)', type: 'meeting', capacity: 4, amenities: ['Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd35572', name: 'TAKSHASHILA (C-1)', type: 'conference', capacity: 12, amenities: ['LED 75"', 'Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd35573', name: 'NALANDA (C-2)', type: 'conference', capacity: 8, amenities: ['LED 65"', 'Writing Board', 'Duster', 'Marker'] },
  { _id: '68d0c6bb15c3091a3dd35580', name: "SANKALP (FOUNDER'S ROOM)", type: "conference", capacity: 1, amenities: ['Writing Board', 'Duster', 'Marker'] },
];

async function updateMeetingRoomsMar2026V2() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) throw new Error('MongoDB URI missing in env');

    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const ops = ROOM_UPDATES.map((room) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(room._id) },
        update: {
          $set: {
            name: room.name,
            type: room.type,
            capacity: room.capacity,
            amenities: room.amenities,
          },
        },
        upsert: false,
      },
    }));

    const result = await Rooms.bulkWrite(ops, { ordered: false });
    console.log(`Matched: ${result.matchedCount || 0}`);
    console.log(`Modified: ${result.modifiedCount || 0}`);
    console.log(`Upserted: ${result.upsertedCount || 0}`);
  } catch (error) {
    console.error('Meeting room update failed:', error.message);
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log('DB connection closed');
  }
}

if (require.main === module) {
  updateMeetingRoomsMar2026V2().catch(() => process.exit(1));
}

module.exports = { updateMeetingRoomsMar2026V2, ROOM_UPDATES };
