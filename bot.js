import { Telegraf, Markup } from "telegraf";
import { Calendar } from "telegram-inline-calendar";
import { checkForUpdates, getCurrentBookings, getBookingsByDate, getFreeEquipmentByDate } from "./notion.js";
import { formattingBookingData, actualBookingFormatting, freeEquipmentFormating } from "./format.js";
import dotenv from "dotenv";
import fs from 'fs';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {});
const calendar = new Calendar(bot, {
    date_format: 'YYYY-MM-DD',
    language: 'ru',
    start_week_day: 1,
    bot_api: 'telegraf'
});

const usersPath = './data/users.json';
let chatIds = [];

// Загрузка данных из файла
function loadChatData() {
    try {
        const data = fs.readFileSync(usersPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Ошибка при загрузке данных:", err);
        return [];
    }
}

// Сохранение данных в файл
function saveChatData(data) {
    try {
        fs.writeFileSync(usersPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Ошибка при сохранении данных:", err);
    }
}

chatIds = loadChatData();

async function sendUpdates() {
    try {
        const newEntries = await checkForUpdates();
        if (newEntries) {
            newEntries.forEach(entry => {
                // Отправка сообщений всем пользователям, сохранённым в chatIds
                chatIds.forEach(({ chatId }) => {
                    bot.telegram.sendMessage(chatId, formattingBookingData(entry), { parse_mode: 'HTML' });
                });
            });
        }
    } catch (error) {
        console.error("Ошибка при отправке данных в Telegram:", error);
    }
}

const adminIdsArray = process.env.ADMIN_IDS.split(',').map(adminId => parseInt(adminId));
const adminInitialKeyboard = Markup.keyboard([['Уведомление для пользователей'], ['Актуальные бронирования'], ['Найти бронирования по дате'], ['Найти свободную технику по дате']]).resize().oneTime();
const userKeyboard = Markup.keyboard([['Актуальные бронирования'], ['Найти бронирования по дате'],['Найти свободную технику по дате']]).resize().oneTime();


bot.start(async (ctx) => {
    const CHAT_ID = ctx.update.message.chat.id;
    const USERNAME = ctx.update.message.chat.username;

    await ctx.reply('Привет! Это бот МИЭТ-ТВ, в котором вы можете получить уведомления о новых и актуальных бронированиях. Для взаимодействия с ботом воспользуйтесь кнопками меню. Дополнительную информацию о командах и кнопках можно узнать, написав /help');

    let keyboard = adminIdsArray.includes(CHAT_ID) ? adminInitialKeyboard : userKeyboard;

    await ctx.reply('Выберите команду:', keyboard);

    if (!chatIds.some(user => user.chatId === CHAT_ID)) {
        chatIds.push({ chatId: CHAT_ID, username: USERNAME });
        saveChatData(chatIds); // Сохраняем данные в файл
    }
});

// Функция для получения данных об актуальных бронированиях
async function actualBookings(ctx) {
    const searchingMessage = await ctx.reply('Ищем для вас актуальные бронирования...');

    try {
        const actualBookings = await getCurrentBookings();
        console.log(actualBookings)
        await ctx.deleteMessage(searchingMessage.message_id);

        if (actualBookings.length === 0) {
            await ctx.reply('Нет актуальных бронирований.');
        } else {
            await ctx.reply(actualBookingFormatting(actualBookings), { parse_mode: 'HTML' });
        }
    } catch (error) {
        await ctx.deleteMessage(searchingMessage.message_id);
        await ctx.reply('Произошла ошибка при получении актуальных бронирований. Пожалуйста, попробуйте позже.');
    }
}

bot.hears('Актуальные бронирования', async (ctx) => {
    await actualBookings(ctx);
});

bot.command('actual_bookings', async (ctx) => {
    await actualBookings(ctx);
});



async function dateBookings(ctx) {
    calendar.startNavCalendar(ctx);

    let firstDate = null
    let secondDate = null

    bot.on('callback_query', async (ctx) => {
        if (ctx.callbackQuery.message.message_id == calendar.chats.get(ctx.callbackQuery.message.chat.id)) {
            const selectedDate = calendar.clickButtonCalendar(ctx);

            // Проверка, если date === -1, не выполнять дальнейшие действия
            if (selectedDate === -1) {
                return;
            }

            // Логика выбора первой и второй даты
            if (!firstDate) {
                firstDate = selectedDate;
                await ctx.reply(`Первая дата выбрана: ${firstDate}. Теперь выберите вторую дату.`);
                calendar.startNavCalendar(ctx);
            } else {
                secondDate = selectedDate;

                // Убедимся, что вторая дата не раньше первой
                if (secondDate < firstDate) {
                    [firstDate, secondDate] = [secondDate, firstDate]; // поменяем местами, если выбрано в неправильном порядке
                }

                const searchingMessage = await ctx.reply('Ищем для вас бронирования по выбранному диапазону дат...');
                const bookingsByDateRange = await getBookingsByDate(firstDate, secondDate);
                await ctx.deleteMessage(searchingMessage.message_id);

                if (bookingsByDateRange.length !== 0) {
                    ctx.reply(actualBookingFormatting(bookingsByDateRange), { parse_mode: 'HTML' });
                } else {
                    ctx.reply('Бронирований в этом диапазоне дат не найдено.');
                }

                // Сбросим даты после поиска
                firstDate = null;
                secondDate = null;
            }
        }
    });
}

bot.hears('Найти бронирования по дате', async (ctx) => {
    await dateBookings(ctx);
});

bot.command('bookings_by_date', async (ctx) => {
    await dateBookings(ctx)
})


async function freeEquipmentByDate(ctx) {

    calendar.startNavCalendar(ctx);

    let firstDate = null
    let secondDate = null

    bot.on('callback_query', async (ctx) => {
        if (ctx.callbackQuery.message.message_id == calendar.chats.get(ctx.callbackQuery.message.chat.id)) {
            const selectedDate = calendar.clickButtonCalendar(ctx);

            // Проверка, если date === -1, не выполнять дальнейшие действия
            if (selectedDate === -1) {
                return;
            }

            // Логика выбора первой и второй даты
            if (!firstDate) {
                firstDate = selectedDate;
                await ctx.reply(`Первая дата выбрана: ${firstDate}. Теперь выберите вторую дату.`);
                calendar.startNavCalendar(ctx);
            } else {
                secondDate = selectedDate;

                // Убедимся, что вторая дата не раньше первой
                if (secondDate < firstDate) {
                    [firstDate, secondDate] = [secondDate, firstDate]; // поменяем местами, если выбрано в неправильном порядке
                }

                const searchingMessage = await ctx.reply('Ищем для вас бронирования по выбранному диапазону дат...');

                try {
                    const { freeEquipment, bookingsByDate: bookingsByDateRange, titles } = await getFreeEquipmentByDate(firstDate, secondDate);
                    
                    if (Object.values(freeEquipment).filter((elem) => elem.length !== 0).length === 0) {
                        await ctx.reply('Нет свободного оборудования на указанную дату.');
                        return;
                    } else {
                        ctx.reply(freeEquipmentFormating(freeEquipment), { parse_mode: 'HTML' })
                    }

                    await ctx.deleteMessage(searchingMessage.message_id);

                    if (bookingsByDateRange.length !== 0) {
                        ctx.reply(actualBookingFormatting(bookingsByDateRange), { parse_mode: 'HTML' });
                    } else {
                        ctx.reply('Бронирований в этом диапазоне дат не найдено.');
                    }
                } catch (error) {
                    console.error('Error in freeEquipmentByDate:', error);
                    await ctx.reply('Произошла ошибка при получении свободной техники. Пожалуйста, попробуйте позже.');
                }

                // Сбросим даты после поиска
                firstDate = null;
                secondDate = null;
            }
        }
    });
}

bot.hears('Найти свободную технику по дате', async (ctx) => {
    await freeEquipmentByDate(ctx);
});

bot.command('free_equipment_by_date', async (ctx) => {
    await freeEquipmentByDate(ctx);
});



bot.command('help', (ctx) => {
    const helpMessage = `Наш бот получает данные из базы данных в Notion, обрабатывает, и присылает вам в удобном для просмотра виде 
без необходимости открывать таблицу с бронированиями на вашем устройстве.\n
❗️❗️Внимание❗️❗️\n
Бронирования оцениваются программой как 'активные' и обрабатываются ей, только если:
1) Бронирование имеет название
2) Бронирование имеет конечную дату
3) Бронирование имеет хотя бы одного ответственного
4) Бронирование не помещено в архив\n
FAQ\n
• Я нажал на кнопку в меню, и бот ничего не прислал, как быть?\n
    - Убедитесь, что бронирования соответствуют хотя бы одному из 4 пунктов выше.
• Сколько бронирований я могу увидеть?\n
    - Вся информация представлена на сегодня. Вы получите уведомление о новых бронированиях, как только они появятся в базе данных.
• Как часто обновляется информация?\n
    - Каждые 7 минут.\n
Доступные команды:\n
&#9679 Поиск свобоной техники по датам (/free_equipment_by_date) - выводит два сообщения: 1 - вся свободная техника на выбранном диапазоне дат, 2 - забронированная на этом диапазоне дат техника (Костыль тк. мы не можем получать точные данные о времени от пользователя без использования календаря (ಥ﹏ಥ). Напишите разработчику как только придумайте библиотеку с inline кнопками в виде таймера).\n
&#9679 Актуальные бронирования (/actual_bookings) - выводит список всех актуальных бронирований.\n
&#9679 Найти бронирования по дате (/bookings_by_date) - найдите бронирования, выбрав диапазон дат через удобный интерфейс календаря.\n
&#9679 Уведомление для пользователей - (только для администратора) отправка сообщения всем пользователям.\n`;

    ctx.reply(helpMessage, { parse_mode: 'HTML' });
});


function notificationsSending(text, ctx) {
    const CHAT_ID = ctx.update.message.chat.id;
    text = `<b>Уведомления от администратора:</b>\n\n${text}`;
    chatIds.forEach(({ chatId }) => {
        if (CHAT_ID !== chatId) {
            bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
        }
    });
}

let waitingForMessage = false

bot.hears('Уведомление для пользователей', async (ctx) => {
    const CHAT_ID = ctx.update.message.chat.id;

    if (adminIdsArray.includes(CHAT_ID)) {
        waitingForMessage = true;

        await ctx.reply('Следующее сообщение, отправленное боту будет разослано всем пользователям. Нажмите кнопку <u>Отмена</u>, чтобы отменить рассылку.', { parse_mode: 'HTML', reply_markup: Markup.removeKeyboard() });

        const cancelKeyboard = Markup.keyboard([['Отмена']]).resize().oneTime();
        await ctx.reply('Введите сообщение:', cancelKeyboard);

        if (waitingForMessage) {
            bot.on('text', (ctx) => {
                const CHAT_ID = ctx.update.message.chat.id;
                const userMessage = ctx.update.message.text;
            
                // Проверяем, не нажал ли пользователь кнопку "Отмена"
                if (userMessage === 'Отмена') {
                    waitingForMessage = false;
                    ctx.reply('Рассылка отменена.', adminInitialKeyboard);
                } else if (waitingForMessage && adminIdsArray.includes(CHAT_ID)) {
                    waitingForMessage = false;
                    notificationsSending(userMessage, ctx); // Выполняем рассылку
                    ctx.reply('Сообщение отправлено.', adminInitialKeyboard); // Отправляем уведомление об успешной рассылке
                }
            });
        }
    } else {
        await ctx.reply('У вас нет доступа к данной функции');
    }
});


setInterval(sendUpdates, 7 * 60 * 1000);

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));