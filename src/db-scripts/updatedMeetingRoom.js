const mongoose = require('mongoose');
const path = require('path');
const Rooms = require('../models/roomModel');

// Try different env file locations
const envPaths = [
  path.resolve(__dirname, '../../.env.development'),
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env')
];

for (const envPath of envPaths) {
  try {
    require('dotenv').config({ path: envPath });
    break;
  } catch (error) {}
}

// ----------------------------
//  FINAL ROOMS DATA WITH _id
// ----------------------------
const roomsData = [
  {
    _id: "68d0c6bb15c3091a3dd35572",
    name: "Drdha - Sankalpa (C-1)",
    type: "conference",
    capacity: 12,
    location: "Office",
    amenities: ["LED 75", "Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd35573",
    name: "Ojasvinaya (C-2)",
    type: "conference",
    capacity: 8,
    location: "Office",
    amenities: ["LED 65", "Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd35574",
    name: "Vyuha (M-9)",
    type: "meeting",
    capacity: 3,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd35575",
    name: "Divit (M-1)",
    type: "meeting",
    capacity: 3,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd35576",
    name: "Tej (M-6)",
    type: "meeting",
    capacity: 3,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd35577",
    name: "Vyan (M-7)",
    type: "meeting",
    capacity: 3,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd35578",
    name: "Ogha (M-3)",
    type: "meeting",
    capacity: 3,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd35579",
    name: "Yudhitva (M-11)",
    type: "meeting",
    capacity: 3,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd3557a",
    name: "Prabodhana (M-5)",
    type: "meeting",
    capacity: 3,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd3557b",
    name: "Vidyutka (M-12)",
    type: "meeting",
    capacity: 4,
    location: "Office",
    amenities: ["LED 55", "Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd3557c",
    name: "Rananiti (M-2)",
    type: "meeting",
    capacity: 4,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd3557d",
    name: "Tattvabodha (M-4)",
    type: "meeting",
    capacity: 5,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd3557e",
    name: "Bodhisattvendra (M-8)",
    type: "meeting",
    capacity: 6,
    location: "Office",
    amenities: ["LED 55", "Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd3557f",
    name: "Navodayanetra (M-10)",
    type: "meeting",
    capacity: 6,
    location: "Office",
    amenities: ["LED 55", "Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },

  // NEW rooms
  {
    _id: "68d0c6bb15c3091a3dd35590",
    name: "Tarang (M-13)",
    type: "meeting",
    capacity: 4,
    location: "Office",
    amenities: ["LED 55", "Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd35591",
    name: "Tvara (M-14)",
    type: "meeting",
    capacity: 4,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },
  {
    _id: "68d0c6bb15c3091a3dd35592",
    name: "Dhruta (M-15)",
    type: "meeting",
    capacity: 4,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  },

  // Sanjay Sir Cabin
  {
    _id: "68d0c6bb15c3091a3dd35580",
    name: "Tejasprabhananda (Sanjay Sir)",
    type: "conference",
    capacity: 1,
    location: "Office",
    amenities: ["Writing Board", "Duster", "Marker"],
    status: "available",
    image:
      "https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg",
  }
];

async function setupMeetingRooms() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) throw new Error("MongoDB URI missing");

    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    let updated = 0, inserted = 0;

    for (const room of roomsData) {
      const result = await Rooms.findOneAndUpdate(
        { _id: room._id }, // <-- Update on exact _id
        room,
        { upsert: true, new: true }
      );

      if (result) {
        if (result.isNew) {
          inserted++;
          console.log(`➕ Inserted: ${room.name}`);
        } else {
          updated++;
          console.log(`✔ Updated: ${room.name}`);
        }
      }
    }

    console.log(`\nSummary: Updated = ${updated}, Inserted = ${inserted}`);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.connection.close();
    console.log("DB connection closed");
  }
}

if (require.main === module) {
  setupMeetingRooms();
}

module.exports = { setupMeetingRooms, roomsData };
