// ytDownloader.js - WORKING VERSION with Worker API

import { sendMessage } from './telegramApiHelpers.js';

const YT_WORKER_URL = "https://yt-api.mycontrol-bot2.workers.dev/yt/dl?url"; // Change to your worker URL
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
            'Accept': type === 'video' ? 'video/*' : 'audio/*'
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

async function deleteFromR2(fileName, env) {
    try { await env.MY_BUCKET.delete(fileName); } catch(e) {}
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
        
        // If not URL, search
        if (!isUrl) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusId,
                text: "<b>🔍 Searching YouTube...</b>",
                parse_mode: PARSE_MODE
            }, botKeyValue);
            
            const searchRes = await fetch(`${YT_WORKER_URL}/yt/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: input })
            });
            const searchData = await searchRes.json();
            
            if (!searchData.success) {
                throw new Error("No results found");
            }
            
            finalUrl = `https://www.youtube.com/watch?v=${searchData.videoId}`;
            videoDetails = {
                views: "N/A",
                title: searchData.title,
                thumbnail: searchData.thumbnail,
                channel: searchData.channel
            };
        }
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusId,
            text: "<b>Found! ☑️ Getting video info...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        // Get download info
        const endpoint = mode === 'audio' ? '/yt/audio' : '/yt/info';
        const infoRes = await fetch(`${YT_WORKER_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl: finalUrl })
        });
        
        const infoData = await infoRes.json();
        
        if (!infoData.success) {
            throw new Error(infoData.error || "Could not get download URL");
        }
        
        if (mode === 'audio') {
            videoDetails = {
                title: infoData.title,
                channel: infoData.channel,
                thumbnail: infoData.thumbnail,
                views: "N/A"
            };
            await streamToR2(infoData.audio_url, r2FileName, 'audio', env);
        } else {
            videoDetails = {
                title: infoData.title,
                channel: infoData.channel,
                thumbnail: infoData.thumbnail,
                views: infoData.views
            };
            await streamToR2(infoData.video_url, r2FileName, 'video', env);
        }
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusId,
            text: "<b>📥 Uploading to Telegram...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        const user = message.from || {};
        const fullName = escapeHTML([user.first_name, user.last_name].filter(Boolean).join(' ') || "User");
        
        const caption = `<b>${mode === 'audio' ? '🎵' : '🎥'} Title:</b> <code>${escapeHTML(videoDetails.title)}</code>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>👁️‍🗨️ Views:</b> ${videoDetails.views}\n` +
                        `<b>🎤 Channel:</b> ${escapeHTML(videoDetails.channel)}\n` +
                        `<b>🔗 URL:</b> <a href="${finalUrl}">Watch on YouTube</a>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>Downloaded By:</b> <a href="tg://user?id=${userId}">${fullName}</a>`;
        
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
        try { await deleteFromR2(r2FileName, env); } catch(e) {}
    }
}

export async function handleYTCommand(message, token, env, botKeyValue) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text || '';
    const args = text.split(' ');
    args.shift();
    let input = args.join(' ').trim();
    
    if (!input && message.reply_to_message && message.reply_to_message.text) {
        input = message.reply_to_message.text.trim();
    }
    
    if (!input) {
        await sendMessage(token, chatId,
            "<b>❌ Please provide a YouTube link or search query</b>\n\n" +
            "<b>Usage:</b> <code>/yt &lt;youtube_url_or_search&gt;</code>",
            PARSE_MODE, null, botKeyValue);
        return;
    }
    
    await processYTRequest(chatId, userId, message, input, 'video', token, env, botKeyValue);
}

export async function handleSongCommand(message, token, env, botKeyValue) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text || '';
    const args = text.split(' ');
    args.shift();
    let input = args.join(' ').trim();
    
    if (!input && message.reply_to_message && message.reply_to_message.text) {
        input = message.reply_to_message.text.trim();
    }
    
    if (!input) {
        await sendMessage(token, chatId,
            "<b>❌ Please provide a song name or YouTube link</b>\n\n" +
            "<b>Usage:</b> <code>/song &lt;song_name_or_url&gt;</code>",
            PARSE_MODE, null, botKeyValue);
        return;
    }
    
    await processYTRequest(chatId, userId, message, input, 'audio', token, env, botKeyValue);
}
