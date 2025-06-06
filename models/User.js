const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  role: { type: String, enum: ['teacher', 'student'], required: true },
  socketId: { type: String, unique: true, sparse: true } // sparse allows null values for non-connected users
});

module.exports = mongoose.model('User', userSchema);