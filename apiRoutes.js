const express = require("express");
const fs = require("fs");

module.exports = (client) => {
    const router = express.Router();

    function stripMarkdown(text) {
        return text
            .replace(/(\*\*|__)(.*?)\1/g, "$2") // Жирный текст **bold** или __bold__
            .replace(/(\*|_)(.*?)\1/g, "$2")   // Курсив *italic* или _italic_
            .replace(/~~(.*?)~~/g, "$1") // Убираем ~~ вокруг зачеркнутого текста
            .replace(/```([\s\S]*?)```/g, "$1") // Просто убираем ```
            .replace(/`([^`]+)`/g, "$1") // Инлайн-код `code`
            .replace(/\[(.*?)\]\(.*?\)/g, "$1"); // Ссылки [text](url)
    }
    
    
    

    function loadConfig() {
        try {
            return JSON.parse(fs.readFileSync("config.json", "utf8"));
        } catch (err) {
            console.error("Error loading config:", err);
            return { use_whitelist: false, whitelist: [] };
        }
    }

    router.get("/getme", async (req, res) => {
        try {
            const me = await client.getMe();
            res.json({
                first_name: me.firstName,
                last_name: me.lastName || "",
                id: me.id,
                isactivate: true,
            });
        } catch (error) {
            console.error("Error fetching user data:", error);
            res.status(500).json({ error: "Failed to fetch user data" });
        }
    });

    router.get("/chats", async (req, res) => {
        try {
            const config = loadConfig();
            const me = await client.getMe(); // Получаем ID пользователя
            console.log("My ID:", me.id);
            const myId = BigInt(me.id);
            const dialogs = await client.getDialogs();
            let chatList = dialogs.map(dialog => dialog.entity).map(entity => ({
                id: entity.className === "Channel" ? `-100${entity.id}` : entity.id,
                title: BigInt(entity.id) === myId ? "Saved Messages" : entity.title || entity.firstName || "",
                username: entity.username || "",
                type: entity.className === "Channel" ? (entity.megagroup ? "group" : "channel") : "chat",
            }));
    
            if (config.use_whitelist) {
                chatList = chatList.filter(chat => config.whitelist.includes(parseInt(chat.id, 10)));
            }
    
            res.json(chatList);
        } catch (error) {
            console.error("Error fetching chat data:", error);
            res.status(500).json({ error: "Failed to fetch chat data", details: error.message });
        }
    });
    

    router.get("/chats/page/:page", async (req, res) => {
        try {
            const config = loadConfig();
            const me = await client.getMe();
            console.log("My ID:", me.id);
            const myId = BigInt(me.id);
            const page = parseInt(req.params.page, 10) || 1;
            const pageSize = 15;
            const dialogs = await client.getDialogs();
            let chatList = dialogs.map(dialog => dialog.entity).map(entity => ({
                id: entity.className === "Channel" ? `-100${entity.id}` : entity.id,
                title: BigInt(entity.id) === myId ? "Saved Messages" : entity.title || entity.firstName || "",
                username: entity.username || "",
                type: entity.className === "Channel" ? (entity.megagroup ? "group" : "channel") : "chat",
            }));

            if (config.use_whitelist) {
                chatList = chatList.filter(chat => config.whitelist.includes(parseInt(chat.id, 10)));
            }

            const paginatedChats = chatList.slice((page - 1) * pageSize, page * pageSize);
            res.json({
                page,
                total_pages: Math.ceil(chatList.length / pageSize),
                chats: paginatedChats,
            });
        } catch (error) {
            console.error("Error fetching paginated chat data:", error);
            res.status(500).json({ error: "Failed to fetch paginated chat data", details: error.message });
        }
    });


    router.get("/chats/search/:query", async (req, res) => {
        try {
            const config = loadConfig();
            const me = await client.getMe();
            console.log("My ID:", me.id);
            const myId = BigInt(me.id);
            const query = req.params.query.toLowerCase();
            const dialogs = await client.getDialogs();
            let chatList = dialogs.map(dialog => dialog.entity).map(entity => ({
                id: entity.className === "Channel" ? `-100${entity.id}` : entity.id,
                title: BigInt(entity.id) === myId ? "Saved Messages" : entity.title || entity.firstName || "",
                username: entity.username || "",
                type: entity.className === "Channel" ? (entity.megagroup ? "group" : "channel") : "chat",
            }));
    
            if (config.use_whitelist) {
                chatList = chatList.filter(chat => config.whitelist.includes(parseInt(chat.id, 10)));
            }
    
            const filteredChats = chatList.filter(chat =>
                chat.title.toLowerCase().includes(query) || chat.username.toLowerCase().includes(query)
            );
    
            if (filteredChats.length === 0) {
                return res.json([{ id: null, title: "Not found", username: "", type: "none" }]);
            }
    
            res.json(filteredChats);
        } catch (error) {
            console.error("Error searching chats:", error);
            res.status(500).json({ error: "Failed to search chats", details: error.message });
        }
    });
    
    



    router.get("/chat/:chat_id", async (req, res) => {
        try {
            const chatId = Number(req.params.chat_id);
            const messages = await client.getMessages(chatId, { limit: 10 });
    
            const me = await client.getMe();
            console.log("My ID:", me.id);
            const myId = BigInt(me.id);
    
            res.json(messages.map(msg => ({
                id: msg.id,
                text: stripMarkdown(msg.text),
                //text: msg.text,
                sender: msg.sender?.firstName || msg.sender?.title || "Unknown",
                reactions: msg.reactions ? msg.reactions.results.map(r => `${JSON.stringify(r.reaction)} x${r.count}`).join(", ") : "",
                you: msg.sender ? BigInt(msg.sender.id) === myId : false
            })));
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch chat messages" });
        }
    });
    

    router.get("/chatformsg/:id/:text", async (req, res) => {
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

    return router;
};
