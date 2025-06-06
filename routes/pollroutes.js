const express = require('express');
const Poll = require('../models/Poll');
const router = express.Router();

// Get all polls for a teacher
router.get('/teacher/:teacherId', async (req, res) => {
  try {
    const polls = await Poll.find({ createdBy: req.params.teacherId })
      .sort({ createdAt: -1 });
    res.json(polls);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get a specific poll
router.get('/:id', async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ message: 'Poll not found' });
    res.json(poll);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;