import { Client } from "@notionhq/client";
import dotenv from "dotenv";

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });
let lastCheckedTime = null;


//Функция для получения данных из БД
async function getDataBase() {
  const response = await notion.databases.query({
    database_id: process.env.NOTION_CAMERAS_DATABASE_ID
  });

  return response.results;
}


// Функция для получения актуальных бронирований
async function getCurrentBookings() {
  const entries = await getDataBase();
  const actualTime = new Date();
  const actualDateOnly = new Date(actualTime.setHours(0, 0, 0, 0));

  const actualEntries = entries.filter(entry => {
    const isArchived = entry.properties['Архив'].checkbox;
    if (isArchived) {
      return false;
    }

    const title = entry.properties['Бронь'].title[0]?.plain_text;
    const dateProperty = entry.properties['Дата/Время']?.date;
    const endDateStr = dateProperty ? dateProperty.end : null;
    const responsible = entry.properties['Ответственный'].relation[0];

    // Проверка обязательных условий
    if (!title || !endDateStr || !responsible) {
      return false;
    }

    const entryDate = new Date(endDateStr);
    const hasTime = endDateStr.includes('T');

    // Проверка времени
    if (hasTime) {
      return actualTime <= entryDate;
    } else {
      // Проверка только даты без учета времени
      const entryDateOnly = new Date(entryDate.setHours(0, 0, 0, 0));
      return actualDateOnly <= entryDateOnly;
    }
  });

  // Асинхронная обработка данных после фильтрации
  const actualBookingData = await Promise.all(
    actualEntries.map(entry => formSortedBooking(entry.properties))
  );

  return actualBookingData;
}



// Функция для получения бронирований по дате
// Функция для получения бронирований по дате
async function getBookingsByDate(firstDate, secondDate) {
  const entries = await getDataBase();
  
  // Устанавливаем время на начало дня для сравнения
  const firstDateToSort = new Date(firstDate).setHours(0, 0, 0, 0);
  const secondDateToSort = new Date(secondDate).setHours(0, 0, 0, 0);

  // Фильтруем актуальные записи
  const actualEntries = entries.filter(entry => {
    const title = entry.properties['Бронь']?.title[0]?.plain_text;
    const dateProperty = entry.properties['Дата/Время']?.date;
    const startDateStr = dateProperty ? new Date(dateProperty.start).setHours(0, 0, 0, 0) : null;
    const endDateStr = dateProperty ? new Date(dateProperty.end).setHours(0, 0, 0, 0) : null;
    const responsible = entry.properties['Ответственный']?.relation[0];
    const isArchived = entry.properties['Архив']?.checkbox;

    // Проверка обязательных условий
    if (!title || !dateProperty || !responsible || isArchived) {
      return false;
    }

    // Проверка наличия валидной даты
    if (isNaN(startDateStr) || isNaN(endDateStr)) {
      console.log('Invalid Date encountered:', startDateStr, endDateStr);
      return false;
    }

    // Проверка дат на соответствие диапазону
    return (
      (startDateStr >= firstDateToSort && startDateStr <= secondDateToSort) ||
      (endDateStr <= secondDateToSort && endDateStr >= firstDateToSort) ||
      (startDateStr <= firstDateToSort && endDateStr >= secondDateToSort)
    );
  });

  // Асинхронная обработка данных после фильтрации
  const actualBookingData = await Promise.all(
    actualEntries.map(entry => formSortedBooking(entry.properties))
  );

  return actualBookingData;
}




//Функция для проверки появления новых бронированний
async function checkForUpdates() {
  const currentEntries = await getDataBase();
  let newBookingsData = []; //Массив для хранения новых элементов в БД

  if (!lastCheckedTime) {
    lastCheckedTime = new Date();
    lastCheckedTime = roundToNearestMinuteDown(lastCheckedTime);
    console.log("Initial data loaded.");
  } else {
    const newEntries = currentEntries.filter(entry => {
      const entryEditedTime = new Date(entry.last_edited_time);
      return entryEditedTime >= lastCheckedTime;
    });

    if (newEntries.length > 0) {

      for (const entry of newEntries) { 
        //Проверка на то, что поля 'Бронь' и 'Ответственный' заполненны, и 'Дата/Время' имеет окончание
        if (entry.properties['Бронь'].title[0].plain_text && entry.properties['Дата/Время'].date.end && currentEntries[0].properties['Ответственный'].relation && !entry.properties['Архив'].checkbox) {
          newBookingsData.push(await formSortedBooking(entry.properties)) //Добавление данных одной записи в массив данных
        }
      }

      // Обновляем последнее время проверки после обработки всех новых записей
      lastCheckedTime = new Date();
      lastCheckedTime = roundToNearestMinuteDown(lastCheckedTime);
    }
  }

  if (newBookingsData.length !== 0) return newBookingsData //Возвращаем данные о новых бронированиях в виде массива объектов
}

// Функция для округления времени вниз до ближайшей минуты
function roundToNearestMinuteDown(date) {
  date.setSeconds(0, 0); // Обнуление секунд и миллисекунд
  return date;
}

//Функция для получение текста из ссылок на другую БД
async function getTextFromRelationId(relationId) {
  const elem = await notion.pages.retrieve({ page_id: relationId });
  return elem.properties.name.rich_text[0].plain_text;
}

//Функция формирующая новый объект из отобранных данных. Отбрасываем для каждой колонки в БД неннужные для отображения данные
async function formSortedBooking(entryProperties) {
  const propertiesArray = Object.values(entryProperties);
  const keysArray = Object.keys(entryProperties);

  let entryData = {} //Объект для хранения значений нового бронирования

  for (let columnIndex = 0; columnIndex < propertiesArray.length; columnIndex++) { ``
    const column = propertiesArray[columnIndex];
    const key = keysArray[columnIndex] // Переменнная для храниеия ключей в entryData

    switch (column.type) {
      case 'relation':
        if (column.relation.length !== 0) {
          let relatedData = [];
          for (const rel of column.relation) { 
            const text = await getTextFromRelationId(rel.id); 
            relatedData.push(text)
          }
          entryData[key] = relatedData
        } else {
          entryData[key] = column.relation
        }
        break;
      case 'date':
        entryData[key] = column.date
        break;
      case 'title':
        if (column.title.length > 0) { 
          entryData[key] = column.title[0].plain_text
        }
        break;
      case 'checkbox':
        entryData[key] = column.checkbox
        break;
      default:
        break;
    }
  }

  return entryData;
}

// Начальная проверка при запуске
checkForUpdates();


export { checkForUpdates, getCurrentBookings, getBookingsByDate }