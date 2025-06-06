const Poll = require('../models/Poll');
const User = require('../models/User');

module.exports = (io, socket) => {
  // Teacher joins
  const handleTeacherJoin = async (teacherName) => {
    try {
      const user = await User.findOneAndUpdate(
        { name: teacherName, role: 'teacher' },
        { socketId: socket.id, lastActive: new Date() },
        { upsert: true, new: true }
      );
      
      socket.emit('teacher-connected', { teacherId: user._id });
      console.log('Teacher connected:', teacherName);
    } catch (err) {
      console.error('Teacher join error:', err);
    }
  };

  // Student joins
  const handleStudentJoin = async (studentName) => {
    try {
      const user = await User.findOneAndUpdate(
        { name: studentName, role: 'student' },
        { socketId: socket.id, lastActive: new Date() },
        { upsert: true, new: true }
      );
      
      socket.emit('student-connected', { studentId: user._id });
      console.log('Student connected:', studentName);
    } catch (err) {
      console.error('Student join error:', err);
    }
  };

  // Create new poll
  const handleCreatePoll = async (pollData) => {
    try {
      const { question, options, duration, teacherId } = pollData;
      const poll = new Poll({
        question,
        options: options.map(opt => ({ text: opt })),
        duration: 3600,
        createdBy: teacherId,
        isActive: true
      });

      await poll.save();
      
      // Emit to all connected users
      io.emit('new-poll', poll);
      console.log('New poll created:', poll._id);

      // Schedule poll end
      setTimeout(async () => {
        const updatedPoll = await Poll.findByIdAndUpdate(
          poll._id,
          { isActive: false, endTime: new Date() },
          { new: true }
        );
        
        if (updatedPoll) {
          io.emit('poll-ended', updatedPoll);
          console.log('Poll ended:', updatedPoll._id);
        }
      }, duration * 1000);
    } catch (err) {
      console.error('Create poll error:', err);
    }
  };

  // Submit answer
  const handleSubmitAnswer = async ({ pollId, optionIndex, studentId, studentName }) => {
    try {
      const poll = await Poll.findById(pollId);
      if (!poll || !poll.isActive) return;

      // Remove previous answer if exists
      const existingAnswerIndex = poll.answers.findIndex(a => a.studentId === studentId);
      if (existingAnswerIndex >= 0) {
        const prevAnswer = poll.answers[existingAnswerIndex];
        poll.options[prevAnswer.optionIndex].votes--;
        poll.answers.splice(existingAnswerIndex, 1);
      }

      // Add new answer
      poll.options[optionIndex].votes++;
      poll.answers.push({
        studentId,
        studentName,
        optionIndex
      });

      const updatedPoll = await poll.save();
      io.emit('poll-update', updatedPoll);
    } catch (err) {
      console.error('Submit answer error:', err);
    }
  };

  // Kick student
  const handleKickStudent = async (studentSocketId) => {
    try {
      const user = await User.findOneAndUpdate(
        { socketId: studentSocketId },
        { $unset: { socketId: 1 } }
      );
      
      if (user) {
        io.to(studentSocketId).emit('kicked');
        console.log('Student kicked:', user.name);
      }
    } catch (err) {
      console.error('Kick student error:', err);
    }
  };

  // Get past polls
  const handleGetPastPolls = async (teacherId) => {
    try {
      const polls = await Poll.find({ createdBy: teacherId, isActive: false })
        .sort({ createdAt: -1 })
        .limit(10);
      socket.emit('past-polls', polls);
    } catch (err) {
      console.error('Get past polls error:', err);
    }
  };

  socket.on('teacher-join', handleTeacherJoin);
  socket.on('student-join', handleStudentJoin);
  socket.on('create-poll', handleCreatePoll);
  socket.on('submit-answer', handleSubmitAnswer);
  socket.on('kick-student', handleKickStudent);
  socket.on('get-past-polls', handleGetPastPolls);
};