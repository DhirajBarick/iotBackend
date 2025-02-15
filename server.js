const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const rateLimit = require('express-rate-limit');

// Environment variables
const username = encodeURIComponent(process.env.MONGO_USERNAME);
const password = encodeURIComponent(process.env.MONGO_PASSWORD);
const cluster = process.env.MONGO_CLUSTER;
const dbName = process.env.MONGO_DB || "airQualityDB";
const JWT_SECRET = process.env.JWT_SECRET || "airqualitymonitor2025secret";
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const PORT = process.env.PORT || 5000;

const MONGO_URI = `mongodb+srv://${username}:${password}@${cluster}/${dbName}?retryWrites=true&w=majority&tls=true&ssl=true&authSource=admin`;

// Initialize Express App
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Request logging middleware
const requestLogger = (req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
};
app.use(requestLogger);

// Connect to MongoDB with improved error handling
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
}).catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("Connected to MongoDB"));

// Email configuration with improved settings
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false
  },
  pool: true,
  maxConnections: 5,
  maxMessages: 100
});

// Verify email configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('Email configuration error:', error);
  } else {
    console.log('Email server is ready');
  }
});

// Email queue implementation
const emailQueue = [];
let isProcessingQueue = false;

const processEmailQueue = async () => {
  if (isProcessingQueue || emailQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (emailQueue.length > 0) {
    const { mailOptions, resolve, reject } = emailQueue.shift();
    
    try {
      await transporter.sendMail(mailOptions);
      resolve({ success: true });
    } catch (error) {
      console.error('Email sending error:', error);
      reject(error);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  isProcessingQueue = false;
};

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Authentication token required" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

// Schema Definitions
const notificationPreferencesSchema = new mongoose.Schema({
  email: { type: Boolean, default: true },
  goodAQINotification: { type: Boolean, default: true },
  badAQINotification: { type: Boolean, default: true },
  aqi_threshold_good: { type: Number, default: 50 },
  aqi_threshold_bad: { type: Number, default: 100 },
  lastNotificationSent: { type: Date },
  notificationCooldown: { type: Number, default: 3600000 }
});

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String },
    notificationPreferences: {
      type: notificationPreferencesSchema,
      default: () => ({})
    },
    lastLogin: { type: Date },
    lastLogout: { type: Date },
  },
  { 
    collection: "users",
    timestamps: true 
  }
);

const User = mongoose.model("User", userSchema);

// Send notification email
const sendEmail = async (user, subject, message) => {
  if (!user.notificationPreferences.email) return;

  const now = new Date();
  const lastNotification = user.notificationPreferences.lastNotificationSent;
  const cooldown = user.notificationPreferences.notificationCooldown;

  if (lastNotification && (now - lastNotification) < cooldown) {
    return;
  }

  try {
    const mailOptions = {
      from: EMAIL_USER,
      to: user.email,
      subject,
      text: message
    };

    await new Promise((resolve, reject) => {
      emailQueue.push({ mailOptions, resolve, reject });
      processEmailQueue();
    });

    user.notificationPreferences.lastNotificationSent = now;
    await user.save();
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
};

// Register User
app.post("/api/register", async (req, res) => {
  const { username, email, password, name } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      name,
      notificationPreferences: {
        email: true,
        goodAQINotification: true,
        badAQINotification: true,
        aqi_threshold_good: 50,
        aqi_threshold_bad: 100,
      },
    });

    await newUser.save();

    // Send welcome email
    await sendEmail(
      newUser,
      'Welcome to Air Quality Monitor',
      `Welcome ${username}! Your account has been created successfully. Please log in to start monitoring air quality.`
    );

    res.status(201).json({
      message: "Registration successful. Please log in to continue.",
      email: newUser.email
    });
  } catch (err) {
    res.status(500).json({ message: "Error registering user", error: err.message });
  }
});

// Login User
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Send login notification
    await sendEmail(
      user,
      'New Login Detected',
      `Hello ${user.username}, we detected a new login to your account at ${new Date().toLocaleString()}.`
    );

    res.json({
      message: "Login successful",
      token,
      userId: user._id,
      username: user.username,
      notificationPreferences: user.notificationPreferences,
    });
  } catch (err) {
    res.status(500).json({ message: "Error logging in", error: err.message });
  }
});

// Update User Profile
app.put("/api/user/update", authenticateToken, async (req, res) => {
  const { userId, name, username, notificationPreferences } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: "Unauthorized to update this profile" });
    }

    if (name) user.name = name;
    if (username) user.username = username;
    if (notificationPreferences) {
      user.notificationPreferences = {
        ...user.notificationPreferences,
        ...notificationPreferences,
      };
    }

    const updatedUser = await user.save();

    // Send profile update confirmation
    await sendEmail(
      user,
      'Profile Updated',
      `Your profile has been updated successfully at ${new Date().toLocaleString()}.`
    );

    res.json({
      message: "Profile updated successfully",
      user: {
        _id: updatedUser._id,
        username: updatedUser.username,
        name: updatedUser.name,
        email: updatedUser.email,
        notificationPreferences: updatedUser.notificationPreferences,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Error updating profile", error: err.message });
  }
});

// Update AQI Data
app.post("/api/update-aqi", authenticateToken, async (req, res) => {
  const { aqi } = req.body;

  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { goodAQINotification, badAQINotification, aqi_threshold_good, aqi_threshold_bad } = user.notificationPreferences;

    // Check AQI thresholds and send notifications
    if (goodAQINotification && aqi <= aqi_threshold_good) {
      await sendEmail(
        user,
        'Good Air Quality Alert',
        `Current AQI (${aqi}) is excellent! Perfect for outdoor activities.`
      );
    }

    if (badAQINotification && aqi >= aqi_threshold_bad) {
      await sendEmail(
        user,
        'Poor Air Quality Warning',
        `Warning: Current AQI (${aqi}) has exceeded your warning threshold (${aqi_threshold_bad}).`
      );
    }

    res.json({ message: "AQI check completed" });
  } catch (err) {
    res.status(500).json({ message: "Error checking AQI", error: err.message });
  }
});

// Record Logout
app.post("/api/logout", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (user) {
      user.lastLogout = new Date();
      await user.save();

      // Send logout notification
      await sendEmail(
        user,
        'Logout Confirmation',
        `Your account was logged out at ${new Date().toLocaleString()}.`
      );
    }
    res.json({ message: "Logout recorded successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error recording logout", error: err.message });
  }
});

// Get User Profile
app.get("/api/user/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error fetching profile", error: err.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed. Disconnecting from MongoDB...');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed.');
      process.exit(0);
    });
  });
});
