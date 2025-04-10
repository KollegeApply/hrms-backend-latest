require('dotenv').config({ path: '.env.development' });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./src/models/userModel'); // 👈 Update path if needed

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const adminData = {
  firstName: 'Super',
  lastName: 'Admin',
  email: 'admin@example.com',
  password: bcrypt.hashSync('sdlmssecret@123', 10), // 👈 Hashed password
  role: 'admin',
  status: 'active',
};

const createAdmin = async () => {
  try {
    await connectDB();

    const existingUser = await User.findOne({ email: adminData.email }).select('+password');
    if (existingUser) {
      console.log('ℹ️ Admin user already exists:', existingUser.email);
    } else {
      const admin = new User(adminData);
      await admin.save();
      console.log('✅ Admin user created successfully:', admin.email);
    }

    mongoose.connection.close();
  } catch (err) {
    console.error('❌ Error creating admin:', err);
    process.exit(1);
  }
};

createAdmin();
