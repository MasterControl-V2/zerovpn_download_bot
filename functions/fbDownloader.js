// ============================================================
// FILE: functions/fbDownloader.js
// (ORIGINAL - UNCHANGED)
// ============================================================

import { sendMessage } from './telegramApiHelpers.js';

const FB_API_BASE = "https://nkka404-360api.hf.space/fb/dl?url=";
const PARSE_MODE = 'HTML';
const MAX_RETRIES = 3;

function escapeHTML(text = '') {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function tgRequest(token, method, payload, botKeyValue) {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const headers = { 'Content-Type': 'application/json' };
    if (botKeyValue) headers['X-Bot-Key'] = botKeyValue;
    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
    });
    return await response.json();
}

async function streamToR2(videoUrl, fileName, env, retryCount = 0) {
    try {
        console.log(`[streamToR2] Starting download for ${fileName}`);
        const response = await fetch(videoUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "video/*",
                "Referer": "https://facebook.com/"
            },
            signal: AbortSignal.timeout(60000)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await env.MY_BUCKET.put(fileName, response.body, { httpMetadata: { contentType: 'video/mp4' } });
        console.log(`[streamToR2] Successfully stored ${fileName}`);
        return fileName;
    } catch (error) {
        console.error(`[streamToR2] Error (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
        if (retryCount < MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
            return await streamToR2(videoUrl, fileName, env, retryCount + 1);
        }
        throw error;
    }
}

async function sendVideoFromR2(chatId, fileName, caption, thumbUrl, token, botKeyValue, env) {
    try {
        const object = await env.MY_BUCKET.get(fileName);
        if (!object) throw new Error("Video not found in R2 bucket");
        const videoBlob = await object.blob();
        const formData = new FormData();
        formData.append('chat_id', chatId.toString());
        formData.append('caption', caption);
        formData.append('parse_mode', PARSE_MODE);
        formData.append('supports_streaming', 'true');
        formData.append('video', videoBlob, 'video.mp4');
        if (thumbUrl) {
            try {
                const thumbRes = await fetch(thumbUrl);
                if (thumbRes.ok) formData.append('thumbnail', await thumbRes.blob(), 'thumb.jpg');
            } catch (e) {}
        }
        const headers = {};
        if (botKeyValue) headers['X-Bot-Key'] = botKeyValue;
        const response = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
            method: 'POST',
            headers: headers,
            body: formData
        });
        const result = await response.json();
        if (!result.ok) throw new Error(result.description || "Telegram refused the file");
        return result;
    } catch (error) {
        console.error("[sendVideoFromR2] Error:", error);
        throw error;
    }
}

async function deleteFromR2(fileName, env) {
    try {
        await env.MY_BUCKET.delete(fileName);
        console.log(`[deleteFromR2] Deleted ${fileName}`);
    } catch (error) {
        console.error(`[deleteFromR2] Error deleting ${fileName}:`, error);
    }
}

export async function handleFBCommand(message, token, env, botKeyValue) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text || '';
    const args = text.split(' ');
    args.shift();
    let url = args.join(' ').trim();
    
    if (!url && message.reply_to_message && message.reply_to_message.text) {
        const fbMatch = message.reply_to_message.text.match(/https?:\/\/(www\.|m\.)?facebook\.com\/\S+|https?:\/\/fb\.watch\/\S+/);
        if (fbMatch) url = fbMatch[0];
    }
    
    if (!url) {
        await sendMessage(token, chatId, 
            "<b>❌ Please provide a Facebook Video Link</b>\n\n" +
            "<b>Usage:</b> <code>/fb &lt;facebook_video_url&gt;</code>\n" +
            "<b>Or reply</b> to a message containing Facebook link with <code>/fb</code>",
            PARSE_MODE, null, botKeyValue);
        return;
    }
    
    const r2FileName = `fb_${userId}_${Date.now()}.mp4`;
    let statusMsgId = null;
    
    try {
        const statusResult = await tgRequest(token, 'sendMessage', {
            chat_id: chatId,
            text: "<b>🔍 Searching Facebook video...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        statusMsgId = statusResult.result?.message_id;
        
        const apiUrl = `${FB_API_BASE}${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
            signal: AbortSignal.timeout(30000)
        });
        const data = await response.json();
        
        if (!data.links || data.links.length === 0) {
            throw new Error("No video links found.");
        }
        
        const links = data.links;
        const videoObj = links.find(l => l.quality === "HD") || links.find(l => l.quality === "video+audio") || links[0];
        const videoUrl = videoObj.url;
        const title = escapeHTML(data.title || "Facebook Video");
        const thumb = data.thumbnail;
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusMsgId,
            text: "<b>☑️ Video found! Downloading...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        await streamToR2(videoUrl, r2FileName, env);
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusMsgId,
            text: "<b>📤 Uploading to Telegram...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        const user = message.from || {};
        const safeName = escapeHTML([user.first_name, user.last_name].filter(Boolean).join(' ') || "User");
        const caption = `<b>📹 Title:</b> <code>${title.substring(0, 200)}</code>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>🔗 Source:</b> <a href="${url}">Watch On Facebook</a>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>Downloaded By:</b> <a href="tg://user?id=${userId}">${safeName}</a>`;
        
        await sendVideoFromR2(chatId, r2FileName, caption, thumb, token, botKeyValue, env);
        
        if (statusMsgId) {
            await tgRequest(token, 'deleteMessage', { chat_id: chatId, message_id: statusMsgId }, botKeyValue);
        }
    } catch (error) {
        console.error("[handleFBCommand] Error:", error);
        const errorMessage = `<b>❌ Error: ${escapeHTML(error.message)}</b>`;
        if (statusMsgId) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusMsgId,
                text: errorMessage, parse_mode: PARSE_MODE
            }, botKeyValue);
        } else {
            await sendMessage(token, chatId, errorMessage, PARSE_MODE, null, botKeyValue);
        }
    } finally {
        await deleteFromR2(r2FileName, env);
    }
}
