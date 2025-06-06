const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect('mongodb://localhost:27017/polling-system', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const Poll = require('./models/Poll');
const User = require('./models/User');

const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const activeUsers = {};

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  socket.on('teacher-join', async (teacherName) => {
    try {
      const user = new User({
        name: teacherName,
        role: 'teacher',
        socketId: socket.id
      });
      await user.save();
      
      activeUsers[socket.id] = user;
      socket.emit('teacher-connected', { userId: user._id });
    } catch (err) {
      console.error('Teacher join error:', err);
    }
  });

  // Student joins
  socket.on('student-join', async (studentName) => {
    try {
      const user = new User({
        name: studentName,
        role: 'student',
        socketId: socket.id
      });
      await user.save();
      
      activeUsers[socket.id] = user;
      socket.emit('student-connected', { userId: user._id });
      
      // Notify teacher about new student
      io.emit('student-joined', user);
    } catch (err) {
      console.error('Student join error:', err);
    }
  });

  // Create new poll
  socket.on('create-poll', async (pollData) => {
    try {
      const poll = new Poll({
        ...pollData,
        createdBy: activeUsers[socket.id]._id,
        isActive: true
      });
      await poll.save();
      
      io.emit('new-poll', poll);
      
      // Auto-end poll after duration
      setTimeout(async () => {
        const updatedPoll = await Poll.findByIdAndUpdate(
          poll._id,
          { isActive: false, endTime: new Date() },
          { new: true }
        );
        if (updatedPoll) {
          io.emit('poll-ended', updatedPoll);
        }
      }, pollData.duration * 1000);
    } catch (err) {
      console.error('Create poll error:', err);
    }
  });

  // Submit answer
  socket.on('submit-answer', async ({ pollId, optionIndex }) => {
    try {
      const user = activeUsers[socket.id];
      if (!user) return;
      
      const poll = await Poll.findById(pollId);
      if (!poll || !poll.isActive) return;
      
      // Remove previous answer if exists
      const existingAnswer = poll.answers.find(a => a.userId.equals(user._id));
      if (existingAnswer) {
        poll.options[existingAnswer.optionIndex].votes--;
        poll.answers = poll.answers.filter(a => !a.userId.equals(user._id));
      }
      
      // Add new answer
      poll.options[optionIndex].votes++;
      poll.answers.push({
        userId: user._id,
        userName: user.name,
        optionIndex
      });
      
      const updatedPoll = await poll.save();
      io.emit('poll-update', updatedPoll);
    } catch (err) {
      console.error('Submit answer error:', err);
    }
  });

  // Kick student
  socket.on('kick-student', (studentSocketId) => {
    if (activeUsers[studentSocketId]?.role === 'student') {
      io.to(studentSocketId).emit('kicked');
      delete activeUsers[studentSocketId];
    }
  });

  // Get past polls
  socket.on('get-past-polls', async (teacherId) => {
    try {
      const polls = await Poll.find({ createdBy: teacherId, isActive: false })
        .sort({ createdAt: -1 });
      socket.emit('past-polls', polls);
    } catch (err) {
      console.error('Get past polls error:', err);
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    delete activeUsers[socket.id];
    console.log('User disconnected:', socket.id);
  });
});

// REST API Routes
app.get('/api/active-students', async (req, res) => {
  try {
    const students = Object.values(activeUsers)
      .filter(user => user.role === 'student');
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


let activeQuestion = null;
let responses = {};


app.post('/api/questions', async (req, res) => {
  try {
    const { question, options, timer, createdBy } = req.body;

    const unique_id = Date.now().toString(); // Use timestamp as string

    const poll = new Poll({
      question,
      options,
      timer,
      createdBy,
      isActive: true,
      unique_id
    });

    await poll.save();

    res.json({ success: true, pollId: poll._id, unique_id });
  } catch (err) {
    console.error('Error creating poll:', err);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});


// Helper function to check if poll is active based on timestamp difference
function isPollActive(poll, currentTimestamp) {
  const pollCreationTime = parseInt(poll.unique_id);
  const hoursDifference = (currentTimestamp - pollCreationTime) / (1000 * 60 * 60);
  return hoursDifference < 1;
}

//  GET endpoint to check active poll
app.get('/api/questions/active', async (req, res) => {

  try {
    const currentTimestamp = req.query.timestamp || Date.now();
    const latestPoll = await Poll.findOne()
                              .sort({ createdAt: -1 })
                              .limit(1);
    
    if (!latestPoll) {
      return res.json({ 
        isActive: false,
        message: 'No polls available' 
      });
    }

    const active = isPollActive(latestPoll, parseInt(currentTimestamp));
    
    res.json({ 
      isActive: active,
      poll: active ? latestPoll : null,
      message: active ? 
        'Active poll available' : 
        'No active polls (poll is older than 1 hour)'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check active poll' });
  }
});

app.post('/api/questions', async (req, res) => {
  try {
    const { question, options, timer, createdBy } = req.body;

    const unique_id = Date.now().toString(); // Store as string

    const poll = new Poll({
      question,
      options,
      timer,
      createdBy,
      unique_id,  // This serves as both ID and creation timestamp
      createdAt: new Date()  // Also store proper date object
    });

    await poll.save();

    res.json({ success: true, pollId: poll._id, unique_id });
  } catch (err) {
    console.error('Error creating poll:', err);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

app.post('/api/submit', async (req, res) => {;

  const { questionId, optionId, userName } = req.body;

  // Validate required fields
  if (!questionId || !optionId || !userName) {
    console.error('[2] Missing fields:', { questionId, optionId, userName });
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const poll = await Poll.findOne({ unique_id: questionId });

    if (!poll) {
      console.error('[4] Poll not found for unique_id:', questionId);
      return res.status(404).json({ error: 'Poll not found' });
    }

    if (!poll.isActive) {
      console.error('[5] Poll is inactive:', poll._id);
      return res.status(400).json({ error: 'Poll is inactive' });
    }

    const selectedOption = poll.options.find(
      opt => opt.text === optionId || opt._id.toString() === optionId
    );

    if (!selectedOption) {
      return res.status(400).json({ error: 'Invalid option selected' });
    }


    const voteKey = `${userName}:${selectedOption._id.toString()}`;
    const alreadyVoted = poll.answers.some(answer => answer.startsWith(`${userName}:`));

    if (alreadyVoted) {
      console.error('[9] User already voted:', userName);
      return res.status(400).json({ error: 'You have already voted!' });
    }

    // Increment vote
    selectedOption.votes++;
    poll.markModified('options'); 
    poll.answers.push(voteKey);
    await poll.save();

    res.json({ success: true });
  } catch (err) {
    console.error('[12] ERROR:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to submit answer' });
  }
});

app.get('/api/results', async (req, res) => {
  try {
    const poll = await Poll.findOne({ isActive: true }).sort({ createdAt: -1 });

    if (!poll) {
      return res.status(404).json({ error: 'No active question' });
    }

    const totalVotes = poll.options.reduce((sum, opt) => sum + opt.votes, 0);
    const unique = poll.unique_id;

    const formattedOptions = poll.options.map(opt => ({
      text: opt.text,
      percentage: totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0,
      isCorrect: opt.isCorrect
    }));

    // Extract participants and filter out kicked ones
    const participants = poll.answers.map(answer => {
      const parts = answer.split(':');
      return parts[0];
    }).filter(name => !poll.kickedParticipants.includes(name));

    const uniqueParticipants = [...new Set(participants)];

    res.json({
      question: poll.question,
      options: formattedOptions,
      timer: poll.timer,
      totalResponses: totalVotes,
      unique_id: unique,
      participants: uniqueParticipants
    });

  } catch (err) {
    console.error('Error fetching results:', err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

app.get('/api/past-questions', async (req, res) => {
  try {
    const pastPolls = await Poll.find({ isActive: false }).sort({ createdAt: -1 });
    res.json(pastPolls);
  } catch (err) {
    console.error('Error fetching past polls:', err);
    res.status(500).json({ error: 'Failed to fetch past polls' });
  }
});

app.get('/api/polls/history', async (req, res) => {
  try {
    const polls = await Poll.find()
      .sort({ createdAt: -1 }) // Newest first
      .limit(50); // Limit to 50 most recent polls

    // Format the data for frontend
    const formattedPolls = polls.map(poll => {
      // Calculate total votes for the current poll
      const totalVotes = poll.options.reduce((sum, opt) => sum + opt.votes, 0);

      return {
        question: poll.question,
        options: poll.options.map(opt => ({
          text: opt.text,
          // Ensure percentage is calculated based on this poll's totalVotes
          percentage: totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0,
          isCorrect: opt.isCorrect || false
        })),
        totalVotes: totalVotes, // <--- ADD THIS LINE: Include totalVotes for each poll
        createdAt: poll.createdAt
      };
    });

    res.json(formattedPolls);
  } catch (err) {
    console.error('Error fetching poll history:', err);
    res.status(500).json({ error: 'Failed to fetch poll history' });
  }
});

app.post('/api/kickParticipant', async (req, res) => {
  try {
    const { participantName } = req.body;

    // Find the most recent poll (sorted by createdAt in descending order)
    const recentPoll = await Poll.findOne().sort({ createdAt: -1 });

    if (!recentPoll) {
      return res.status(404).json({ error: 'No polls found' });
    }

    // Update the most recent poll with the kicked participant
    const updatedPoll = await Poll.findOneAndUpdate(
      { _id: recentPoll._id },
      { $addToSet: { kickedParticipants: participantName } },
      { new: true }
    );

    res.json({ 
      success: true,
      pollId: updatedPoll._id,
      kickedParticipants: updatedPoll.kickedParticipants
    });
  } catch (err) {
    console.error('Error kicking participant:', err);
    res.status(500).json({ error: 'Failed to kick participant' });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});