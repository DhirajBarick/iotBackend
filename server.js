const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || "airqualitymonitor2025secret";
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

// Initialize Express App
const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/airQualityDB", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("Connected to MongoDB"));

// Email Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

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

// API Routes

// Register User
app.post("/api/register", async (req, res) => {
  const { username, email, password, name } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }

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

    res.status(201).json({
      message: "User registered successfully",
      token,
      userId: newUser._id,
      username: newUser.username,
      notificationPreferences: newUser.notificationPreferences,
    });
  } catch (err) {
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

    await user.save();

    res.json({
      message: "Profile updated successfully",
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        email: user.email,
        notificationPreferences: user.notificationPreferences,
      },
    });
  } catch (err) {
    console.error("Profile update error:", err.message);
    res.status(500).json({ message: "Error updating profile", error: err.message });
  }
});

// Send Email Notification
app.post("/api/send-email", authenticateToken, async (req, res) => {
  const { userId, subject, message } = req.body;

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

    const mailOptions = {
      from: EMAIL_USER,
      to: user.email,
      subject: subject,
      text: message,
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: "Email sent successfully" });
  } catch (err) {
    console.error("Email sending error:", err.message);
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

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
