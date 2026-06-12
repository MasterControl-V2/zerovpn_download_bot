// ============================================================
// FILE: functions/tikDownloader.js
// ============================================================

import { sendMessage } from './telegramApiHelpers.js';

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
            "<b>Usage:</b> <code>/tik &lt;tiktok_video_url&gt;</code>",
            PARSE_MODE, null, botKeyValue);
        return;
    }
    
    const statusResult = await tgRequest(token, 'sendMessage', {
        chat_id: chatId,
        text: "<b>🔍 Analyzing TikTok Content...</b>",
        parse_mode: PARSE_MODE
    }, botKeyValue);
    const statusId = statusResult.result?.message_id;
    
    try {
        const response = await fetch(`${TIKTOK_API_BASE}${encodeURIComponent(url)}`, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
            signal: AbortSignal.timeout(30000)
        });
        const resultJson = await response.json();
        
        if (!resultJson || resultJson.status !== 'success') {
            throw new Error(resultJson?.message || "Extraction failed.");
        }
        
        const videoData = resultJson.data;
        const stats = videoData.stats || {};
        const videoUrl = videoData.download_url;
        const audioUrl = videoData.music_cover;
        
        const user = message.from || {};
        const fullName = escapeHTML([user.first_name, user.last_name].filter(Boolean).join(' ') || "User");
        let videoTitle = videoData.title || "TikTok Content";
        if (videoTitle.length > 600) videoTitle = videoTitle.substring(0, 600) + "...";
        
        const caption = `<b>🎥 Title:</b> <code>${escapeHTML(videoTitle)}</code>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>🎨 Author:</b> <code>${escapeHTML(videoData.author || "TikToker")}</code>\n` +
                        `<b>👁‍🗨 Views:</b> ${formatNumber(stats.plays)}\n` +
                        `<b>❤️ Likes:</b> ${formatNumber(stats.likes)}\n` +
                        `<b>🔗 Source:</b> <a href="${url}">Watch On TikTok</a>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>Downloaded By:</b> <a href="tg://user?id=${userId}">${fullName}</a>`;
        
        if (videoUrl) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusId,
                text: "<b>Found Video! ☑️ Uploading...</b>",
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
                throw new Error(sendResult.description || "Failed to send video");
            }
        } else if (audioUrl) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusId,
                text: "<b>Sending Audio instead... 🎵</b>",
                parse_mode: PARSE_MODE
            }, botKeyValue);
            
            const sendResult = await tgRequest(token, 'sendAudio', {
                chat_id: chatId,
                audio: audioUrl,
                caption: caption,
                parse_mode: PARSE_MODE
            }, botKeyValue);
            
            if (sendResult.ok) {
                await tgRequest(token, 'deleteMessage', { chat_id: chatId, message_id: statusId }, botKeyValue);
            } else {
                throw new Error(sendResult.description || "Failed to send audio");
            }
        } else {
            throw new Error("No video or audio found.");
        }
    } catch (error) {
        console.error("[handleTikTokCommand] Error:", error);
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusId,
            text: `<b>❌ Error: ${escapeHTML(error.message)}</b>`,
            parse_mode: PARSE_MODE
        }, botKeyValue);
    }
}
