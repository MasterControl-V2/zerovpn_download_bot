// _middleware.js
// Download Bot Only - Cloudflare Pages Function Entry Point

import { TELEGRAM_API, BOT_COMMANDS } from './constants';
import { sendMessage, getMe, setMyCommands } from './telegramApiHelpers';
import { handleFBCommand } from './fbDownloader.js';
import { handleTikTokCommand } from './tikDownloader.js';
import { handleYTCommand, handleSongCommand } from './ytDownloader.js';
import { handleTXCommand } from './txDownloader.js';

// /start command handler
async function handleStartCommand(message, token, botKeyValue) {
    const chatId = message.chat.id;
    const fromUser = message.from;
    const welcomeText = `🎬 <b>Welcome to Download Bot!</b>\n\n` +
                        `Hi <a href="tg://user?id=${fromUser.id}">${fromUser.first_name}</a>!\n\n` +
                        `<b>Available Commands:</b>\n` +
                        `📹 /fb - Download Facebook video\n` +
                        `🎵 /tik - Download TikTok video\n` +
                        `🎬 /yt - Download YouTube video\n` +
                        `🎧 /song - Download YouTube audio\n` +
                        `🐦 /tx - Download Twitter/X video\n\n` +
                        `<b>Usage:</b> Send a command followed by a link\n` +
                        `<code>/fb https://facebook.com/video...</code>`;
    
    await sendMessage(token, chatId, welcomeText, 'HTML', null, botKeyValue);
}

export async function onRequest(context) {
    const { request, env } = context;
    const token = env.TELEGRAM_BOT_TOKEN;
    const BOT_KEY = env.BOT_DATA;
    
    console.log(`[onRequest] Received ${request.method} ${request.url}`);
    
    // Handle webhook registration
    if (request.method === "GET" && request.url.includes("/registerWebhook")) {
        const webhookUrl = request.url.replace("/registerWebhook", "");
        const setWebhookUrl = `${TELEGRAM_API}${token}/setWebhook`;
        
        try {
            const response = await fetch(setWebhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Bot-Key": BOT_KEY },
                body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] })
            });
            const result = await response.json();
            
            if (result.ok) {
                // Set bot commands after webhook registration
                const commands = BOT_COMMANDS.map(cmd => ({ 
                    command: cmd.substring(1), 
                    description: cmd === '/start' ? 'Start the bot' :
                                 cmd === '/fb' || cmd === '/fbdl' ? 'Download Facebook video' :
                                 cmd === '/tik' || cmd === '/tiktok' ? 'Download TikTok video' :
                                 cmd === '/yt' || cmd === '/youtube' ? 'Download YouTube video' :
                                 cmd === '/song' || cmd === '/audio' ? 'Download YouTube audio' :
                                 'Download Twitter/X video'
                }));
                await setMyCommands(token, commands, BOT_KEY);
            }
            
            return new Response(`Webhook registered: ${result.ok}`, { status: 200 });
        } catch (error) {
            return new Response(`Error: ${error.message}`, { status: 500 });
        }
    }
    
    // Handle POST requests (Telegram webhook)
    if (request.method === "POST") {
        try {
            const update = await request.json();
            console.log("[onRequest] Update:", JSON.stringify(update));
            
            if (!update.message) {
                return new Response("OK", { status: 200 });
            }
            
            const message = update.message;
            const chatId = message.chat.id;
            const text = message.text || '';
            
            if (!text.startsWith('/')) {
                return new Response("OK", { status: 200 });
            }
            
            const command = text.split(' ')[0].toLowerCase();
            console.log(`[onRequest] Command: ${command}`);
            
            // Route commands to handlers
            switch (command) {
                case '/start':
                    await handleStartCommand(message, token, BOT_KEY);
                    break;
                case '/fb':
                case '/fbdl':
                    await handleFBCommand(message, token, env, BOT_KEY);
                    break;
                case '/tik':
                case '/tiktok':
                    await handleTikTokCommand(message, token, env, BOT_KEY);
                    break;
                case '/yt':
                case '/youtube':
                    await handleYTCommand(message, token, env, BOT_KEY);
                    break;
                case '/song':
                case '/audio':
                    await handleSongCommand(message, token, env, BOT_KEY);
                    break;
                case '/tx':
                    await handleTXCommand(message, token, env, BOT_KEY);
                    break;
                default:
                    await sendMessage(token, chatId, 
                        `<b>❌ Unknown command: ${command}</b>\n\nUse /start to see available commands.`,
                        'HTML', null, BOT_KEY);
                    break;
            }
            
            return new Response("OK", { status: 200 });
            
        } catch (error) {
            console.error("[onRequest] Error:", error);
            return new Response(`Error: ${error.message}`, { status: 500 });
        }
    }
    
    return new Response("Download Bot is running!", { status: 200 });
}
