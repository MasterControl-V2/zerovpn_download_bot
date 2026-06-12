// tikDownloader.js - UPDATED for /tik endpoint
// Works with FastAPI backend (tik.py)

import { sendMessage } from './telegramApiHelpers.js';

// Use your own backend API endpoint
// If you have tik.py deployed, put your URL here
const TIKTOK_API_BASE = "https://YOUR-BACKEND-URL.pages.dev/tik/dl"; // ⚠️ CHANGE THIS
const PARSE_MODE = 'HTML';

function escapeHTML(text = '') {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatNumber(num) {
    if (!num) return "0";
    return Number(num).toLocaleString();
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
    console.log(`[streamToR2] Downloading: ${videoUrl.substring(0, 100)}...`);
    const response = await fetch(videoUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "video/*"
        }
    });
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
    await env.MY_BUCKET.put(fileName, response.body, {
        httpMetadata: { contentType: 'video/mp4' }
    });
    console.log(`[streamToR2] Saved to R2: ${fileName}`);
    return fileName;
}

async function sendVideoFromR2(chatId, fileName, caption, token, botKeyValue, env) {
    const object = await env.MY_BUCKET.get(fileName);
    if (!object) throw new Error("Video not found in R2");
    const videoBlob = await object.blob();
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('caption', caption);
    formData.append('parse_mode', PARSE_MODE);
    formData.append('supports_streaming', 'true');
    formData.append('video', videoBlob, 'tiktok_video.mp4');
    
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
    
    // Check if URL is in replied message
    if (!url && message.reply_to_message && message.reply_to_message.text) {
        const match = message.reply_to_message.text.match(/https?:\/\/(vm\.tiktok\.com|www\.tiktok\.com|vt\.tiktok\.com|tiktok\.com)\/\S+/);
        if (match) url = match[0];
    }
    
    if (!url) {
        await sendMessage(token, chatId,
            "<b>❌ Please provide a TikTok link</b>\n\n" +
            "<b>Usage:</b> <code>/tik &lt;tiktok_video_url&gt;</code>\n" +
            "<b>Or reply</b> to a message containing TikTok link with <code>/tik</code>",
            PARSE_MODE, null, botKeyValue);
        return;
    }
    
    const r2FileName = `tik_${userId}_${Date.now()}.mp4`;
    let statusMsgId = null;
    
    try {
        // Send initial status
        const statusResult = await tgRequest(token, 'sendMessage', {
            chat_id: chatId,
            text: "<b>🔍 Processing TikTok video...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        statusMsgId = statusResult.result?.message_id;
        
        // ✅ FIXED: Call the FastAPI backend
        const apiUrl = `${TIKTOK_API_BASE}?url=${encodeURIComponent(url)}`;
        console.log(`[handleTikTokCommand] Calling API: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json"
            },
            signal: AbortSignal.timeout(30000)
        });
        
        const result = await response.json();
        console.log(`[handleTikTokCommand] API Response:`, JSON.stringify(result, null, 2));
        
        // ✅ FIXED: Parse the correct response format
        if (!result.success || !result.links || result.links.length === 0) {
            throw new Error(result.error || "No video links found");
        }
        
        // Get the first video link
        const videoData = result.links[0];
        const videoUrl = videoData.url;
        const filename = videoData.filename || "tiktok_video.mp4";
        
        console.log(`[handleTikTokCommand] Found video: ${filename}`);
        
        // Update status
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusMsgId,
            text: "<b>☑️ Video found! Downloading...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        // Download to R2
        await streamToR2(videoUrl, r2FileName, env);
        
        // Update status
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusMsgId,
            text: "<b>📤 Uploading to Telegram...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        // Prepare caption
        const user = message.from || {};
        const safeName = escapeHTML([user.first_name, user.last_name].filter(Boolean).join(' ') || "User");
        
        // Extract video ID from URL for display
        const videoId = url.split('/').pop() || "TikTok";
        
        const caption = `<b>🎵 TikTok Video</b>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>🎬 ID:</b> <code>${escapeHTML(videoId)}</code>\n` +
                        `<b>🔗 Source:</b> <a href="${url}">Watch On TikTok</a>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>Downloaded By:</b> <a href="tg://user?id=${userId}">${safeName}</a>`;
        
        // Send video
        const sendResult = await sendVideoFromR2(chatId, r2FileName, caption, token, botKeyValue, env);
        
        if (sendResult.ok) {
            // Delete status message
            await tgRequest(token, 'deleteMessage', { chat_id: chatId, message_id: statusMsgId }, botKeyValue);
        } else {
            throw new Error(sendResult.description || "Telegram refused the file");
        }
        
    } catch (error) {
        console.error("[handleTikTokCommand] Error:", error);
        const errorMessage = `<b>❌ Error: ${escapeHTML(error.message)}</b>\n\n` +
                             `<b>Possible reasons:</b>\n` +
                             `• Video is private or deleted\n` +
                             `• TikTok link is invalid\n` +
                             `• Try a different video`;
        if (statusMsgId) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusMsgId,
                text: errorMessage, parse_mode: PARSE_MODE
            }, botKeyValue);
        } else {
            await sendMessage(token, chatId, errorMessage, PARSE_MODE, null, botKeyValue);
        }
    } finally {
        // Clean up R2 file
        await deleteFromR2(r2FileName, env);
    }
}
