const API_BASE = 'http://localhost:3000/api';

const api = {
    async register(username, password, role) { // Регистрация
        const response = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });
        return await response.json();
    },

    async login(username, password) { // Авторизация
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (data.token) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
        }
        return data;
    },

    getUser() { // Для получения текущего пользователя
        const user = localStorage.getItem('user');
        return user ? JSON.parse(user) : null;
    },

    getToken() { // Для получения токен
        return localStorage.getItem('token');
    },

    logout() { // Для выхода
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'index.html';
    },

    async createQuiz(title, description) { // Создание квиза
        const response = await fetch(`${API_BASE}/quizzes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': this.getToken()
            },
            body: JSON.stringify({ title, description })
        });
        return await response.json();
    },

    async getMyQuizzes() { // Получение моих квизов
        const response = await fetch(`${API_BASE}/quizzes/my`, {
            headers: { 'Authorization': this.getToken() }
        });
        return await response.json();
    },

    async addQuestion(quizId, questionData) { // Добавление вопроса к квизу
        const response = await fetch(`${API_BASE}/quizzes/${quizId}/questions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': this.getToken()
            },
            body: JSON.stringify(questionData)
        });
        return await response.json();
    },

    async getParticipantHistory() {
        const response = await fetch(`${API_BASE}/participant/history`, {
            headers: { 'Authorization': this.getToken() }
        });
        return await response.json();
    },

    async deleteQuiz(quizId) {
        const response = await fetch(`${API_BASE}/quizzes/${quizId}`, {
            method: 'DELETE',
            headers: { 'Authorization': this.getToken() }
        });
        return await response.json();
    }
};