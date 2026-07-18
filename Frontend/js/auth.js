document.addEventListener('DOMContentLoaded', () => { // Переключение между вкладками
    const tabBtns = document.querySelectorAll('.tab-btn');
    const forms = document.querySelectorAll('.auth-form');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            tabBtns.forEach(b => b.classList.remove('active'));
            forms.forEach(f => f.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(`${tab}-form`).classList.add('active');
        });
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => { // Обработка входа
        e.preventDefault();
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const errorDiv = document.getElementById('error-message');

        try {
            const result = await api.login(username, password);
            if (result.token) {
                const user = api.getUser();
                if (user.role === 'organizer') {
                    window.location.href = 'dashboard.html';
                } else {
                    window.location.href = 'participant-dashboard.html';
                }
            } else {
                errorDiv.textContent = result.message || 'Ошибка входа';
            }
        } catch (error) {
            errorDiv.textContent = 'Ошибка соединения с сервером';
        }
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => { // Обработка регистрации
        e.preventDefault();
        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        const role = document.getElementById('register-role').value;
        const errorDiv = document.getElementById('error-message');

        try {
            const result = await api.register(username, password, role);
            if (result.message === 'Пользователь зарегистрирован') {
                alert('Регистрация успешна! Теперь войдите.');
                tabBtns[0].click(); // Переключение на вкладку входа
            } else {
                errorDiv.textContent = result.message || 'Ошибка регистрации';
            }
        } catch (error) {
            errorDiv.textContent = 'Ошибка соединения с сервером';
        }
    });
});