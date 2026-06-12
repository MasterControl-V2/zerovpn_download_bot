// fbDownloader.js
// Facebook Video Downloader with R2 Storage
// Fixed: Support new API response format with download_urls array

import { sendMessage } from './telegramApiHelpers';

const FB_API_BASE = "https://nkka404-360api.hf.space/fb/dl?url=";
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
    const response = await fetch(videoUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "video/*",
            "Referer": "https://facebook.com/"
        },
        signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`);
    
    await env.MY_BUCKET.put(fileName, response.body, {
        httpMetadata: { contentType: 'video/mp4' }
    });
    return fileName;
}

async function sendVideoFromR2(chatId, fileName, caption, thumbUrl, token, botKeyValue, env) {
    const object = await env.MY_BUCKET.get(fileName);
    if (!object) throw new Error("Video not found in R2");
    
    const videoBlob = await object.blob();
    const fileSizeMB = videoBlob.size / (1024 * 1024);
    
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('caption', caption);
    formData.append('parse_mode', PARSE_MODE);
    formData.append('supports_streaming', 'true');
    
    const useDocument = fileSizeMB > 50;
    const fieldName = useDocument ? 'document' : 'video';
    formData.append(fieldName, videoBlob, useDocument ? 'facebook_video.mp4' : 'video.mp4');
    
    if (thumbUrl) {
        try {
            const thumbRes = await fetch(thumbUrl);
            if (thumbRes.ok) formData.append('thumbnail', await thumbRes.blob(), 'thumb.jpg');
        } catch(e) {}
    }
    
    const headers = {};
    if (botKeyValue) headers['X-Bot-Key'] = botKeyValue;
    
    const response = await fetch(`https://api.telegram.org/bot${token}/send${useDocument ? 'Document' : 'Video'}`, {
        method: 'POST',
        headers: headers,
        body: formData
    });
    return await response.json();
}

async function deleteFromR2(fileName, env) {
    try { await env.MY_BUCKET.delete(fileName); } catch(e) {}
}

export async function handleFBCommand(message, token, env, botKeyValue) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text || '';
    let url = text.split(' ').slice(1).join(' ').trim();
    
    if (!url && message.reply_to_message?.text) {
        const fbMatch = message.reply_to_message.text.match(/https?:\/\/(www\.|m\.)?facebook\.com\/\S+|https?:\/\/fb\.watch\/\S+/);
        if (fbMatch) url = fbMatch[0];
    }
    
    if (!url) {
        await sendMessage(token, chatId, 
            "<b>❌ Please provide a Facebook Video Link</b>\n\nUsage: <code>/fb &lt;url&gt;</code>",
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
        console.log(`[handleFBCommand] API URL: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
            signal: AbortSignal.timeout(30000)
        });
        const data = await response.json();
        console.log(`[handleFBCommand] API Response:`, JSON.stringify(data));
        
        let videoUrl = null;
        let title = "Facebook Video";
        let thumb = null;
        
        // ✅ NEW API FORMAT: { status: "success", data: { title, thumbnail, download_urls: [{ type, quality, url }] } }
        if (data.status === "success" && data.data) {
            title = data.data.title || "Facebook Video";
            thumb = data.data.thumbnail;
            
            const downloadUrls = data.data.download_urls || [];
            // Prioritize HD > video > first available
            let bestVideo = downloadUrls.find(v => v.quality === "HD" && v.type === "video");
            if (!bestVideo) bestVideo = downloadUrls.find(v => v.type === "video");
            if (!bestVideo) bestVideo = downloadUrls[0];
            
            if (bestVideo && bestVideo.url) {
                videoUrl = bestVideo.url;
            }
        }
        // ✅ OLD API FORMAT: { links: [{ url, quality }] }
        else if (data.links && data.links.length > 0) {
            const videoObj = data.links.find(l => l.quality === "HD") || 
                             data.links.find(l => l.quality === "video+audio") || 
                             data.links[0];
            videoUrl = videoObj.url;
            title = data.title || "Facebook Video";
            thumb = data.thumbnail;
        }
        
        if (!videoUrl) {
            console.error("[handleFBCommand] Could not extract video URL from response");
            throw new Error("No video URL found in API response");
        }
        
        console.log(`[handleFBCommand] Extracted video URL: ${videoUrl.substring(0, 100)}...`);
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusMsgId,
            text: "<b>☑️ Downloading to R2...</b>",
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
        
        const caption = `<b>📹 Title:</b> <code>${escapeHTML(title).substring(0, 200)}</code>\n` +
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
        if (statusMsgId) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusMsgId,
                text: `<b>❌ Error: ${escapeHTML(error.message)}</b>\n\nPlease check the link and try again.`,
                parse_mode: PARSE_MODE
            }, botKeyValue);
        } else {
            await sendMessage(token, chatId, `<b>❌ Error: ${escapeHTML(error.message)}</b>`, PARSE_MODE, null, botKeyValue);
        }
    } finally {
        await deleteFromR2(r2FileName, env);
    }
}
