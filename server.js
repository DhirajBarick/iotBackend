{
  "name": "iot-backend",
  "version": "1.0.0",
  "description": "Backend for IoT Air Quality Monitoring System",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "bcrypt": "^5.1.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "express-rate-limit": "^6.10.0",
    "jsonwebtoken": "^9.0.2",
    "mongoose": "^7.6.3",
    "nodemailer": "^6.9.9"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=16.0.0"
  },
  "keywords": ["IoT", "Air Quality", "Backend", "Express", "MongoDB"],
  "author": "Your Name",
  "license": "MIT"
}
