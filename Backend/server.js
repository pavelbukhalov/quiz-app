const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

const SECRET_KEY = 'super_secret_key_for_university_project';

app.post('/api/register', (req, res) => { // Авторизация и Регистрация
  const { username, password, role } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 8);
  try {
    const stmt = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
    stmt.run(username, hashedPassword, role || 'participant');
    res.json({ message: 'Пользователь зарегистрирован' });
  } catch (e) {
    res.status(400).json({ message: 'Пользователь уже существует' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ message: 'Неверный логин или пароль' });
  }
  const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

const auth = (req, res, next) => { // Middleware для проверки токена
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ message: 'Токен не предоставлен' });
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ message: 'Невалидный токен' });
  }
};

app.post('/api/quizzes', auth, (req, res) => { // Управление квизами (для организатора)
  if (req.user.role !== 'organizer') return res.status(403).json({ message: 'Только организаторы' });
  const { title, description } = req.body;
  const roomCode = Math.floor(100000 + Math.random() * 900000).toString(); // Генерация 6-значного кода
  const stmt = db.prepare('INSERT INTO quizzes (title, description, room_code, created_by) VALUES (?, ?, ?, ?)');
  const result = stmt.run(title, description, roomCode, req.user.id);
  res.json({ id: result.lastInsertRowid, roomCode });
});

app.get('/api/quizzes/my', auth, (req, res) => {
  const quizzes = db.prepare('SELECT * FROM quizzes WHERE created_by = ?').all(req.user.id);
  res.json(quizzes);
});

app.delete('/api/quizzes/:id', auth, (req, res) => {
  if (req.user.role !== 'organizer') return res.status(403).json({ message: 'Только организаторы' });
  
  try {
    db.prepare('DELETE FROM quiz_participants WHERE quiz_id = ?').run(req.params.id); 
    
    const questions = db.prepare('SELECT id FROM questions WHERE quiz_id = ?').all(req.params.id); 
    
    questions.forEach(q => {
      db.prepare('DELETE FROM answers WHERE question_id = ?').run(q.id);
    });
    
    db.prepare('DELETE FROM questions WHERE quiz_id = ?').run(req.params.id);
    
    const result = db.prepare('DELETE FROM quizzes WHERE id = ? AND created_by = ?').run(req.params.id, req.user.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ message: 'Квиз не найден' });
    }
    
    console.log(`Квиз ${req.params.id} удалён`);
    res.json({ message: 'Квиз удалён' });
  } catch (error) {
    console.error(' Ошибка удаления квиза:', error);
    res.status(500).json({ message: 'Ошибка сервера: ' + error.message });
  }
});

app.get('/api/participant/history', auth, (req, res) => {
  console.log(' Запрос истории участника, userId:', req.user.id);
  const history = db.prepare(`
    SELECT 
      qp.id,
      q.title as quiz_title,
      q.room_code,
      q.status,
      qp.score,
      qp.nickname,
      (SELECT COUNT(*) FROM quiz_participants WHERE quiz_id = q.id) as total_participants
    FROM quiz_participants qp
    JOIN quizzes q ON qp.quiz_id = q.id
    WHERE qp.user_id = ?
    ORDER BY qp.id DESC
  `).all(req.user.id);
  console.log('Найдено записей:', history.length);
  res.json(history);
});

app.post('/api/quizzes/:id/questions', auth, (req, res) => {
  console.log('Добавление вопроса к квизу:', req.params.id);
  console.log('Данные вопроса:', req.body);
  
  const { type, question_text, image_url, time_limit, points, answers, answer_mode } = req.body;
  
  if (!answers || answers.length === 0) {
    return res.status(400).json({ message: 'Нет вариантов ответа' });
  }
  
  try {
    const insertQuestion = db.prepare(`
      INSERT INTO questions (quiz_id, type, question_text, image_url, time_limit, points, answer_mode) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = insertQuestion.run(
      req.params.id, 
      type, 
      question_text, 
      image_url, 
      time_limit, 
      points, 
      answer_mode || 'single'
    );
    
    console.log('Вопрос добавлен с ID:', result.lastInsertRowid);
    
    const insertAnswer = db.prepare('INSERT INTO answers (question_id, answer_text, is_correct) VALUES (?, ?, ?)');
    answers.forEach((ans, idx) => {
      insertAnswer.run(result.lastInsertRowid, ans.text, ans.is_correct ? 1 : 0);
      console.log(`  - Ответ ${idx + 1}: "${ans.text}" (правильный: ${ans.is_correct})`);
    });
    
    res.json({ message: 'Вопрос добавлен', questionId: result.lastInsertRowid });
  } catch (error) {
    console.error(' Ошибка добавления вопроса:', error);
    res.status(500).json({ message: 'Ошибка сервера: ' + error.message });
  }
});

const rooms = {}; // Хранение состояния комнат в памяти
const participantAnswers = {};

io.on('connection', (socket) => { // Логика игры в реальном времени
  console.log('User connected:', socket.id);

  socket.on('join_room', (data) => { // Присоед. к комнате
    const { roomCode, nickname, userId } = data;
    const quiz = db.prepare('SELECT * FROM quizzes WHERE room_code = ?').get(roomCode);
    
    if (!quiz) return socket.emit('error', { message: 'Комната не найдена' });
    if (quiz.status === 'finished') return socket.emit('error', { message: 'Квиз уже завершен' });

    if (!rooms[roomCode]) {
      rooms[roomCode] = { quiz, participants: [], currentQuestionIndex: -1 };
    }

    const existing = rooms[roomCode].participants.find(p => p.userId === userId); // Сохранение участника в БД и в памяти
    if (!existing) {
      const stmt = db.prepare('INSERT INTO quiz_participants (quiz_id, user_id, nickname, score) VALUES (?, ?, ?, 0)');
      stmt.run(quiz.id, userId, nickname);
      rooms[roomCode].participants.push({ socketId: socket.id, userId, nickname, score: 0 });
    } else {
      existing.socketId = socket.id; // Обновление socketId при переподключении
    }

    socket.join(roomCode);
    socket.emit('room_joined', { roomCode, participants: rooms[roomCode].participants });
    io.to(roomCode).emit('update_participants', rooms[roomCode].participants);
  });

  socket.on('start_game', (data) => {
    const { roomCode } = data;
    console.log('Запуск игры в комнате:', roomCode);
    
    if (!rooms[roomCode]) {
      console.log('Комната не найдена');
      return;
    }
    
    rooms[roomCode].currentQuestionIndex = -1;
    console.log(' Индекс вопросов сброшен');
    
    rooms[roomCode].quiz.status = 'active';
    db.prepare('UPDATE quizzes SET status = ? WHERE room_code = ?').run('active', roomCode);
    
    nextQuestion(roomCode);
  });

  socket.on('next_question', (data) => { // переключение на след. вопрос
    nextQuestion(data.roomCode);
  });


  // Участник отправляет ответ
  socket.on('submit_answer', (data) => {
    const { roomCode, questionId, answerId } = data;
    const room = rooms[roomCode];
    if (!room) return;

    const participant = room.participants.find(p => p.socketId === socket.id);
    if (!participant) return;

    const question = db.prepare('SELECT answer_mode, points FROM questions WHERE id = ?').get(questionId);
    const answerMode = question.answer_mode || 'single';
    const questionPoints = question.points;

    console.log(`Ответ от ${participant.nickname}: вопрос ${questionId}, режим ${answerMode}, ответ ${answerId}`);

    if (answerMode === 'single') { // Одиночный выбор
      const correctAnswer = db.prepare('SELECT is_correct FROM answers WHERE id = ?').get(answerId);
      const isCorrect = correctAnswer && correctAnswer.is_correct === 1;

      if (isCorrect) {
        participant.score += questionPoints;
        db.prepare('UPDATE quiz_participants SET score = ? WHERE user_id = ? AND quiz_id = ?')
          .run(participant.score, participant.userId, room.quiz.id);
        console.log(`Правильно! +${questionPoints} баллов. Всего: ${participant.score}`);
      }

      socket.emit('answer_result', { isCorrect });

    } else { // Множественный выбор
      const answerKey = `${roomCode}_${participant.userId}_${questionId}`;
      
      console.log(`answerKey при сохранении:`, answerKey);
      console.log(`  roomCode:`, roomCode);
      console.log(`  userId:`, participant.userId);
      console.log(`  questionId:`, questionId);
      
      if (!participantAnswers[answerKey]) {
        participantAnswers[answerKey] = [];
      }
      
      if (!participantAnswers[answerKey].includes(answerId)) {
        participantAnswers[answerKey].push(answerId);
        console.log(` Накопленные ответы:`, participantAnswers[answerKey]);
        console.log(`Все ключи в participantAnswers:`, Object.keys(participantAnswers));
      }
    }

    io.to(roomCode).emit('update_scores', room.participants.map(p => ({ 
      nickname: p.nickname, 
      score: p.score 
    })));
  });

  socket.on('finish_game', (data) => {
    const { roomCode } = data;
    console.log('Завершение игры в комнате:', roomCode);
    
    const room = rooms[roomCode];
    if (!room) {
      console.log('Комната не найдена');
      return;
    }

    room.quiz.status = 'finished'; // Обновление статуса квиза в БД
    db.prepare('UPDATE quizzes SET status = ? WHERE room_code = ?').run('finished', roomCode);
    console.log('Статус квиза изменён на "finished"');
    
    const leaderboard = room.participants.sort((a, b) => b.score - a.score); // Сортировка участников
    
    // Отправка результатов
    io.to(roomCode).emit('game_finished', leaderboard);
    console.log('Результаты отправлены:', leaderboard);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

function nextQuestion(roomCode) {
  const room = rooms[roomCode];
  if (!room) {
    console.log('Комната не найдена:', roomCode);
    return;
  }

  console.log(' Текущий индекс вопроса:', room.currentQuestionIndex);
  
  const prevIndex = room.currentQuestionIndex;
  
  if (prevIndex >= 0) {
    const questions = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY id').all(room.quiz.id);
    
    if (prevIndex < questions.length) {
      const prevQuestion = questions[prevIndex];
      
      console.log('Проверка вопроса', prevQuestion.id, 'с индексом', prevIndex);
      console.log('Режим ответа:', prevQuestion.answer_mode);
      console.log('Все ключи в participantAnswers ПЕРЕД проверкой:', Object.keys(participantAnswers));
      
      if (prevQuestion.answer_mode === 'multiple') {
        console.log('Проверка ответов на вопрос с множественным выбором...');
        console.log('Вопрос ID:', prevQuestion.id);
        
        const correctAnswers = db.prepare('SELECT id FROM answers WHERE question_id = ? AND is_correct = 1')
            .all(prevQuestion.id);
        const correctAnswerIds = correctAnswers.map(a => a.id);
        
        console.log('Правильные ответы (ID):', correctAnswerIds);
        
        const pointsPerCorrect = prevQuestion.points / correctAnswerIds.length;
        console.log('Баллов за каждый правильный ответ:', pointsPerCorrect);
        
        room.participants.forEach(participant => {
          const answerKey = `${roomCode}_${participant.userId}_${prevQuestion.id}`;
          console.log(`Проверка ключа:`, answerKey);
          console.log(`participant.userId:`, participant.userId);
          console.log(`prevQuestion.id:`, prevQuestion.id);
          
          const selectedAnswers = participantAnswers[answerKey] || [];
          console.log(`Выбранные ответы:`, selectedAnswers);
          
          const correctSelected = selectedAnswers.filter(id => correctAnswerIds.includes(id));
          console.log(`Правильно выбрано:`, correctSelected.length);
          
          const pointsToAdd = correctSelected.length * pointsPerCorrect;
          
          if (pointsToAdd > 0) {
            participant.score += pointsToAdd;
            db.prepare('UPDATE quiz_participants SET score = ? WHERE user_id = ? AND quiz_id = ?')
              .run(participant.score, participant.userId, room.quiz.id);
            console.log(`Начислено ${pointsToAdd} баллов. Всего: ${participant.score}`);
          } else {
              console.log(`Баллы не начислены`);
          }
          
          delete participantAnswers[answerKey];
          console.log(`Ключ удален, осталось ключей:`, Object.keys(participantAnswers));
        });
      }
    }
  }
  
  room.currentQuestionIndex++;
  
  const questions = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY id').all(room.quiz.id);
  
  console.log('Всего вопросов в квизе:', questions.length);
  console.log('Новый индекс:', room.currentQuestionIndex);
  
  if (questions.length === 0) {
    console.log('В квизе НЕТ вопросов!');
    io.to(roomCode).emit('game_finished', []);
    return;
  }

  if (room.currentQuestionIndex >= questions.length) {
    console.log('Вопросы закончились! Завершаем игру...');
    
    const lastQuestionIndex = room.currentQuestionIndex - 1;
    if (lastQuestionIndex >= 0 && lastQuestionIndex < questions.length) {
      const lastQuestion = questions[lastQuestionIndex];
      
      if (lastQuestion.answer_mode === 'multiple') {
        console.log('Проверка ПОСЛЕДНЕГО вопроса с множественным выбором...');
        console.log('Вопрос ID:', lastQuestion.id);
        console.log('Все ключи:', Object.keys(participantAnswers));
        
        const correctAnswers = db.prepare('SELECT id FROM answers WHERE question_id = ? AND is_correct = 1')
          .all(lastQuestion.id);
        const correctAnswerIds = correctAnswers.map(a => a.id);
        
        const pointsPerCorrect = lastQuestion.points / correctAnswerIds.length;
        
        room.participants.forEach(participant => {
          const answerKey = `${roomCode}_${participant.userId}_${lastQuestion.id}`;
          const selectedAnswers = participantAnswers[answerKey] || [];
          
          const correctSelected = selectedAnswers.filter(id => correctAnswerIds.includes(id));
          const pointsToAdd = correctSelected.length * pointsPerCorrect;
          
          if (pointsToAdd > 0) {
            participant.score += pointsToAdd;
            db.prepare('UPDATE quiz_participants SET score = ? WHERE user_id = ? AND quiz_id = ?')
              .run(participant.score, participant.userId, room.quiz.id);
            console.log(`  ${participant.nickname}: +${pointsToAdd} баллов`);
          }
          
          delete participantAnswers[answerKey];
        });
      }
    }
    
    room.quiz.status = 'finished';
    db.prepare('UPDATE quizzes SET status = ? WHERE room_code = ?').run('finished', roomCode);
    console.log('Статус квиза изменён на "finished"');
    
    io.to(roomCode).emit('game_finished', room.participants.sort((a, b) => b.score - a.score));
    return;
  }

  const currentQ = questions[room.currentQuestionIndex];
  console.log('Текущий вопрос:', currentQ.question_text);
  console.log('Режим ответа:', currentQ.answer_mode);
  
  const answers = db.prepare('SELECT id, answer_text FROM answers WHERE question_id = ?').all(currentQ.id);

  io.to(roomCode).emit('new_question', {
    question: currentQ,
    answers: answers,
    timeLimit: currentQ.time_limit
  });
  
  console.log('Вопрос отправлен всем участникам!');
  
  if (room.timer) {
    clearTimeout(room.timer);
  }
  
  room.timer = setTimeout(() => {
    console.log(`Время на вопрос ${currentQ.id} вышло!`);
    nextQuestion(roomCode);
  }, currentQ.time_limit * 1000);
}

// Запуск сервера
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});