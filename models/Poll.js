const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  isCorrect: { type: Boolean, default: false },
  votes: { type: Number, default: 0 },
  _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() }
});

const answerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, required: true },
  optionId: { type: mongoose.Schema.Types.ObjectId, required: true }
});

const pollSchema = new mongoose.Schema({
  question: { type: String, required: true },
  unique_id: {
    type: String,
    required: true,
  },
  options: [optionSchema],
  timer: { type: Number, default: 60 }, // Match your API
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },
  isActive: { type: Boolean, default: true },
  answers: [String],
  kickedParticipants: {
    type: [String],
    default: []
  }
}, { timestamps: true });

module.exports = mongoose.model('Poll', pollSchema);
