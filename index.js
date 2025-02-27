const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const path = require("path");
const express = require("express");
const readline = require("readline");
const util = require("util");
const os = require("os");

const configPath = path.resolve("./config.json");

const defaultConfig = {
    api_id: "",
    api_hash: "",
    auth_token: "",
    authToken: "",
    isactivate: 1
};

if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
}


// Функции работы с конфигом
function loadConfig() {
    return fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
}

function saveConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

const config = loadConfig();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = util.promisify(rl.question).bind(rl);

async function askUser(field, message, transform = (x) => x) {
    config[field] = transform(await question(message));
    saveConfig(config);
}

async function authenticate() {
    try {
        console.log("Setting up Telegram API...");
        await askUser("api_id", "Enter API ID: ", Number);
        await askUser("api_hash", "Enter API Hash: ");

        const client = new TelegramClient(new StringSession(""), config.api_id, config.api_hash, {
            connectionRetries: 5,
        });

        client.setLogLevel("error");

        console.log("Logging in to Telegram...");
        await client.start({
            phoneNumber: async () => await question("Enter your phone number: "),
            password: async () => await question("Enter your password (if required): "),
            phoneCode: async () => {
                while (true) {
                    const code = await question("Enter the code from Telegram: ");
                    if (code.trim()) return code;
                    console.log("The code cannot be empty.");
                }
            },
            onError: (err) => console.log(`Authentication error: ${err.errorMessage || "Unknown error"}`),
        });

        console.log("Authentication successful. please run again.");
        config.auth_token = client.session.save();
        saveConfig(config);
    } catch (err) {
        console.log(`Error: ${err.message || "Something went wrong."}`);
    } finally {
        rl.close();
    }
}

if (!config.auth_token) {
    authenticate().then(() => process.exit(0));
} else {
    console.log("✅ Config loaded successfully. Connecting to Telegram...");
    const apiId = Number(config.api_id);
    const apiHash = config.api_hash;
    const stringSession = new StringSession(config.auth_token);

    const app = express();
    const port = 3000;
    app.use(express.json());

    function stripMarkdown(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, "$1")
            .replace(/\*(.*?)\*/g, "$1")
            .replace(/__(.*?)__/g, "$1")
            .replace(/_(.*?)_/g, "$1")
            .replace(/```[\s\S]*?```/g, "")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/\[(.*?)\]\(.*?\)/g, "$1");
    }

    (async () => {
        console.log("Connecting to Telegram...");
        const client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
        });

        await client.connect();
        console.log("Connected.");
        client.setLogLevel("error");

        app.get("/api/getme", async (req, res) => {
            try {
                let receivedToken = req.headers["authorization"]?.replace("Bearer ", "") || req.query.token || "";

                if (!config.authToken) {
                    // Если токена нет в конфиге, принимаем первый присланный и сохраняем
                    if (receivedToken) {
                        config.authToken = receivedToken;
                        saveConfig(config);
                    } else {
                        return res.status(401).json({ error: "Unauthorized", isactivate: false });
                    }
                } else if (receivedToken !== config.authToken) {
                    return res.status(403).json({ error: "Forbidden", isactivate: false });
                }

                const me = await client.getMe();

                res.json({
                    first_name: me.firstName,
                    last_name: me.lastName || "",
                    id: me.id,
                    isactivate: true,
                });

            } catch (error) {
                res.status(500).json({ error: "Failed to fetch user data" });
            }
        });






        app.get("/api/chats", async (req, res) => {
            try {
                let receivedToken = req.headers["authorization"]?.replace("Bearer ", "") || req.query.token || "";

                if (!config.authToken) {
                    return res.status(401).json({ error: "Unauthorized" });
                } else if (receivedToken !== config.authToken) {
                    return res.status(403).json({ error: "Forbidden" });
                }

                const dialogs = await client.getDialogs();
                const chatList = dialogs
                    .map(dialog => dialog.entity)
                    .filter(entity => !entity.migratedTo) // Убираем устаревшие чаты
                    .map(entity => ({
                        id: entity.className === "Channel" ? `-100${entity.id}` : entity.id, // -100 только для каналов и супергрупп
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
                let receivedToken = req.headers["authorization"]?.replace("Bearer ", "") || req.query.token || "";

                if (!config.authToken) {
                    return res.status(401).json({ error: "Unauthorized" });
                } else if (receivedToken !== config.authToken) {
                    return res.status(403).json({ error: "Forbidden" });
                }

                const page = parseInt(req.params.page, 10) || 1;
                const pageSize = 15;
                const dialogs = await client.getDialogs();
                const chatList = dialogs
                    .map(dialog => dialog.entity)
                    .filter(entity => !entity.migratedTo)
                    .map(entity => ({
                        id: entity.className === "Channel" ? `-100${entity.id}` : entity.id, // -100 только для каналов и супергрупп
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
                let receivedToken = req.headers["authorization"]?.replace("Bearer ", "") || req.query.token || "";

                if (!config.authToken) {
                    return res.status(401).json({ error: "Unauthorized" });
                } else if (receivedToken !== config.authToken) {
                    return res.status(403).json({ error: "Forbidden" });
                }

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
                let receivedToken = req.headers["authorization"]?.replace("Bearer ", "") || req.query.token || "";

                if (!config.authToken) {
                    return res.status(401).json({ error: "Unauthorized" });
                } else if (receivedToken !== config.authToken) {
                    return res.status(403).json({ error: "Forbidden" });
                }

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
                let receivedToken = req.headers["authorization"]?.replace("Bearer ", "") || req.query.token || "";

                if (!config.authToken) {
                    return res.status(401).json({ error: "Unauthorized", status: 0 });
                } else if (receivedToken !== config.authToken) {
                    return res.status(403).json({ error: "Forbidden", status: 0 });
                }

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


        const port = 65222;
        const host = "0.0.0.0";

        app.listen(port, host, () => {
            console.log(`Server is running on:`);

            const interfaces = os.networkInterfaces();
            Object.values(interfaces).forEach((iface) => {
                iface.forEach((addr) => {
                    if (addr.family === "IPv4") {
                        console.log(`  http://${addr.address}:${port}`);
                    }
                });
            });
        });

    })();
}
