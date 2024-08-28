import { Telegraf, Markup } from "telegraf";
import { Calendar } from "telegram-inline-calendar";
import { message } from 'telegraf/filters'
import { checkForUpdates, getCurrentBookings, getBookingsByDate } from "./notion.js";
import { formattingBookingData, actualBookingFormatting } from "./format.js";
import dotenv from "dotenv";
import fs from 'fs';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {})

let chatIds = [];


const calendar = new Calendar(bot, {
    date_format: 'YYYY-MM-DD',
    language: 'ru',
    start_week_day: 1,
    bot_api: 'telegraf'
})

const path = './data/users.json';
// Загрузка данных из файла
function loadChatData() {
    try {
        const data = fs.readFileSync(path, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Ошибка при загрузке данных:", err);
        return [];
    }
}

// Сохранение данных в файл
function saveChatData(data) {
    try {
        fs.writeFileSync(path, JSON.stringify(data, null, 2));
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

const adminIdsArray = process.env.ADMIN_IDS.split(',').map(adminId => parseInt(adminId))
const adminInitialKeyboard = Markup.keyboard([['Актуальные бронирования'], ['Уведомление для пользователей'], ['Найти бронирования по дате']]).resize().oneTime();

bot.start(async (ctx) => {
    const CHAT_ID = ctx.update.message.chat.id;
    const USERNAME = ctx.update.message.chat.username;

    await ctx.reply('Привет! Это бот МИЭТ-ТВ, в котором вы можете получить уведомления о новых и актуальных бронированиях. Для взаимодействия с ботом воспользуйтесь кнопками меню. Дополнительную информацию о командах и кнопках можно узнать, написав /help');

    // Определение клавиатуры для администратора и обычного пользователя
    let keyboard;
    if (adminIdsArray.includes(CHAT_ID)) {
        keyboard = adminInitialKeyboard //клавиатура для администраторов
    } else {
        keyboard = Markup.keyboard([['Актуальные бронирования'], ['Найти бронирования по дате']]).resize().oneTime(); //клавиатура для обычных пользователей
    }

    await ctx.reply('Выберите команду:', keyboard); //Отправляем клавиатуру пользователю

    // Сохранение chat_id и username, если еще не сохранены
    if (!chatIds.some(user => user.chatId === CHAT_ID)) {
        chatIds.push({ chatId: CHAT_ID, username: USERNAME });
        saveChatData(chatIds); // Сохраняем данные в файл
    }
});


async function actualBookings(ctx) {
    // Отправляем сообщение, что начат поиск бронирований
    const searchingMessage = await ctx.reply('Ищем для вас актуальные бронирования...');

    try {
        // Получаем актуальные бронирования
        const actualBookings = await getCurrentBookings();
        await ctx.deleteMessage(searchingMessage.message_id);

        // Проверяем наличие бронирований и отправляем соответствующее сообщение
        if (actualBookings.length === 0) {
            await ctx.reply('Нет актуальных бронирований.');
        } else {
            await ctx.reply(actualBookingFormatting(actualBookings), {parse_mode: 'HTML'});
        }
    } catch (error) {
        //console.log(error)
        // В случае ошибки удаляем сообщение и отправляем сообщение об ошибке
        await ctx.deleteMessage(searchingMessage.message_id);
        await ctx.reply('Произошла ошибка при получении актуальных бронирований. Пожалуйста, попробуйте позже.');
    }
}

// Вызов вывода актуальных бронирований при выборе в меню пункта 'Актуальные бронирования'
bot.hears('Актуальные бронирования', async (ctx) => {
    await actualBookings(ctx);
});


bot.command('actual_bookings', async (ctx) => {
    await actualBookings(ctx);
})


function notificationsSending(text, ctx) {
    const CHAT_ID = ctx.update.message.chat.id;
    text = `<b>Уведомления от администратора:</b>\n\n${text}`
    chatIds.forEach(({ chatId }) => {
        if (CHAT_ID !== chatId) bot.telegram.sendMessage(chatId, text, {parse_mode: 'HTML'});
    })
}

//Вызов функции для отправки сообщений всем пользователям
bot.hears('Уведомление для пользователей', async (ctx) => {
    const waitingForMessage = true;
    const CHAT_ID = ctx.update.message.chat.id;

    await ctx.reply('Следующее сообщение, отправленное боту будет разосланно всем пользователям бота. Нажмите кнопку <u>Отмена</u>, чтобы отменить рассылку.', {parse_mode: 'HTML', reply_markup: Markup.removeKeyboard()})

    const cancelKeyboard = Markup.keyboard([['Отмена']]).resize().oneTime(); // Создаем клавиатуру для отмены рассылки
    await ctx.reply('Введите сообщение:', cancelKeyboard);

    if (waitingForMessage && adminIdsArray.includes(CHAT_ID)){
        bot.on('text', (ctx) => {
            const userMessage = ctx.update.message.text;
    
            // Проверяем, не нажал ли пользователь кнопку "Отмена"
            if (userMessage === 'Отмена') {
                ctx.reply('Рассылка отменена.', adminInitialKeyboard);
            } else {
                notificationsSending(userMessage, ctx); // Выполняем рассылку
                ctx.reply('Сообщение отправлено.', adminInitialKeyboard); // Отправляем уведомление об успешной рассылке
            }
        });
    }
})



let firstDate = null;
let secondDate = null;

function dateBookings(ctx) {
    calendar.startNavCalendar(ctx);

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

bot.hears('Найти бронирования по дате', (ctx) => {
    dateBookings(ctx);
});

bot.command('bookings_by_date', (ctx) => {
    dateBookings(ctx)
})


bot.command('help', (ctx) => {
    ctx.reply(`Наш бот получает данные из базы данных в Notion, обрабатывает, и присылает вам в удобном для просмотра виде 
без необходимости открывать таблицу с бронированиями на вашем устройстве.\n
<b>❗️❗️<u>Внимание</u>❗️❗️</b>\n
Бронирования оцениваются программой как \'активные\' и обрабатываться ей, только если:
<b>1) Бронирование имеет название</b>
<b>2) Бронирование имеет конечную дату</b>
<b>3) Бронирование имеет хотя-бы одного ответственного</b>
<b>4) Бронирование не помещено в архив</b>\n
<b><u>FAQ</u></b>\n
<b>&#9679 Я нажал на кнопку, но ничего не происходит.</b>
После отправки запроса подождите около 5 секунд, отправка, получение и обработка запросов на сервере дело не самое быстрое.\n
<b>&#9679 Кажется у меня всё сломалось...</b>
Вызовите команду /start, если проблема не исчезла, попробуйте очистить чат с ботом, если и это не помогло, то напишите разработчику в телеграмм.\n
<b>&#9679 Я отправляю сообщения боту, но ответа нет.</b>
Скорее всего сервер отключен и проводятся технические работы, мы уведомим вас, когда бот вновь будет запущен.\n
<b><u>Функционал бота</u></b>\n
<b>&#9679 Актуальные бронирования (/actual_bookings)</b>
Выводит список всех актуальных бронирований, время через которое вы получите ответ напрямую зависит от количества активных записей в базе данных.\n
<b>&#9679 Найти бронирования по дате (/bookings_by_date)</b>
На ввод пользователь подаёт даты начала и конца для своего бронирования, в выводе пользовательполучает все бронирования, накладывающиеся на его даты. <i>(если вам нужно проверить бронирование на один день, просто выберете на календаре одну и ту же дату)</i>\n
<b>&#9679 Поиск новых бронирований (нет команды)</b>
Процесс запускается автоматически раз в <i>n</i> минут, уведомление о появлении бронирования приходят всем пользователям. Бронирования, будут отображаться, только если подходят под один из 4 критериев написанных выше.\n
<b>&#9679 Рассылка уведомлений (нет команды)</b>
Администаторы бота могут прислать всем пользователям сообщение от имени бота, информируя вас о собраниях, потерях, съемках на студии etc.\n
<i>По поводу жалоб, просьб, и предложений писать:</i> @delilar_heton
`,
        {parse_mode: 'HTML'}
    )
})



setInterval(sendUpdates, 7 * 60 * 1000);

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
