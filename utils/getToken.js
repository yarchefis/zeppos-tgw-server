import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import readline from "readline";
import fs from "fs";
import path from "path";

// Load config
const configPath = path.resolve("./config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const api_id = Number(config.api_id);
const api_hash = config.api_hash;
const stringSession = new StringSession("");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

(async () => {
  console.log("Logging in to Telegram...");
  const client = new TelegramClient(stringSession, api_id, api_hash, {
    connectionRetries: 5,
  });
  
  await client.start({
    phoneNumber: async () => new Promise((resolve) => rl.question("Enter your phone number: ", resolve)),
    password: async () => new Promise((resolve) => rl.question("Enter your password: ", resolve)),
    phoneCode: async () => new Promise((resolve) => rl.question("Enter the code from Telegram: ", resolve)),
    onError: (err) => console.log("Error: Authentication failed"),
  });
  
  console.log("Authentication successful!");
  console.log("Your token:", client.session.save());
  rl.close();
})();