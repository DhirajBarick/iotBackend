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
const EMAIL_USER = process.env.EMAIL_USER || "your-email@gmail.com";
const EMAIL_PASS = process.env.EMAIL_PASS || "your-app-specific-password";

const MONGO_URI = mongodb+srv://${username}:${password}@${cluster}/${dbName}?retryWrites=true&w=majority&tls=true&ssl=true&authSource=admin;

// Initialize Express App
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use(limiter);

// Request logging middleware
const requestLogger = (req, res, next) => {
  console.log(${new Date().toISOString()} - ${req.method} ${req.url});
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

// Verify email configuration on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('Email configuration error:', error);
  } else {
    console.log('Email server is ready to take messages');
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
      console.error('Error sending email:', error);
      reject(error);
    }
    
    // Add delay between emails
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  isProcessingQueue = false;
};

// AQI notification helper function
const sendAQINotification = async (user, aqi) => {
  if (!user.notificationPreferences.email) return;

  let shouldNotify = false;
  let subject = '';
  let message = '';

  if (aqi <= user.notificationPreferences.aqi_threshold_good && user.notificationPreferences.goodAQINotification) {
    shouldNotify = true;
    subject = '🌟 Good Air Quality Alert';
    message = `Hello ${user.username},

Great news! The current Air Quality Index (AQI) is ${Math.round(aqi)}, which is below your set threshold of ${user.notificationPreferences.aqi_threshold_good}.

This indicates excellent air quality conditions. It's a perfect time for:
• Outdoor activities and exercise
• Opening windows for ventilation
• Enjoying outdoor gatherings

Keep monitoring the air quality to maintain these healthy conditions!

Best regards,
Air Quality Monitor Team`;
  } else if (aqi >= user.notificationPreferences.aqi_threshold_bad && user.notificationPreferences.badAQINotification) {
    shouldNotify = true;
    subject = '⚠ Poor Air Quality Alert';
    message = `Hello ${user.username},

Warning: The current Air Quality Index (AQI) is ${Math.round(aqi)}, which has exceeded your set threshold of ${user.notificationPreferences.aqi_threshold_bad}.

Recommended precautions:
• Limit outdoor activities
• Keep windows closed
• Use air purifiers if available
• Wear appropriate masks when outdoors
• Monitor any respiratory symptoms

Please take necessary precautions to protect your health.

Best regards,
Air Quality Monitor Team`;
  }

  if (shouldNotify) {
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
  }
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

// Input validation middleware
const validateUserInput = (req, res, next) => {
  const { username, email, password } = req.body;
  
  if (username && username.length < 3) {
    return res.status(400).json({ message: "Username must be at least 3 characters long" });
  }
  
  if (email && !email.includes('@')) {
    return res.status(400).json({ message: "Invalid email format" });
  }
  
  if (password && password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters long" });
  }
  
  next();
};

// Schema Definitions
const notificationPreferencesSchema = new mongoose.Schema({
  email: { type: Boolean, default: true },
  goodAQINotification: { type: Boolean, default: true },
  badAQINotification: { type: Boolean, default: true },
  aqi_threshold_good: { type: Number, default: 50 },
  aqi_threshold_bad: { type: Number, default: 100 },
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// API Routes

// Register User
app.post("/api/register", validateUserInput, async (req, res) => {
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
    
    const token = jwt.sign(
      { userId: newUser._id, email: newUser.email },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Send welcome email
    const welcomeMailOptions = {
      from: EMAIL_USER,
      to: email,
      subject: 'Welcome to Air Quality Monitor!',
      text: Welcome ${username}!\n\nThank you for registering with Air Quality Monitor. We're excited to help you monitor and maintain healthy air quality.\n\nBest regards,\nAir Quality Monitor Team
    };

    await new Promise((resolve, reject) => {
      emailQueue.push({ mailOptions: welcomeMailOptions, resolve, reject });
      processEmailQueue();
    });

    res.status(201).json({
      message: "User registered successfully",
      token,
      userId: newUser._id,
      username: newUser.username,
      notificationPreferences: newUser.notificationPreferences,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: "Error registering user", error: err.message });
  }
});

// Login User
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

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

    // Send login notification email
    const loginMailOptions = {
      from: EMAIL_USER,
      to: email,
      subject: 'New Login to Your Account',
      text: Hello ${user.username},\n\nWe detected a new login to your Air Quality Monitor account at ${new Date().toLocaleString()}.\n\nIf this wasn't you, please contact support immediately.\n\nBest regards,\nAir Quality Monitor Team
    };

    await new Promise((resolve, reject) => {
      emailQueue.push({ mailOptions: loginMailOptions, resolve, reject });
      processEmailQueue();
    });

    res.json({
      message: "Login successful",
      token,
      userId: user._id,
      username: user.username,
      notificationPreferences: user.notificationPreferences,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: "Error logging in", error: err.message });
  }
});

// Update User Profile
app.put("/api/user/update", authenticateToken, validateUserInput, async (req, res) => {
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

    // Send profile update confirmation email
    const updateMailOptions = {
      from: EMAIL_USER,
      to: user.email,
      subject: 'Profile Updated Successfully',
      text: Hello ${user.username},\n\nYour Air Quality Monitor profile has been updated successfully at ${new Date().toLocaleString()}.\n\nBest regards,\nAir Quality Monitor Team
    };

    await new Promise((resolve, reject) => {
      emailQueue.push({ mailOptions: updateMailOptions, resolve, reject });
      processEmailQueue();
    });

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
    console.error('Profile update error:', err);
    res.status(500).json({ message: "Error updating profile", error: err.message });
  }
});

// Send Email Notification
app.post("/api/send-email", authenticateToken, async (req, res) => {
  const { userId, subject, message, aqi } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: "Unauthorized to send email for this user" });
    }

    if (!user.notificationPreferences.email) {
      return res.status(400).json({ message: "Email notifications are disabled for this user" });
    }

    // Check if this is an AQI notification
    if (aqi !== undefined) {
      await sendAQINotification(user, aqi);
    } else {
      const mailOptions = {
        from: EMAIL_USER,
        to: user.email,
        subject: subject,
        text: message,
      };

      await new Promise((resolve, reject) => {
        emailQueue.push({ mailOptions, resolve, reject });
        processEmailQueue();
      });
    }

    res.json({ success: true, message: "Email queued successfully" });
  } catch (err) {
    console.error('Email sending error:', err);
    res.status(500).json({ success: false, message: "Failed to send email", error: err.message });
  }
});

// Record Logout
app.post("/api/logout", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (user) {
      user.lastLogout = new Date();
      await user.save();

      // Send logout notification email
      const logoutMailOptions = {
        from: EMAIL_USER,
        to: user.email,
        subject: 'Logged Out Successfully',
        text: Hello ${user.username},\n\nYou have been logged out of your Air Quality Monitor account at ${new Date().toLocaleString()}.\n\nBest regards,\nAir Quality Monitor Team
      };

      await new Promise((resolve, reject) => {
        emailQueue.push({ mailOptions: logoutMailOptions, resolve, reject });
        processEmailQueue();
      });
    }
    res.json({ message: "Logout recorded successfully" });
  } catch (err) {
    console.error('Logout error:', err);
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
    console.error('Profile fetch error:', err);
    res.status(500).json({ message: "Error fetching profile", error: err.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(Server running on port ${PORT});
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
