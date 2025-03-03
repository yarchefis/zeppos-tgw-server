const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const path = require("path");
const express = require("express");
const readline = require("readline");
const util = require("util");
const os = require("os");
const apiRoutes = require("./apiRoutes");

const configPath = path.resolve("./config.json");

const defaultConfig = {
    api_id: "",
    api_hash: "",
    auth_token: "",
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

        console.log("Authentication successful. Please run again.");
        config.auth_token = client.session.save();
        saveConfig(config);
    } catch (err) {
        console.log(`Error: ${err.message || "Something went wrong."}`);
    } finally {
        rl.close();
    }
}

async function startBot() {
    if (!config.auth_token) {
        await authenticate();
        process.exit(0);
    }

    console.log("✅ Config loaded successfully. Connecting to Telegram...");
    const apiId = Number(config.api_id);
    const apiHash = config.api_hash;
    const stringSession = new StringSession(config.auth_token);

    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    try {
        await client.start();
        console.log("✅ Successfully connected to Telegram!");

        const app = express();
        const port = 65222;
        const host = "0.0.0.0";

        app.use(express.json());
        app.use("/api", apiRoutes(client));

        app.get("/", async (req, res) => {
            try {
                const me = await client.getMe();
                const dialogs = await client.getDialogs();

                // Загружаем конфиг
                let config = loadConfig();
                if (!Array.isArray(config.whitelist)) config.whitelist = [];
                if (typeof config.use_whitelist !== "boolean") config.use_whitelist = false;
                saveConfig(config);

                // Приведение всех ID в whitelist к числам (на всякий случай)
                config.whitelist = config.whitelist.map(Number);

                // Создаём HTML со списком чатов
                const allChats = dialogs
                    .filter(chat => !config.whitelist.includes(Number(chat.id)))
                    .map(chat => {
                        return `<div class="chat-item">
                                    <span>${chat.title || chat.name || "Private Chat"}</span>
                                    <button class="add" data-id="${chat.id}">+</button>
                                </div>`;
                    }).join("");

                const whitelistChats = dialogs
                    .filter(chat => config.whitelist.includes(Number(chat.id)))
                    .map(chat => {
                        return `<div class="chat-item">
                                    <span>${chat.title || chat.name || "Private Chat"}</span>
                                    <button class="remove" data-id="${chat.id}">−</button>
                                </div>`;
                    }).join("");

                    res.send(`
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>Telegram Chats</title>
                            <style>
                                body {
                                    font-family: Arial, sans-serif;
                                    margin: 0;
                                    padding: 0;
                                    background-color: #121212;
                                    color: #ffffff;
                                    box-sizing: border-box;
                                }
                        
                                .container {
                                    display: flex;
                                    gap: 10px;
                                    width: 100vw;
                                    height: 100vh;
                                    overflow: hidden;
                                    padding: 10px;
                                    box-sizing: border-box;
                                }
                        
                                .column {
                                    flex: 1;
                                    border: 1px solid #333;
                                    padding: 10px;
                                    background: #1e1e1e;
                                    border-radius: 5px;
                                    overflow-y: auto;
                                    max-height: 100vh;
                                    box-sizing: border-box;
                                    display: flex;
                                    flex-direction: column;
                                }
                        
                                /* Поиск */
                                .search-box {
                                    margin-bottom: 10px;
                                }
                                
                                .search-box input {
                                    width: 100%;
                                    padding: 8px;
                                    font-size: 14px;
                                    border: none;
                                    border-radius: 4px;
                                    background: #333;
                                    color: white;
                                    outline: none;
                                }
                        
                                .chat-list {
                                    flex-grow: 1;
                                    overflow-y: auto;
                                }
                        
                                .chat-item {
                                    display: flex;
                                    justify-content: space-between;
                                    align-items: center;
                                    padding: 10px;
                                    border-bottom: 1px solid #333;
                                }
                        
                                .chat-item:last-child {
                                    border-bottom: none;
                                }
                        
                                button {
                                    background: #007bff;
                                    color: white;
                                    border: none;
                                    padding: 5px 10px;
                                    cursor: pointer;
                                    border-radius: 3px;
                                    transition: background 0.3s;
                                }
                        
                                button:hover {
                                    background: #0056b3;
                                }
                        
                                button.remove {
                                    background: #dc3545;
                                }
                        
                                button.remove:hover {
                                    background: #b52a37;
                                }
                        
                                /* Тумблер */
                                .toggle-container {
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    margin-bottom: 10px;
                                }
                        
                                .toggle-label {
                                    font-size: 16px;
                                    margin-right: 10px;
                                }
                        
                                .toggle-switch {
                                    width: 50px;
                                    height: 24px;
                                    background: #444;
                                    border-radius: 12px;
                                    position: relative;
                                    cursor: pointer;
                                    transition: background 0.3s;
                                }
                        
                                .toggle-switch:before {
                                    content: "";
                                    position: absolute;
                                    top: 3px;
                                    left: 3px;
                                    width: 18px;
                                    height: 18px;
                                    background: white;
                                    border-radius: 50%;
                                    transition: transform 0.3s;
                                }
                        
                                .toggle-switch.active {
                                    background: #28a745;
                                }
                        
                                .toggle-switch.active:before {
                                    transform: translateX(26px);
                                }
                        
                                /* Адаптация для телефонов */
                                @media (max-width: 600px) {
                                    .container {
                                        flex-direction: column;
                                        height: 100vh;
                                    }
                                    .column {
                                        width: 100vw;
                                        height: 50vh;
                                    }
                                }
                            </style>
                        </head>
                        <body>
                            <div class="toggle-container">
                                <label class="toggle-label">Use Whitelist:</label>
                                <div class="toggle-switch ${config.use_whitelist ? "active" : ""}" id="toggleWhitelist"></div>
                            </div>
                            <div class="container">
                                <div class="column">
                                    <h2>All Chats</h2>
                                    <div class="search-box">
                                        <input type="text" id="searchAll" placeholder="Search...">
                                    </div>
                                    <div id="allChats">${allChats}</div>
                                </div>
                                <div class="column">
                                    <h2>Whitelist</h2>
                                    <div class="search-box">
                                        <input type="text" id="searchWhitelist" placeholder="Search...">
                                    </div>
                                    <div id="whitelist">${whitelistChats}</div>
                                </div>
                            </div>
                            <script>
                                document.getElementById("toggleWhitelist").addEventListener("click", function() {
                                    this.classList.toggle("active");
                                    fetch("/toggle-whitelist", { 
                                        method: "POST", 
                                        body: JSON.stringify({ use_whitelist: this.classList.contains("active") }), 
                                        headers: { "Content-Type": "application/json" } 
                                    });
                                });
                        
                                document.body.addEventListener("click", function(event) {
                                    if (event.target.classList.contains("add")) {
                                        fetch("/add-to-whitelist", { 
                                            method: "POST", 
                                            body: JSON.stringify({ chat_id: event.target.dataset.id }), 
                                            headers: { "Content-Type": "application/json" } 
                                        }).then(() => location.reload());
                                    }
                                    if (event.target.classList.contains("remove")) {
                                        fetch("/remove-from-whitelist", { 
                                            method: "POST", 
                                            body: JSON.stringify({ chat_id: event.target.dataset.id }), 
                                            headers: { "Content-Type": "application/json" } 
                                        }).then(() => location.reload());
                                    }
                                });
                                
                                function filterChats(inputId, containerId) {
                                    document.getElementById(inputId).addEventListener("input", function() {
                                        let filter = this.value.toLowerCase();
                                        let container = document.getElementById(containerId);
                                        let chats = container ? Array.from(container.getElementsByClassName("chat-item")) : [];
                                        chats.forEach(chat => {
                                            chat.style.display = chat.textContent.toLowerCase().includes(filter) ? "flex" : "none";
                                        });

                                    });
                                }
                                
                                filterChats("searchAll", "allChats");
                                filterChats("searchWhitelist", "whitelist");
                            </script>
                        </body>
                        </html>
                        `);
                        
            } catch (error) {
                res.status(500).send("Error retrieving chat list");
            }
        });

        // API для работы с конфигом
        app.post("/toggle-whitelist", express.json(), (req, res) => {
            let config = loadConfig();
            config.use_whitelist = req.body.use_whitelist;
            saveConfig(config);
            res.sendStatus(200);
        });

        app.post("/add-to-whitelist", express.json(), (req, res) => {
            let config = loadConfig();
            let chatId = Number(req.body.chat_id);
            if (!config.whitelist.includes(chatId)) {
                config.whitelist.push(chatId);
                saveConfig(config);
            }
            res.sendStatus(200);
        });

        app.post("/remove-from-whitelist", express.json(), (req, res) => {
            let config = loadConfig();
            let chatId = Number(req.body.chat_id);
            config.whitelist = config.whitelist.filter(id => id !== chatId);
            saveConfig(config);
            res.sendStatus(200);
        });





        app.listen(port, host, () => {
            console.log(`🚀 Server is running on:`);

            const interfaces = os.networkInterfaces();
            Object.values(interfaces).forEach((iface) => {
                iface.forEach((addr) => {
                    if (addr.family === "IPv4") {
                        console.log(`  http://${addr.address}:${port}`);
                    }
                });
            });
        });

    } catch (error) {
        console.error("❌ Failed to connect to Telegram:", error);
        process.exit(1);
    }
}

startBot();
