// tikDownloader.js - FINAL VERSION

import { sendMessage } from './telegramApiHelpers.js';

const TIKTOK_API_BASE = "https://zeroap-tiktok.mycontrol-bot2.workers.dev/tik/dl";
const PARSE_MODE = 'HTML';

function escapeHTML(text = '') {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatNumber(num) {
    if (!num || num === "0") return "0";
    return num.toString();
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

async function streamToR2(videoUrl, fileName, env) {
    const response = await fetch(videoUrl, {
        headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!response.ok) throw new Error(`Failed: ${response.status}`);
    await env.MY_BUCKET.put(fileName, response.body, {
        httpMetadata: { contentType: 'video/mp4' }
    });
    return fileName;
}

async function sendVideoFromR2(chatId, fileName, caption, token, botKeyValue, env) {
    const object = await env.MY_BUCKET.get(fileName);
    if (!object) throw new Error("Video not found");
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('caption', caption);
    formData.append('parse_mode', PARSE_MODE);
    formData.append('supports_streaming', 'true');
    formData.append('video', await object.blob(), 'tiktok_video.mp4');
    const headers = {};
    if (botKeyValue) headers['X-Bot-Key'] = botKeyValue;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        headers: headers,
        body: formData
    });
    return await response.json();
}

async function deleteFromR2(fileName, env) {
    try { await env.MY_BUCKET.delete(fileName); } catch(e) {}
}

export async function handleTikTokCommand(message, token, env, botKeyValue) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text || '';
    const args = text.split(' ');
    args.shift();
    let url = args.join(' ').trim();
    
    if (!url && message.reply_to_message && message.reply_to_message.text) {
        const match = message.reply_to_message.text.match(/https?:\/\/(vm\.tiktok\.com|www\.tiktok\.com|vt\.tiktok\.com|tiktok\.com)\/\S+/);
        if (match) url = match[0];
    }
    
    if (!url) {
        await sendMessage(token, chatId,
            "<b>❌ Please provide a TikTok link</b>\n\n" +
            "<b>Usage:</b> <code>/tik &lt;tiktok_url&gt;</code>",
            PARSE_MODE, null, botKeyValue);
        return;
    }
    
    const r2FileName = `tik_${userId}_${Date.now()}.mp4`;
    let statusMsgId = null;
    
    try {
        const statusResult = await tgRequest(token, 'sendMessage', {
            chat_id: chatId,
            text: "<b>🔍 Processing TikTok...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        statusMsgId = statusResult.result?.message_id;
        
        const apiUrl = `${TIKTOK_API_BASE}?url=${encodeURIComponent(url)}`;
        console.log(`[handleTikTokCommand] Calling: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
            signal: AbortSignal.timeout(30000)
        });
        
        const result = await response.json();
        console.log(`[handleTikTokCommand] Result:`, JSON.stringify(result));
        
        if (!result.success || !result.video_url) {
            throw new Error(result.error || "No video found");
        }
        
        const videoUrl = result.video_url;
        const author = result.author || "Unknown";
        const caption = result.caption || "";
        const stats = result.stats || {};
        const duration = result.duration || "0:00";
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusMsgId,
            text: "<b>⬇️ Downloading...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        await streamToR2(videoUrl, r2FileName, env);
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusMsgId,
            text: "<b>📤 Uploading...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        const user = message.from || {};
        const safeName = escapeHTML(user.first_name || "User");
        
        const captionText = `<b>🎵 TikTok Video</b>\n` +
                            `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                            `<b>🎤 Author:</b> <code>${escapeHTML(author)}</code>\n` +
                            (caption ? `<b>📝 Caption:</b> <i>${escapeHTML(caption)}</i>\n` : '') +
                            `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                            `<b>👁️ Views:</b> ${formatNumber(stats.views)}\n` +
                            `<b>❤️ Likes:</b> ${formatNumber(stats.likes)}\n` +
                            `<b>💬 Comments:</b> ${formatNumber(stats.comments)}\n` +
                            `<b>🔄 Shares:</b> ${formatNumber(stats.shares)}\n` +
                            `<b>⏱️ Duration:</b> ${duration}\n` +
                            `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                            `<b>🔗 Source:</b> <a href="${url}">Watch On TikTok</a>\n` +
                            `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                            `<b>Downloaded By:</b> <a href="tg://user?id=${userId}">${safeName}</a>`;
        
        await sendVideoFromR2(chatId, r2FileName, captionText, token, botKeyValue, env);
        
        if (statusMsgId) {
            await tgRequest(token, 'deleteMessage', { chat_id: chatId, message_id: statusMsgId }, botKeyValue);
        }
        
    } catch (error) {
        console.error("[handleTikTokCommand] Error:", error);
        const errorMessage = `<b>❌ ${escapeHTML(error.message)}</b>`;
        if (statusMsgId) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusMsgId,
                text: errorMessage, parse_mode: PARSE_MODE
            }, botKeyValue);
        }
    } finally {
        await deleteFromR2(r2FileName, env);
    }
}
