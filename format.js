function formatDate(date, withTime = false) {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  let formattedDate = `${day}/${month}/${year}`;
  
  if (withTime) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    formattedDate += ` ${hours}:${minutes}`;
  }

  return formattedDate;
}

function formattingDate(entryDateStart, entryDateEnd) {
  const startDate = new Date(entryDateStart);
  const endDate = new Date(entryDateEnd);

  const withTime = entryDateStart.includes('T');
  const formattedStartDate = formatDate(startDate, withTime);
  const formattedEndDate = formatDate(endDate, withTime);

  return `${formattedStartDate} – ${formattedEndDate}`;
}

function formatEquipmentList(equipmentName, items) {
  if (items.length === 0) return '';
  return `<b>${equipmentName}:</b>\n${items.map(item => `\t\t${item}\n`).join('')}`;
}

function bookingTextTemplate(message, entry) {
  message += `<b>Бронь:</b> <u>${entry["Бронь"]}</u>\n`;
  message += `<b>Дата/Время:</b> <u>${formattingDate(entry["Дата/Время"].start, entry["Дата/Время"].end)}</u>\n`;

  message += formatEquipmentList("Камеры/Объективы", entry["Камеры/Объективы"]);
  message += formatEquipmentList("Штативы/Стойки", entry["Штативы/Стойки"]);
  message += formatEquipmentList("Звук", entry["Звук"]);
  message += formatEquipmentList("Свет", entry["Свет"]);
  message += formatEquipmentList("Доп техника", entry["доп техника"]);

  message += `<b>Ответственный:</b>\n${entry["Ответственный"].map(item => `\t\t${item}\n`).join('')}`;
  
  return message;
}

// Форматирование данных для вывода в сообщении
function formattingBookingData(entry) {
  let message = "<u><b>Новое бронирование:</b></u>\n\n";
  return bookingTextTemplate(message, entry);
}

// Форматирование данных для вывода актуальных бронирований
function actualBookingFormatting(actualEntry) {
  let message = "";
  actualEntry.forEach((entry, entryIndex) => {
    message = bookingTextTemplate(message, entry);
    if (entryIndex !== actualEntry.length - 1) message += `\n`;
  });
  return message;
}

export { formattingBookingData, actualBookingFormatting };
