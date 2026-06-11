// txDownloader.js
// Twitter/X Video Downloader with R2 Storage

import { sendMessage } from './telegramApiHelpers';

const TX_API_URL = "https://nkka404-360api.hf.space/twitter/dl?url=";
const PARSE_MODE = 'HTML';

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

async function streamToR2(videoUrl, fileName, env) {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error("Failed to fetch video");
    await env.MY_BUCKET.put(fileName, response.body, {
        httpMetadata: { contentType: 'video/mp4' }
    });
    return fileName;
}

async function sendVideoFromR2(chatId, fileName, caption, token, botKeyValue, env) {
    const object = await env.MY_BUCKET.get(fileName);
    if (!object) throw new Error("Video not found in R2");
    
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('caption', caption);
    formData.append('parse_mode', PARSE_MODE);
    formData.append('supports_streaming', 'true');
    formData.append('video', await object.blob(), 'twitter_video.mp4');
    
    const headers = {};
    if (botKeyValue) headers['X-Bot-Key'] = botKeyValue;
    
    const response = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        headers: headers,
        body: formData
    });
    return await response.json();
}

export async function handleTXCommand(message, token, env, botKeyValue) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    let url = message.text.replace(/^\/tx\s+/i, '').trim();
    
    if (!url && message.reply_to_message?.text) {
        const match = message.reply_to_message.text.match(/https?:\/\/(twitter\.com|x\.com)\/\S+/);
        if (match) url = match[0];
    }
    
    if (!url) {
        await sendMessage(token, chatId,
            "<b>❌ Please provide a Twitter/X link</b>\n\nUsage: <code>/tx &lt;url&gt;</code>",
            PARSE_MODE, null, botKeyValue);
        return;
    }
    
    const statusResult = await tgRequest(token, 'sendMessage', {
        chat_id: chatId,
        text: "<b>🔍 Processing Twitter video...</b>",
        parse_mode: PARSE_MODE
    }, botKeyValue);
    const statusId = statusResult.result?.message_id;
    
    const r2FileName = `twitter_${userId}_${Date.now()}.mp4`;
    
    try {
        const apiUrl = `${TX_API_URL}${encodeURIComponent(url)}`;
        const apiRes = await fetch(apiUrl, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
            signal: AbortSignal.timeout(30000)
        });
        const json = await apiRes.json();
        
        let videoLink = null, title = "Twitter Video";
        
        if (json.success && json.data) {
            videoLink = json.data.video_url || json.data.download_url;
            title = json.data.title || "Twitter Video";
        } else if (json.status === "success" && json.data?.results) {
            videoLink = json.data.results.audio || (json.data.results.videos && json.data.results.videos[0]);
            title = json.data.results.title || "Twitter Video";
        } else {
            throw new Error("No video found");
        }
        
        if (!videoLink) throw new Error("No video URL found");
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusId,
            text: "<b>⬇️ Downloading...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        await streamToR2(videoLink, r2FileName, env);
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusId,
            text: "<b>📤 Uploading to Telegram...</b>",
            parse_mode: PARSE_MODE        }, botKeyValue);
        
        const user = message.from || {};
        const userName = escapeHTML([user.first_name, user.last_name].filter(Boolean).join(' ') || "User");
        
        const caption = `<b>🐦 Title:</b> ${escapeHTML(title)}\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>🔗 Source:</b> <a href="${url}">Watch on Twitter</a>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>Downloaded By:</b> <a href="tg://user?id=${userId}">${userName}</a>`;
        
        const sendResult = await sendVideoFromR2(chatId, r2FileName, caption, token, botKeyValue, env);
        
        if (sendResult.ok) {
            await tgRequest(token, 'deleteMessage', { chat_id: chatId, message_id: statusId }, botKeyValue);
        } else {
            throw new Error(sendResult.description || "Failed to send");
        }
        
    } catch (error) {
        console.error("[handleTXCommand] Error:", error);
        if (statusId) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusId,
                text: `<b>❌ ${escapeHTML(error.message)}</b>`,
                parse_mode: PARSE_MODE
            }, botKeyValue);
        }
    } finally {
        try { await env.MY_BUCKET.delete(r2FileName); } catch(e) {}
    }
}
