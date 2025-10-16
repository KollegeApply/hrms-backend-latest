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
  } catch (error) {
    // Continue to next path
  }
}

const roomsData = [
  {
    name: 'Drdha - Sankalpa',
    type: 'conference',
    capacity: 12,
    location: 'Office', // You may need to adjust this based on your office layout
    amenities: ['LED 75"', 'Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Ojasvinaya',
    type: 'conference',
    capacity: 8,
    location: 'Office',
    amenities: ['LED 65"', 'Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Vyuha',
    type: 'meeting',
    capacity: 3,
    location: 'Office',
    amenities: ['Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Divit',
    type: 'meeting',
    capacity: 3,
    location: 'Office',
    amenities: ['Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Tej',
    type: 'meeting',
    capacity: 3,
    location: 'Office',
    amenities: ['Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Vyan',
    type: 'meeting',
    capacity: 3,
    location: 'Office',
    amenities: ['Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Ogha',
    type: 'meeting',
    capacity: 3,
    location: 'Office',
    amenities: ['Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Yudhitva',
    type: 'meeting',
    capacity: 3,
    location: 'Office',
    amenities: ['Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Prabodhana',
    type: 'meeting',
    capacity: 3,
    location: 'Office',
    amenities: ['Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Vidyutka',
    type: 'meeting',
    capacity: 4,
    location: 'Office',
    amenities: ['Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Rananiti',
    type: 'meeting',
    capacity: 4,
    location: 'Office',
    amenities: ['LED 50"', 'Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Tattvabodha',
    type: 'meeting',
    capacity: 5,
    location: 'Office',
    amenities: ['LED 50"', 'Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Bodhisattvendra',
    type: 'meeting',
    capacity: 6,
    location: 'Office',
    amenities: ['LED 55"', 'Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Navodayanetra',
    type: 'meeting',
    capacity: 6,
    location: 'Office',
    amenities: ['LED 55"', 'Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  },
  {
    name: 'Tejasprabhananda (Sanjay Sir Cabin)',
    type: 'conference', // Changed from "Sanjay Sir Room" to "Conference Room"
    capacity: 1, // Set to 1 since original was "-"
    location: 'Office',
    amenities: ['Writing Board', 'Duster', 'Marker'],
    status: 'available',
    image: 'https://thumbs.dreamstime.com/b/futuristic-meeting-room-blue-lighting-high-tech-digital-screen-overlooking-cityscape-night-futuristic-meeting-room-358645817.jpg'
  }
];

async function setupMeetingRooms() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('No MongoDB URI found in environment variables');
    }
    await mongoose.connect(mongoUri);

    console.log('Connected to MongoDB');

    // Clear existing rooms (optional - remove this if you want to keep existing data)
    await Rooms.deleteMany({});
    console.log('Cleared existing rooms');

    // Insert new rooms
    const insertedRooms = await Rooms.insertMany(roomsData);
    console.log(`Successfully inserted ${insertedRooms.length} rooms:`);
    
    insertedRooms.forEach(room => {
      console.log(`- ${room.name} (${room.type}, Capacity: ${room.capacity})`);
    });

  } catch (error) {
    console.error('Error setting up meeting rooms:', error);
  } finally {
    // Close the connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the script
if (require.main === module) {
  setupMeetingRooms();
}

module.exports = { setupMeetingRooms, roomsData };
