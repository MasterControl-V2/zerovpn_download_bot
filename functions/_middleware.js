// _middleware.js
// Download Bot Only - Facebook, TikTok, YouTube, Twitter/X

import { TELEGRAM_API, BOT_TOKEN, PARSE_MODE } from './constants.js';
import { sendMessage } from './telegramApiHelpers.js';
import { handleFBCommand } from './fbDownloader.js';
import { handleTikTokCommand } from './tikDownloader.js';
import { handleYTCommand, handleSongCommand } from './ytDownloader.js';
import { handleTXCommand } from './txDownloader.js';

export async function onRequest(context) {
    const { request, env } = context;
    const token = BOT_TOKEN;
    
    console.log(`[onRequest] Received: ${request.method} ${request.url}`);
    
    let requestBody = {};
    if (request.method === "POST" && request.headers.get("content-type")?.includes("application/json")) {
        try {
            requestBody = await request.clone().json();
        } catch (e) {
            console.error("[onRequest] JSON parse error:", e);
        }
    }
    
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/registerWebhook")) {
        const pagesUrl = url.origin + url.pathname.replace("/registerWebhook", "/");
        const setWebhookApiUrl = `${TELEGRAM_API}${token}/setWebhook`;
        const payload = { url: pagesUrl, allowed_updates: ["message"] };
        try {
            const response = await fetch(setWebhookApiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            return new Response(`Webhook registered to: ${pagesUrl} (Success: ${result.ok})`, { status: 200 });
        } catch (error) {
            return new Response(`Error: ${error.message}`, { status: 500 });
        }
    }
    
    if (request.method === "POST") {
        try {
            const update = requestBody;
            if (Object.keys(update).length === 0) {
                return new Response("OK", { status: 200 });
            }
            
            if (update.message) {
                const message = update.message;
                const text = message.text || '';
                
                if (!text) return new Response("OK", { status: 200 });
                
                const command = text.split(' ')[0].toLowerCase();
                const chatId = message.chat.id;
                
                console.log(`[onRequest] Command: ${command}`);
                
                switch(command) {
                    case '/fb':
                    case '/fbdl':
                        await handleFBCommand(message, token, env);
                        break;
                    case '/tik':
                    case '/tiktok':
                        await handleTikTokCommand(message, token, env);
                        break;
                    case '/yt':
                    case '/youtube':
                        await handleYTCommand(message, token, env);
                        break;
                    case '/song':
                    case '/audio':
                        await handleSongCommand(message, token, env);
                        break;
                    case '/tx':
                        await handleTXCommand(message, token, env);
                        break;
                    case '/start':
                        await sendMessage(token, chatId, 
                            "🎬 <b>Download Bot is Ready!</b>\n\n" +
                            "Commands:\n" +
                            "/fb &lt;url&gt; - Facebook Video\n" +
                            "/tik &lt;url&gt; - TikTok Video\n" +
                            "/yt &lt;url&gt; - YouTube Video\n" +
                            "/song &lt;name&gt; - YouTube Audio\n" +
                            "/tx &lt;url&gt; - Twitter/X Video",
                            PARSE_MODE);
                        break;
                    default:
                        break;
                }
            }
            return new Response("OK", { status: 200 });
        } catch (error) {
            console.error("[onRequest] Error:", error);
            return new Response(`Error: ${error.message}`, { status: 500 });
        }
    }
    
    return new Response("Download Bot is running. Send /start", { status: 200 });
}
