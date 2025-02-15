const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const rateLimit = require('express-rate-limit');
const axios = require("axios"); // Added axios for making HTTP requests

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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Request logging middleware
const requestLogger = (req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
};
app.use(requestLogger);

// Connect to MongoDB
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Function to keep the server awake
const keepServerAwake = () => {
  const url = `https://iotbackend-1.onrender.com/health`;
 // Change this to your deployed URL in production
  axios.get(url)
    .then(response => console.log("Keep-alive ping successful:", response.status))
    .catch(err => console.error("Keep-alive ping failed:", err.message));
};

// Run the keep-alive function every 5 minutes
setInterval(keepServerAwake, 300000); // 5 minutes = 300,000ms

// Start Server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  keepServerAwake(); // Call immediately on startup
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
