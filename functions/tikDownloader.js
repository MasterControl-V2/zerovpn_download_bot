// tikDownloader.js
// TikTok Video Downloader

import { sendMessage } from './telegramApiHelpers';

const TIKTOK_API_BASE = "https://nkka404-360api.hf.space/tik/dl?url=";
const PARSE_MODE = 'HTML';

function escapeHTML(text = '') {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatNumber(num) {
    return num ? num.toLocaleString() : "0";
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

export async function handleTikTokCommand(message, token, env, botKeyValue) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text || '';
    let url = text.split(' ').slice(1).join(' ').trim();
    
    if (!url && message.reply_to_message?.text) {
        const match = message.reply_to_message.text.match(/https?:\/\/(vm\.tiktok\.com|www\.tiktok\.com|vt\.tiktok\.com|tiktok\.com)\/\S+/);
        if (match) url = match[0];
    }
    
    if (!url) {
        await sendMessage(token, chatId,
            "<b>❌ Please provide a TikTok link</b>\n\nUsage: <code>/tik &lt;url&gt;</code>",
            PARSE_MODE, null, botKeyValue);
        return;
    }
    
    const statusResult = await tgRequest(token, 'sendMessage', {
        chat_id: chatId,
        text: "<b>🔍 Analyzing TikTok...</b>",
        parse_mode: PARSE_MODE
    }, botKeyValue);
    const statusId = statusResult.result?.message_id;
    
    try {
        const apiUrl = `${TIKTOK_API_BASE}${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
            signal: AbortSignal.timeout(30000)
        });
        const resultJson = await response.json();
        
        let videoUrl = null, title = "TikTok Content", author = "TikToker", stats = { plays: 0, likes: 0 };
        
        if (resultJson.success && resultJson.data) {
            const data = resultJson.data;
            videoUrl = data.video_url || data.download_url;
            title = data.title || "TikTok Content";
            author = data.author || "TikToker";
            stats = { plays: data.plays || 0, likes: data.likes || 0 };
        } else if (resultJson.status === 'success' && resultJson.data) {
            videoUrl = resultJson.data.download_url;
            title = resultJson.data.title || "TikTok Content";
            author = resultJson.data.author || "TikToker";
            stats = resultJson.data.stats || { plays: 0, likes: 0 };
        } else {
            throw new Error("No video found");
        }
        
        if (!videoUrl) throw new Error("No video URL found");
        
        const user = message.from || {};
        const fullName = escapeHTML([user.first_name, user.last_name].filter(Boolean).join(' ') || "User");
        
        const caption = `<b>🎥 Title:</b> <code>${escapeHTML(title).substring(0, 600)}</code>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>🎨 Author:</b> ${escapeHTML(author)}\n` +
                        `<b>👁️ Views:</b> ${formatNumber(stats.plays)}\n` +
                        `<b>❤️ Likes:</b> ${formatNumber(stats.likes)}\n` +
                        `<b>🔗 Source:</b> <a href="${url}">Watch On TikTok</a>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>Downloaded By:</b> <a href="tg://user?id=${userId}">${fullName}</a>`;
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusId,
            text: "<b>📤 Sending video...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        const sendResult = await tgRequest(token, 'sendVideo', {
            chat_id: chatId,
            video: videoUrl,
            caption: caption,
            parse_mode: PARSE_MODE,
            supports_streaming: true
        }, botKeyValue);
        
        if (sendResult.ok) {
            await tgRequest(token, 'deleteMessage', { chat_id: chatId, message_id: statusId }, botKeyValue);
        } else {
            throw new Error(sendResult.description || "Failed to send");
        }
        
    } catch (error) {
        console.error("[handleTikTokCommand] Error:", error);
        if (statusId) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusId,
                text: `<b>❌ ${escapeHTML(error.message)}</b>`,
                parse_mode: PARSE_MODE
            }, botKeyValue);
        }
    }
}
