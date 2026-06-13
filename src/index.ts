import { Telegraf, Markup } from 'telegraf';
import { WebSocketServer, WebSocket } from 'ws';
import { User, sequelize } from './models/User';
import dotenv from 'dotenv';
import { Log } from './models/Log';
import { Sequelize, DataTypes, Model, Op } from 'sequelize';

dotenv.config();

/**
 * ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
 */
let rpiSocket: WebSocket | null = null;

async function bootstrap() {
    console.log('>>> Инициализация сервера...');

    try {
        // 1. Подключение к БД
        await sequelize.authenticate();
        await sequelize.sync();
        await Log.sync();
        console.log('>>> БД: MySQL подключена и синхронизирована');
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await Log.destroy({
            where: {
                createdAt: { [Op.lt]: thirtyDaysAgo }
            }
        });
        console.log('>>> СИСТЕМА: Старые логи удалены');

        const bot = new Telegraf(process.env.TGBOT!); // Добавьте { telegram: { agent } } если вернете прокси

        // 3. WebSocket Сервер для Raspberry Pi
        const wss = new WebSocketServer({ port: Number(process.env.WS_PORT) || 48008 });
        console.log(`>>> WS: Сервер запущен на порту ${process.env.WS_PORT || 48008}`);

        wss.on('connection', (ws) => {
            console.log('>>> WS: Raspberry Pi подключилась');
            rpiSocket = ws;

            ws.on('close', () => {
                console.log('>>> WS: Raspberry Pi отключилась');
                rpiSocket = null;
            });

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    console.log('>>> WS: Ответ от RPi:', msg);
                } catch (e) {
                    console.error('>>> WS: Ошибка парсинга сообщения');
                }
            });
        });

        /**
         * ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
         */
        const mainKeyboard = (role: string) => {
            const buttons = [['Открыть', 'Закрыть']];
            if (role === 'admin') buttons.push(['Управление']);
            return Markup.keyboard(buttons).resize();
        };

        const sendToPi = async (action: string): Promise<any> => {
            if (!rpiSocket || rpiSocket.readyState !== WebSocket.OPEN) {
                return { error: 'Raspberry Pi не в сети' };
            }

            return new Promise((resolve) => {
                const payload = JSON.stringify({ action, timestamp: Date.now() });
                rpiSocket?.send(payload);

                const timer = setTimeout(() => resolve({ error: 'Таймаут: Raspberry не ответила' }), 7000);

                rpiSocket?.once('message', (data) => {
                    clearTimeout(timer);
                    try {
                        const resp = JSON.parse(data.toString());
                        // Возвращаем либо весь объект данных, либо сообщение об успехе
                        resolve(resp.data || { success: true, message: resp.message });
                    } catch (e) {
                        resolve({ error: 'Ошибка парсинга ответа' });
                    }
                });
            });
        };

        /**
         * ЛОГИКА ТЕЛЕГРАМ БОТА
         */

        bot.start(async (ctx) => {
            console.log(`>>> БОТ: Получен /start от ${ctx.from.id}`);
            const tgId = ctx.from.id;
            const username = ctx.from.username || `user_${tgId}`;

            let user = await User.findOne({ where: { tgId } });
            const totalUsers = await User.count();

            if (totalUsers === 0) {
                user = await User.create({ tgId, username, role: 'admin' });
                return ctx.reply('Вы — первый пользователь и назначены Администратором!', mainKeyboard('admin'));
            }

            if (!user) {
                await User.create({ tgId, username, role: 'pending' });
                return ctx.reply('Вас нет в базе. Отправить заявку администратору?', 
                    Markup.inlineKeyboard([Markup.button.callback('✅ Подать заявку', 'apply_request')])
                );
            }

            if (user.role === 'pending') return ctx.reply('Ваша заявка всё еще на рассмотрении.');
            
            return ctx.reply(`Привет, ${username}!`, mainKeyboard(user.role));
        });

        bot.action('apply_request', async (ctx) => {
            await ctx.answerCbQuery('Заявка отправлена!');
            await ctx.editMessageText('Ожидайте одобрения администратором.');
            
            const admins = await User.findAll({ where: { role: 'admin' } });
            for (const admin of admins) {
                bot.telegram.sendMessage(admin.tgId, `🔔 Новая заявка от @${ctx.from.username || ctx.from.id}`);
            }
        });

        bot.hears(['Открыть', 'Закрыть'], async (ctx) => {
            const user = await User.findOne({ where: { tgId: ctx.from.id } });
            if (!user || user.role === 'pending') return ctx.reply('Доступ запрещен');

            const action = ctx.message.text;
            const result = await sendToPi(action === 'Открыть' ? 'open_gate' : 'close_gate');
            
            // Записываем лог
            await Log.create({ tgId: ctx.from.id, username: ctx.from.username || 'unknown', action });
            ctx.reply(result);
        });

        bot.hears('Управление', async (ctx) => {
            const user = await User.findOne({ where: { tgId: ctx.from.id } });
            if (user?.role !== 'admin') return;

            return ctx.reply('Меню администратора:', Markup.inlineKeyboard([
                [Markup.button.callback('📂 Запросы на добавление', 'manage_requests')],
                [Markup.button.callback('👥 Список пользователей', 'manage_users')],
                [Markup.button.callback('📡 Состояние соединения', 'connection_status')]
            ]));
        });

        bot.action('manage_requests', async (ctx) => {
            const pending = await User.findAll({ where: { role: 'pending' } });
            
            if (pending.length === 0) {
                return ctx.answerCbQuery('Новых запросов нет', { show_alert: true });
            }

            const buttons = pending.map(u => [
                Markup.button.callback(`👤 ${u.username}`, `edit_user_${u.tgId}`)
            ]);
            buttons.push([Markup.button.callback('⬅️ Назад', 'admin_main')]);

            await ctx.deleteMessage();
            return ctx.reply('Запросы на подключение:', Markup.inlineKeyboard(buttons));
        });

        bot.action('manage_users', async (ctx) => {
            const users = await User.findAll({ 
                where: { role: ['admin', 'user'] } 
            });

            const buttons = users.map(u => [
                Markup.button.callback(`${u.role === 'admin' ? '⭐' : '👤'} ${u.username}`, `edit_user_${u.tgId}`)
            ]);
            buttons.push([Markup.button.callback('⬅️ Назад', 'admin_main')]);

            await ctx.deleteMessage();
            return ctx.reply('Зарегистрированные пользователи:', Markup.inlineKeyboard(buttons));
        });

        bot.action(/edit_user_(\d+)/, async (ctx) => {
            const targetId = ctx.match[1];
            const user = await User.findOne({ where: { tgId: targetId } });

            if (!user) return ctx.answerCbQuery('Пользователь не найден');

            const buttons = [
                [Markup.button.callback('👑 Сделать админом', `set_role_admin_${targetId}`)],
                [Markup.button.callback('✅ Сделать пользователем', `set_role_user_${targetId}`)],
                [Markup.button.callback('❌ Удалить / Отклонить', `set_role_delete_${targetId}`)],
                [Markup.button.callback('⬅️ Назад к спискам', 'admin_main')]
            ];

            await ctx.deleteMessage();
            return ctx.reply(`Управление пользователем: @${user.username}\nID: ${user.tgId}\nТекущая роль: ${user.role}`, 
                Markup.inlineKeyboard(buttons)
            );
        });

        bot.action(/set_role_(admin|user|delete)_(\d+)/, async (ctx) => {
            const role = ctx.match[1];
            const targetId = ctx.match[2];

            if (role === 'delete') {
                await User.destroy({ where: { tgId: targetId } });
                ctx.answerCbQuery('Пользователь удален');
                bot.telegram.sendMessage(targetId, 'Ваш доступ к системе был аннулирован.');
            } else {
                await User.update({ role: role as 'admin' | 'user' }, { where: { tgId: targetId } });
                ctx.answerCbQuery('Роль обновлена');
                bot.telegram.sendMessage(targetId, `Ваш статус обновлен. Новая роль: ${role}`, mainKeyboard(role));
            }

            await ctx.deleteMessage();
            return ctx.reply('Действие выполнено успешно.', Markup.inlineKeyboard([
                [Markup.button.callback('⬅️ В главное меню', 'admin_main')]
            ]));
        });

        bot.action('admin_main', async (ctx) => {
            await ctx.deleteMessage();
            return ctx.reply('Меню администратора:', Markup.inlineKeyboard([
                [Markup.button.callback('📂 Запросы на добавление', 'manage_requests')],
                [Markup.button.callback('👥 Список пользователей', 'manage_users')],
                [Markup.button.callback('📜 Логи открытий', 'view_logs')], // Новая кнопка
                [Markup.button.callback('📡 Состояние соединения', 'connection_status')]
            ]));
        });

        // Просмотр последних 10 логов
        bot.action('view_logs', async (ctx) => {
            const logs = await Log.findAll({ limit: 15, order: [['createdAt', 'DESC']] });
            let text = '📋 *Последние действия:*\n\n';
            
            logs.forEach(l => {
                const date = l.createdAt.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
                text += `🔹 ${date} | @${l.username}: ${l.action}\n`;
            });

            await ctx.deleteMessage();
            return ctx.reply(text || 'Логи пусты', {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🗑 Очистить логи', 'clear_logs_confirm')],
                    [Markup.button.callback('⬅️ Назад', 'admin_main')]
                ])
            });
        });

        bot.action(/approve_(\d+)/, async (ctx) => {
            const targetId = ctx.match[1];
            await User.update({ role: 'user' }, { where: { tgId: targetId } });
            ctx.answerCbQuery('Одобрено');
            bot.telegram.sendMessage(targetId, 'Доступ разрешен! Теперь вы можете управлять воротами.', mainKeyboard('user'));
        });

        // Подтверждение очистки логов
        bot.action('clear_logs_confirm', async (ctx) => {
            await ctx.deleteMessage();
            return ctx.reply('⚠️ Вы уверены, что хотите УДАЛИТЬ ВСЕ логи?', Markup.inlineKeyboard([
                [Markup.button.callback('✅ Да, очистить', 'clear_logs_execute')],
                [Markup.button.callback('❌ Отмена', 'view_logs')]
            ]));
        });

        bot.action('clear_logs_execute', async (ctx) => {
            await Log.destroy({ where: {}, truncate: true }); // Полная очистка таблицы
            await ctx.answerCbQuery('Логи очищены');
            return ctx.editMessageText('✅ Журнал событий успешно очищен.', Markup.inlineKeyboard([
                [Markup.button.callback('⬅️ В меню', 'admin_main')]
            ]));
        });

        // Подтверждение перезагрузки малинки
        bot.action('reboot_pi_confirm', async (ctx) => {
            await ctx.deleteMessage();
            return ctx.reply('⚠️ Вы уверены, что хотите ПЕРЕЗАГРУЗИТЬ Raspberry Pi?', Markup.inlineKeyboard([
                [Markup.button.callback('✅ Да, перезагрузить', 'reboot_pi_execute')],
                [Markup.button.callback('❌ Отмена', 'connection_status')]
            ]));
        });

        bot.action('reboot_pi_execute', async (ctx) => {
            const result = await sendToPi('reboot_pi');
            await ctx.answerCbQuery('Команда отправлена');
            return ctx.editMessageText(`Результат: ${result}`, Markup.inlineKeyboard([
                [Markup.button.callback('⬅️ В меню', 'admin_main')]
            ]));
        });

        bot.action('connection_status', async (ctx) => {
            const isOnline = rpiSocket && rpiSocket.readyState === WebSocket.OPEN;

            if (!isOnline) {
                return ctx.answerCbQuery('❌ Raspberry Pi не в сети', { show_alert: true });
            }

            await ctx.answerCbQuery('📡 Запрашиваю данные...');
            await ctx.editMessageText('⌛ Получаю информацию от Raspberry Pi...');

            const result = await sendToPi('get_network_info');

            if (result.error) {
                return ctx.editMessageText(`❌ Ошибка: ${result.error}`, Markup.inlineKeyboard([
                    [Markup.button.callback('⬅️ Назад', 'admin_main')]
                ]));
            }

            const text = `
        📡 *Статус соединения:*
        ✅ Raspberry Pi в сети

        🏠 *Локальный IP:* \`${result.localIp}\`
        🌍 *Внешний IP:* \`${result.externalIp}\`
        📶 *Wi-Fi сеть:* \`${result.ssid}\`
        📊 *Сигнал:* \`${result.signal}%\`
        ⏱ *Uptime:* \`${result.uptime}\`
            `;

            return ctx.editMessageText(text, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🔄 Обновить', 'connection_status')],
                    [Markup.button.callback('🔄 Перезагрузить RPi', 'reboot_pi_confirm')],
                    [Markup.button.callback('⬅️ Назад', 'admin_main')]
                ])
            });
        });

        // ЗАПУСК БОТА
        console.log('>>> БОТ: Проверка связи с Telegram API...');
        const me = await bot.telegram.getMe();
        console.log(`>>> БОТ: Авторизован как @${me.username}`);

        await bot.launch();
        console.log('>>> СЕРВЕР: Полностью запущен и готов к работе!');

    } catch (error: any) {
        console.error('>>> КРИТИЧЕСКАЯ ОШИБКА:', error.message);
        process.exit(1);
    }
}

bootstrap();

// Остановка
const stop = (signal: string) => {
    console.log(`\nЗавершение по сигналу ${signal}`);
    process.exit(0);
};
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
