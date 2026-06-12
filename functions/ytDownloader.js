// ytDownloader.js
// YouTube Video & Audio Downloader with R2 Storage
// Fixed: Support API response format from nyeinkokoaung.alwaysdata.net

import { sendMessage } from './telegramApiHelpers';

const YT_API_URL = "https://nyeinkokoaung.alwaysdata.net/yt/dl-api.php";
const YT_SEARCH_API_URL = "https://nyeinkokoaung.alwaysdata.net/yt/search-info-api.php";
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

async function streamToR2(mediaUrl, fileName, type, env) {
    const response = await fetch(mediaUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
            'Accept': '*/*',
            'Referer': 'https://www.youtube.com/'
        }
    });
    if (!response.ok) throw new Error(`Failed to fetch ${type} source`);
    
    await env.MY_BUCKET.put(fileName, response.body, {
        httpMetadata: { contentType: type === 'video' ? 'video/mp4' : 'audio/mpeg' }
    });
    return fileName;
}

async function sendVideoFromR2(chatId, fileName, caption, thumbUrl, token, botKeyValue, env) {
    const object = await env.MY_BUCKET.get(fileName);
    if (!object) throw new Error("Video not found in R2");
    
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('caption', caption);
    formData.append('parse_mode', PARSE_MODE);
    formData.append('supports_streaming', 'true');
    formData.append('video', await object.blob(), 'video.mp4');
    
    if (thumbUrl) {
        try {
            const thumbRes = await fetch(thumbUrl);
            if (thumbRes.ok) formData.append('thumbnail', await thumbRes.blob(), 'thumb.jpg');
        } catch(e) {}
    }
    
    const headers = {};
    if (botKeyValue) headers['X-Bot-Key'] = botKeyValue;
    
    const response = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        headers: headers,
        body: formData
    });
    return await response.json();
}

async function sendAudioFromR2(chatId, fileName, caption, videoDetails, token, botKeyValue, env) {
    const object = await env.MY_BUCKET.get(fileName);
    if (!object) throw new Error("Audio not found in R2");
    
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('caption', caption);
    formData.append('parse_mode', PARSE_MODE);
    formData.append('title', videoDetails.title.substring(0, 64));
    formData.append('performer', videoDetails.channel.substring(0, 64));
    formData.append('audio', await object.blob(), `${videoDetails.title.substring(0, 20)}.mp3`);
    
    if (videoDetails.thumbnail) {
        try {
            const thumbRes = await fetch(videoDetails.thumbnail);
            if (thumbRes.ok) formData.append('thumbnail', await thumbRes.blob(), 'thumb.jpg');
        } catch(e) {}
    }
    
    const headers = {};
    if (botKeyValue) headers['X-Bot-Key'] = botKeyValue;
    
    const response = await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
        method: 'POST',
        headers: headers,
        body: formData
    });
    return await response.json();
}

async function searchYouTube(query) {
    const searchUrl = `${YT_SEARCH_API_URL}?action=search&query=${encodeURIComponent(query)}&limit=1`;
    const response = await fetch(searchUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json"
        },
        signal: AbortSignal.timeout(30000)
    });
    const data = await response.json();
    if (!data.success || !data.data.length) throw new Error("No results found");
    return data.data[0];
}

async function getYouTubeDownloadInfo(url) {
    const downloadUrl = `${YT_API_URL}?url=${encodeURIComponent(url)}`;
    console.log(`[getYouTubeDownloadInfo] Fetching: ${downloadUrl}`);
    
    const response = await fetch(downloadUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json"
        },
        signal: AbortSignal.timeout(30000)
    });
    const data = await response.json();
    console.log(`[getYouTubeDownloadInfo] Response:`, JSON.stringify(data));
    
    if (!data.success) throw new Error(data.error || "Could not extract video data");
    
    // ✅ API response structure: { success: true, result: { title, author, medias: [...] } }
    const result = data.result || data;
    const medias = result.medias || [];
    
    console.log(`[getYouTubeDownloadInfo] Found ${medias.length} media items`);
    
    return {
        success: true,
        data: {
            title: result.title || "Unknown Title",
            channel: result.author || result.channel || "Unknown Channel",
            views: result.views || "N/A",
            thumbnail: result.thumbnail || null,
            medias: medias.map(m => ({
                url: m.url,
                type: m.type || (m.hasVideo ? 'video' : 'audio'),
                quality: m.quality,
                size: m.size
            }))
        }
    };
}

async function checkFileSize(url) {
    try {
        const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        const size = parseInt(response.headers.get('content-length') || '0');
        return size / (1024 * 1024);
    } catch (e) {
        return null;
    }
}

async function processYTRequest(chatId, userId, message, input, mode, token, env, botKeyValue) {
    let statusId = null;
    const r2FileName = `yt_${userId}_${Date.now()}.${mode === 'audio' ? 'mp3' : 'mp4'}`;
    
    try {
        const statusResult = await tgRequest(token, 'sendMessage', {
            chat_id: chatId,
            text: mode === 'video' ? "<b>🎬 Processing YouTube Video...</b>" : "<b>🎵 Processing YouTube Audio...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        statusId = statusResult.result?.message_id;
        
        let finalUrl = input;
        let videoDetails = { views: "N/A", title: "Unknown", thumbnail: null, channel: "Unknown" };
        const isUrl = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+/.test(input);
        
        if (!isUrl) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusId,
                text: "<b>🔍 Searching YouTube...</b>",
                parse_mode: PARSE_MODE
            }, botKeyValue);
            const searchResult = await searchYouTube(input);
            finalUrl = `https://www.youtube.com/watch?v=${searchResult.videoId}`;
            videoDetails = {
                views: searchResult.viewCount,
                title: searchResult.title,
                thumbnail: searchResult.thumbnail,
                channel: searchResult.channel
            };
        }
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusId,
            text: "<b>📡 Getting download link...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        const dlData = await getYouTubeDownloadInfo(finalUrl);
        
        if (isUrl) {
            videoDetails = {
                views: dlData.data.views,
                title: dlData.data.title,
                thumbnail: dlData.data.thumbnail,
                channel: dlData.data.channel
            };
        }
        
        // ✅ Find media by type (case insensitive)
        const medias = dlData.data.medias || [];
        let downloadObj = null;
        
        if (mode === 'audio') {
            downloadObj = medias.find(m => m.type && m.type.toLowerCase() === 'audio');
            if (!downloadObj) downloadObj = medias.find(m => m.type && m.type.toLowerCase() !== 'video');
        } else {
            downloadObj = medias.find(m => m.type && m.type.toLowerCase() === 'video');
            if (!downloadObj) downloadObj = medias[0];
        }
        
        if (!downloadObj || !downloadObj.url) {
            console.error(`[processYTRequest] No media found. Medias:`, JSON.stringify(medias));
            throw new Error("No compatible format found");
        }
        
        console.log(`[processYTRequest] Selected ${mode}: ${downloadObj.type} - ${downloadObj.quality}`);
        
        const fileSizeMB = await checkFileSize(downloadObj.url);
        if (fileSizeMB !== null && fileSizeMB > 100) {
            throw new Error(`File too large (${fileSizeMB.toFixed(1)} MB). Max 100MB.`);
        }
        
        const user = message.from || {};
        const fullName = escapeHTML([user.first_name, user.last_name].filter(Boolean).join(' ') || "User");
        
        const caption = `<b>${mode === 'audio' ? '🎵' : '🎥'} Title:</b> <code>${escapeHTML(videoDetails.title)}</code>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>👁️ Views:</b> ${videoDetails.views}\n` +
                        `<b>🎤 Channel:</b> ${escapeHTML(videoDetails.channel)}\n` +
                        `<b>🔗 URL:</b> <a href="${finalUrl}">Watch on YouTube</a>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>Downloaded By:</b> <a href="tg://user?id=${userId}">${fullName}</a>`;
        
        await streamToR2(downloadObj.url, r2FileName, mode, env);
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusId,
            text: "<b>📤 Uploading to Telegram...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        let result;
        if (mode === 'audio') {
            result = await sendAudioFromR2(chatId, r2FileName, caption, videoDetails, token, botKeyValue, env);
        } else {
            result = await sendVideoFromR2(chatId, r2FileName, caption, videoDetails.thumbnail, token, botKeyValue, env);
        }
        
        if (result.ok) {
            await tgRequest(token, 'deleteMessage', { chat_id: chatId, message_id: statusId }, botKeyValue);
        } else {
            throw new Error(result.description || "Telegram refused the file");
        }
        
    } catch (error) {
        console.error("[processYTRequest] Error:", error);
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

export async function handleYTCommand(message, token, env, botKeyValue) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    let input = message.text.replace(/^\/yt\s+/i, '').replace(/^\/youtube\s+/i, '').trim();
    if (!input && message.reply_to_message?.text) input = message.reply_to_message.text.trim();
    if (!input) {
        await sendMessage(token, chatId, "<b>❌ Usage:</b> <code>/yt &lt;YouTube link or search&gt;</code>", PARSE_MODE, null, botKeyValue);
        return;
    }
    await processYTRequest(chatId, userId, message, input, 'video', token, env, botKeyValue);
}

export async function handleSongCommand(message, token, env, botKeyValue) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    let input = message.text.replace(/^\/song\s+/i, '').replace(/^\/audio\s+/i, '').trim();
    if (!input && message.reply_to_message?.text) input = message.reply_to_message.text.trim();
    if (!input) {
        await sendMessage(token, chatId, "<b>❌ Usage:</b> <code>/song &lt;song name or link&gt;</code>", PARSE_MODE, null, botKeyValue);
        return;
    }
    await processYTRequest(chatId, userId, message, input, 'audio', token, env, botKeyValue);
}
