import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import fs from "fs";
import path from "path";
import express from "express";

const configPath = path.resolve("./config.json");
if (!fs.existsSync(configPath)) {
  console.error("❌ Config file not found. Please create config.json and add required data.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
if (!config.api_id || !config.api_hash) {
  console.error("❌ Missing api_id or api_hash in config.json. Please provide both values.");
  process.exit(1);
}

if (!config.auth_token) {
  console.error("❌ Missing auth_token in config.json. Run 'node utils/getToken.js' to generate it.");
  process.exit(1);
}

const apiId = Number(config.api_id);
const apiHash = config.api_hash;
const stringSession = new StringSession(config.auth_token);

const app = express();
const port = 3000;

function stripMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")  // жирный текст **text**
    .replace(/\*(.*?)\*/g, "$1")      // курсив *text*
    .replace(/__(.*?)__/g, "$1")      // подчёркнутый __text__
    .replace(/_(.*?)_/g, "$1")        // курсив _text_
    .replace(/```[\s\S]*?```/g, "")   // блок кода ```code```
    .replace(/`([^`]+)`/g, "$1")      // inline-код `code`
    .replace(/\[(.*?)\]\(.*?\)/g, "$1"); // ссылки [text](url)
}

(async () => {
  console.log("Connecting to Telegram...");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.connect();
  console.log("Connected.");

  app.get("/api/getme", async (req, res) => {
    try {
      const me = await client.getMe();
      res.json({
        first_name: me.firstName,
        last_name: me.lastName || "",
        id: me.id,
        isactivate: config.isactivate || false,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user data" });
    }
  });

  app.get("/api/chats", async (req, res) => {
    try {
      const dialogs = await client.getDialogs();
      const chatList = dialogs
        .map(dialog => dialog.entity)
        .filter(entity => !entity.migratedTo) // Убираем устаревшие чаты
        .map(entity => ({
          id: entity.className === "Channel" ? `-100${entity.id}` : entity.id, // Добавляем -100 только для каналов и супергрупп
          title: entity.title || entity.firstName || "",
          first_name: entity.firstName || "",
          last_name: entity.lastName || "",
          username: entity.username || "",
          ispin: entity.pinned ? 1 : 0,
          type: entity.className === "Channel" ? (entity.megagroup ? "group" : "channel") : "chat",
        }));

      res.json(chatList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chat data" });
    }
  });

  app.get("/api/chats/page/:page", async (req, res) => {
    try {
      const page = parseInt(req.params.page, 10) || 1;
      const pageSize = 10;
      const dialogs = await client.getDialogs();
      const chatList = dialogs
        .map(dialog => dialog.entity)
        .filter(entity => !entity.migratedTo)
        .map(entity => ({
          id: entity.className === "Channel" ? `-100${entity.id}` : entity.id, // Исправлено добавление -100
          title: entity.title || entity.firstName || entity.lastName || "",
          first_name: entity.firstName || "",
          last_name: entity.lastName || "",
          username: entity.username || "",
          ispin: entity.pinned ? 1 : 0,
          type: entity.className === "Channel" ? (entity.megagroup ? "group" : "channel") : "chat",
        }));

      const paginatedChats = chatList.slice((page - 1) * pageSize, page * pageSize);
      res.json({
        page,
        total_pages: Math.ceil(chatList.length / pageSize),
        chats: paginatedChats,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch paginated chat data" });
    }
  });



  app.get("/api/chat/:chat_id", async (req, res) => {
    try {
      // Получаем информацию о текущем пользователе (боте)
      const me = await client.getMe();
      const myId = Number(me.id); // Приводим ID бота к числу

      const chatId = Number(req.params.chat_id);
      const messages = await client.getMessages(chatId, { limit: 10 });

      const filteredMessages = messages.reduce((acc, msg) => {
        if (msg.text || !msg.media) {
          acc.push({
            id: msg.id,
            date: msg.date,
            sender_id: Number(msg.senderId) || null, // Приводим sender_id к числу
            sender: msg.sender?.firstName || msg.sender?.title || "Unknown",
            text: stripMarkdown(msg.text),
            reactions: msg.reactions ? msg.reactions.results.map(r => `${JSON.stringify(r.reaction)} x${r.count}`).join(", ") : "",
            you: Number(msg.senderId) === myId // Теперь сравнение всегда между числами
          });
        }
        return acc;
      }, []);

      res.json(filteredMessages);
    } catch (error) {
      console.error("Error fetching chat messages:", error);
      res.status(500).json({ error: "Failed to fetch chat messages" });
    }
  });






  app.post("/api/chat/:chat_id/send", express.json(), async (req, res) => {
    try {
      const chatId = Number(req.params.chat_id);
      const { message } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message text is required and must be a string." });
      }

      // Отправляем сообщение
      const sentMessage = await client.sendMessage(chatId, { message });

      if (!sentMessage) {
        return res.status(500).json({ error: "Failed to send message." });
      }

      res.json({ success: true, message_id: sentMessage.id });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ error: "An unexpected error occurred while sending the message." });
    }
  });

  app.get("/api/chatformsg/:id/:text", async (req, res) => {
    try {
      const chatId = Number(req.params.id);
      const message = req.params.text;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message text is required and must be a string.", status: 0 });
      }

      // Отправляем сообщение
      const sentMessage = await client.sendMessage(chatId, { message });

      if (!sentMessage) {
        return res.status(500).json({ error: "Failed to send message.", status: 0 });
      }

      res.json({ success: true, message_id: sentMessage.id, status: 1 });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ error: "An unexpected error occurred while sending the message.", status: 0 });
    }
  });






  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
})();
