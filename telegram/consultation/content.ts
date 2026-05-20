import * as fs from "fs";
import * as path from "path";

type ConsultationMessage = {
  id: string;
  version: number;
  title: string;
  paragraphs: string[];
  cta: {
    text: string;
    action: "payment_client" | "payment_master";
  };
};

function readMessageJson(fileName: string): ConsultationMessage {
  const candidatePaths = [
    path.resolve(process.cwd(), "telegram/consultation/messages", fileName),
    path.resolve(__dirname, "messages", fileName),
  ];
  for (const filePath of candidatePaths) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as ConsultationMessage;
    }
  }
  throw new Error(`Message file not found: ${fileName}`);
}

function renderMessageText(payload: ConsultationMessage): string {
  return [payload.title, ...payload.paragraphs].join("\n\n");
}

export const clientMessage = readMessageJson("descr-client.json");
export const masterMessage = readMessageJson("descr-master.json");

export const TEXT_S1 =
  "Головне меню — вибір сценарію.\n\nОберіть, що вам зараз потрібно:";
export const TEXT_S10 =
  "Я проходив навчання\n\n" +
  "Тут буде перехід до підписки та продовження роботи в академії. Цей блок у розробці.";
export const TEXT_S2 = "Консультація\n\nОберіть формат:";
export const TEXT_S2_CLIENT = renderMessageText(clientMessage);
export const TEXT_S2_MASTER = renderMessageText(masterMessage);
export const DEFAULT_CONSULTATION_LANDING_URL =
  "https://multimasking.kwiga.com/ua";

export const TEXT_S20 =
  "Хочу навчання\n\n" +
  "Програми та умови навчання — на сайті MULTIMASKING.\n" +
  "Натисніть кнопку нижче, щоб відкрити сторінку.";

export const PAYMENT_APPROVED_ASK_DISPLAY_NAME_SUFFIX =
  "Напишіть своє імʼя та прізвище одним повідомленням (наприклад: Марія Коваленко).";

export const CLIENT_POST_DISPLAY_NAME_TEXT =
  "Дякуємо! Наступний крок — коротка анкета в цьому чаті.\n" +
  "Натисніть «📋 Почати анкету», щоб ми підготували вашу консультацію.\n\n" +
  "Після заповнення анкети менеджер відповість вам, щойно буде на звʼязку.";

export const MASTER_POST_DISPLAY_NAME_TEXT =
  "Дякуємо! Для вас запущено прямий формат через форум-групу, менеджер підключиться найближчим часом.";

export const INTAKE_Q1_TEXT = "📋 Intake розпочато.\n\nQ1: Оберіть крок:";
export const INTAKE_Q2_TEXT = "Q2: Опишіть вашу головну ціль одним повідомленням.";
export const INTAKE_Q3_TEXT =
  "Q3: Коротко опишіть поточні складнощі або що не працює зараз.";
export const INTAKE_Q4_TEXT =
  "Q4: Надішліть фото або відео для аналізу.\nМожна надіслати кілька файлів, потім натисніть «✅ Завершити анкету».";
