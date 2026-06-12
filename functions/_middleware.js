// _middleware.js
// Download Bot Only – Only download commands (No admin/group/forex/fakeaddress)

import { TELEGRAM_API, PUBLIC_BOT_PUBLIC_COMMANDS } from './constants';
import { sendMessage, getMe, setMyCommands } from './telegramApiHelpers';
import { handleFBCommand } from './fbDownloader.js';
import { handleTikTokCommand } from './tikDownloader.js';
import { handleYTCommand, handleSongCommand } from './ytDownloader.js';
import { handleTXCommand } from './txDownloader.js';

async function handleStartCommand(message, token, botKeyValue) {
    const chatId = message.chat.id;
    const fromUser = message.from;
    const welcomeText = `🎬 <b>Download Bot မှကြိုဆိုပါတယ်</b>\n\n` +
        `Hi <a href="tg://user?id=${fromUser.id}">${fromUser.first_name}</a>!\n\n` +
        `<b>📌 အသုံးပြုပုံ</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `📘 <b>Facebook Video</b> → /fb or /facebook\n` +
        `🎵 <b>TikTok Video</b> → /tik or /tiktok\n` +
        `🎬 <b>YouTube Video (original)</b> → /yt or /youtube or /mp4\n` +
        `🎧 <b>YouTube Audio (mp3)</b> → /song or /audio or /mp3\n` +
        `🐦 <b>Twitter/X Video</b> → /tx\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `<b>🔍 ဥပမာ</b>\n` +
        `/fb https://fb.com/xxx\n` +
        `/song ဖိုးကာ\n` +
        `/yt https://youtu.be/xxx\n` +
        `/tik https://tiktok.com/xxx\n` +
        `/mp3 https://youtube.com/watch?v=xxx\n` +
        `/audio ပန်းနွယ်ကစိမ်း တွံတေးသိန်းတန်\n\n` +
        `<b>🎯 လိုအပ်သော link သို့မဟုတ် စာသားဖြင့် command ပေးပါ</b>`;
    await sendMessage(token, chatId, welcomeText, 'HTML', null, botKeyValue);
}

export async function onRequest(context) {
    const { request, env } = context;
    const token = env.TELEGRAM_BOT_TOKEN;
    const BOT_KEY = env.BOT_DATA;
    const url = new URL(request.url);

    // Webhook Registration
    if (request.method === "GET" && url.pathname === "/registerWebhook") {
        const webhookUrl = `https://${url.hostname}/`;
        const setWebhookUrl = `${TELEGRAM_API}${token}/setWebhook`;
        try {
            const response = await fetch(setWebhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Bot-Key": BOT_KEY },
                body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] })
            });
            const result = await response.json();
            if (result.ok) {
                // Set bot commands
                const commands = [
                    { command: "start", description: "Bot ကိုစတင်ရန်" },
                    { command: "fb", description: "Facebook Video Download" },
                    { command: "facebook", description: "Facebook Video Download" },
                    { command: "fbdl", description: "Facebook Video Download" },
                    { command: "tik", description: "TikTok Video Download" },
                    { command: "tiktok", description: "TikTok Video Download" },
                    { command: "yt", description: "YouTube Video Download" },
                    { command: "youtube", description: "YouTube Video Download" },
                    { command: "mp4", description: "YouTube Video Download" },
                    { command: "song", description: "YouTube Audio (mp3)" },
                    { command: "audio", description: "YouTube Audio (mp3)" },
                    { command: "mp3", description: "YouTube Audio (mp3)" },
                    { command: "tx", description: "Twitter/X Video Download" }
                ];
                await setMyCommands(token, commands, BOT_KEY);
                return new Response(`✅ Webhook registered successfully to: ${webhookUrl}`, { status: 200 });
            } else {
                return new Response(`❌ Webhook registration failed: ${result.description}`, { status: 500 });
            }
        } catch (error) {
            return new Response(`❌ Error: ${error.message}`, { status: 500 });
        }
    }

    // Webhook Unregistration
    if (request.method === "GET" && url.pathname === "/unregisterWebhook") {
        const deleteWebhookUrl = `${TELEGRAM_API}${token}/deleteWebhook`;
        try {
            const response = await fetch(deleteWebhookUrl, {
                method: "POST",
                headers: { "X-Bot-Key": BOT_KEY }
            });
            const result = await response.json();
            if (result.ok) {
                return new Response(`✅ Webhook unregistered successfully`, { status: 200 });
            } else {
                return new Response(`❌ Webhook unregistration failed: ${result.description}`, { status: 500 });
            }
        } catch (error) {
            return new Response(`❌ Error: ${error.message}`, { status: 500 });
        }
    }

    // Main Telegram POST handler
    if (request.method === "POST") {
        try {
            const update = await request.json();
            if (!update.message) return new Response("OK", { status: 200 });
            
            const message = update.message;
            const chatId = message.chat.id;
            const text = message.text || '';
            
            if (!text.startsWith('/')) return new Response("OK", { status: 200 });

            const command = text.split(' ')[0].toLowerCase();
            
            switch (command) {
                case '/start':
                    await handleStartCommand(message, token, BOT_KEY);
                    break;
                case '/fb':
                case '/fbdl':
                case '/facebook':
                    await handleFBCommand(message, token, env, BOT_KEY);
                    break;
                case '/tik':
                case '/tiktok':
                    await handleTikTokCommand(message, token, env, BOT_KEY);
                    break;
                case '/yt':
                case '/youtube':
                case '/mp4':
                    await handleYTCommand(message, token, env, BOT_KEY);
                    break;
                case '/song':
                case '/audio':
                case '/mp3':
                    await handleSongCommand(message, token, env, BOT_KEY);
                    break;
                case '/tx':
                    await handleTXCommand(message, token, env, BOT_KEY);
                    break;
                default:
                    await sendMessage(token, chatId, 
                        "❌ မသိသော command ဖြစ်ပါသည်။\n\n/start ဖြင့် ပြန်စစ်ပါ။", 
                        'HTML', null, BOT_KEY);
                    break;
            }
            return new Response("OK", { status: 200 });
        } catch (error) {
            console.error("[onRequest] Error:", error);
            return new Response(`Error: ${error.message}`, { status: 500 });
        }
    }

    return new Response("Download Bot is running. Use /registerWebhook to setup.", { status: 200 });
}
