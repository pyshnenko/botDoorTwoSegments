# Gate Controller Server

**Gate Controller Server** — это серверная часть для управления воротами Raspberry Pi через Telegram-бота.

Проект использует:
- TypeScript
- Telegraf для Telegram-бота
- WebSocket-сервер для связи с Raspberry Pi
- MySQL через Sequelize
- Redis для кэширования пользователей
- PM2 для продакшн-развертывания

## Возможности

- Авторизация через Telegram
- Роли пользователей: `admin`, `user`, `pending`
- Управление воротами: `Открыть`, `Закрыть`
- Админ-панель для управления заявками и пользователями
- Логирование действий в базе данных
- Удаление старых логов старше 30 дней

## Установка

```bash
npm install
```

## Конфигурация

Создайте файл `.env` в корне проекта с нужными переменными окружения:

```env
TGBOT=ваш_telegram_bot_token
WS_PORT=48008
DB_HOST=localhost
DB_NAME=database_name
DB_USER=database_user
DB_PASS=database_password
```

## Запуск

Для разработки:

```bash
npm run dev
```

Для сборки и запуска в продакшене:

```bash
npm run build
npm start
```

## PM2

Для запуска через PM2 используется `ecosystem.config.js`.

```bash
pm install -g pm2
pm start pm2
```

## Структура проекта

- `src/index.ts` — основная логика сервера и бот
- `src/models/User.ts` — модель пользователя
- `src/models/Log.ts` — модель логов
- `ecosystem.config.js` — конфигурация PM2

## Зависимости

- axios
- dotenv
- mysql2
- redis
- sequelize
- socks-proxy-agent
- telegraf
- ws

## Автор

**Автор: pyshnenko**
