const Database = require('better-sqlite3');
const db = new Database('quiz.db');

db.pragma('journal_mode = WAL'); // Поддержка внешних ключей

// Создание таблицы
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'participant' -- 'organizer' или 'participant'
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    room_code TEXT UNIQUE NOT NULL,
    created_by INTEGER,
    status TEXT DEFAULT 'draft', -- 'draft', 'active', 'finished'
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER,
    type TEXT DEFAULT 'text',
    question_text TEXT NOT NULL,
    image_url TEXT,
    time_limit INTEGER DEFAULT 30,
    points INTEGER DEFAULT 100,
    answer_mode TEXT DEFAULT 'single',
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER,
    answer_text TEXT NOT NULL,
    is_correct INTEGER DEFAULT 0, -- 0 или 1
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS quiz_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER,
    user_id INTEGER,
    nickname TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

module.exports = db;