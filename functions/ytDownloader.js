// ytDownloader.js - WORKING with your Worker

import { sendMessage } from './telegramApiHelpers.js';

const YT_WORKER_URL = "https://yt-api.mycontrol-bot2.workers.dev";
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

async function streamToR2(mediaUrl, fileName, env) {
    const response = await fetch(mediaUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
    await env.MY_BUCKET.put(fileName, response.body, {
        httpMetadata: { contentType: fileName.endsWith('.mp4') ? 'video/mp4' : 'audio/mpeg' }
    });
    return fileName;
}

async function sendVideoFromR2(chatId, fileName, caption, token, botKeyValue, env) {
    const object = await env.MY_BUCKET.get(fileName);
    if (!object) throw new Error("Video not found");
    const videoBlob = await object.blob();
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('caption', caption);
    formData.append('parse_mode', PARSE_MODE);
    formData.append('supports_streaming', 'true');
    formData.append('video', videoBlob, 'video.mp4');
    const headers = {};
    if (botKeyValue) headers['X-Bot-Key'] = botKeyValue;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        headers: headers,
        body: formData
    });
    return await response.json();
}

async function sendAudioFromR2(chatId, fileName, caption, title, performer, token, botKeyValue, env) {
    const object = await env.MY_BUCKET.get(fileName);
    if (!object) throw new Error("Audio not found");
    const audioBlob = await object.blob();
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('caption', caption);
    formData.append('parse_mode', PARSE_MODE);
    formData.append('title', title.substring(0, 64));
    formData.append('performer', performer.substring(0, 64));
    formData.append('audio', audioBlob, 'audio.mp3');
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
    
    const r2FileName = `yt_${userId}_${Date.now()}.mp4`;
    let statusMsgId = null;
    
    try {
        const statusResult = await tgRequest(token, 'sendMessage', {
            chat_id: chatId,
            text: "<b>🎬 Processing YouTube video...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        statusMsgId = statusResult.result?.message_id;
        
        let finalUrl = input;
        let videoTitle = input;
        let videoChannel = "YouTube";
        
        // Check if it's a URL or search query
        const isUrl = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+/.test(input);
        
        if (!isUrl) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusMsgId,
                text: "<b>🔍 Searching YouTube...</b>",
                parse_mode: PARSE_MODE
            }, botKeyValue);
            
            const searchRes = await fetch(`${YT_WORKER_URL}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: input })
            });
            const searchData = await searchRes.json();
            
            if (!searchData.success) {
                throw new Error(searchData.error || "No results found");
            }
            
            finalUrl = `https://www.youtube.com/watch?v=${searchData.videoId}`;
            videoTitle = searchData.title;
            videoChannel = searchData.channel || "YouTube";
        }
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusMsgId,
            text: "<b>📥 Downloading video...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        const downloadRes = await fetch(`${YT_WORKER_URL}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl: finalUrl, type: 'video' })
        });
        
        const downloadData = await downloadRes.json();
        
        if (!downloadData.success || !downloadData.url) {
            throw new Error(downloadData.error || "Could not get video URL");
        }
        
        await streamToR2(downloadData.url, r2FileName, env);
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusMsgId,
            text: "<b>📤 Uploading to Telegram...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        const user = message.from || {};
        const safeName = escapeHTML(user.first_name || "User");
        
        const caption = `<b>🎥 Title:</b> <code>${escapeHTML(downloadData.title || videoTitle)}</code>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>🎤 Channel:</b> ${escapeHTML(videoChannel)}\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>🔗 Source:</b> <a href="${finalUrl}">Watch on YouTube</a>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>Downloaded By:</b> <a href="tg://user?id=${userId}">${safeName}</a>`;
        
        const sendResult = await sendVideoFromR2(chatId, r2FileName, caption, token, botKeyValue, env);
        
        if (sendResult.ok) {
            await tgRequest(token, 'deleteMessage', { chat_id: chatId, message_id: statusMsgId }, botKeyValue);
        } else {
            throw new Error(sendResult.description || "Telegram refused the file");
        }
        
    } catch (error) {
        console.error("[handleYTCommand] Error:", error);
        if (statusMsgId) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusMsgId,
                text: `<b>❌ ${escapeHTML(error.message)}</b>`,
                parse_mode: PARSE_MODE
            }, botKeyValue);
        }
    } finally {
        await deleteFromR2(r2FileName, env);
    }
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
    
    const r2FileName = `song_${userId}_${Date.now()}.mp3`;
    let statusMsgId = null;
    
    try {
        const statusResult = await tgRequest(token, 'sendMessage', {
            chat_id: chatId,
            text: "<b>🎵 Processing audio...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        statusMsgId = statusResult.result?.message_id;
        
        let finalUrl = input;
        let audioTitle = input;
        let audioChannel = "YouTube";
        
        const isUrl = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+/.test(input);
        
        if (!isUrl) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusMsgId,
                text: "<b>🔍 Searching...</b>",
                parse_mode: PARSE_MODE
            }, botKeyValue);
            
            const searchRes = await fetch(`${YT_WORKER_URL}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: input })
            });
            const searchData = await searchRes.json();
            
            if (!searchData.success) {
                throw new Error(searchData.error || "No results found");
            }
            
            finalUrl = `https://www.youtube.com/watch?v=${searchData.videoId}`;
            audioTitle = searchData.title;
            audioChannel = searchData.channel || "YouTube";
        }
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusMsgId,
            text: "<b>📥 Downloading audio...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        const downloadRes = await fetch(`${YT_WORKER_URL}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl: finalUrl, type: 'audio' })
        });
        
        const downloadData = await downloadRes.json();
        
        if (!downloadData.success || !downloadData.url) {
            throw new Error(downloadData.error || "Could not get audio URL");
        }
        
        await streamToR2(downloadData.url, r2FileName, env);
        
        await tgRequest(token, 'editMessageText', {
            chat_id: chatId, message_id: statusMsgId,
            text: "<b>📤 Uploading to Telegram...</b>",
            parse_mode: PARSE_MODE
        }, botKeyValue);
        
        const user = message.from || {};
        const safeName = escapeHTML(user.first_name || "User");
        
        const caption = `<b>🎵 Title:</b> <code>${escapeHTML(downloadData.title || audioTitle)}</code>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>🎤 Channel:</b> ${escapeHTML(audioChannel)}\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>🔗 Source:</b> <a href="${finalUrl}">Listen on YouTube</a>\n` +
                        `<b>━━━━━━━━━━━━━━━━━━━━━</b>\n` +
                        `<b>Downloaded By:</b> <a href="tg://user?id=${userId}">${safeName}</a>`;
        
        const sendResult = await sendAudioFromR2(chatId, r2FileName, caption, downloadData.title || audioTitle, audioChannel, token, botKeyValue, env);
        
        if (sendResult.ok) {
            await tgRequest(token, 'deleteMessage', { chat_id: chatId, message_id: statusMsgId }, botKeyValue);
        } else {
            throw new Error(sendResult.description || "Telegram refused the file");
        }
        
    } catch (error) {
        console.error("[handleSongCommand] Error:", error);
        if (statusMsgId) {
            await tgRequest(token, 'editMessageText', {
                chat_id: chatId, message_id: statusMsgId,
                text: `<b>❌ ${escapeHTML(error.message)}</b>`,
                parse_mode: PARSE_MODE
            }, botKeyValue);
        }
    } finally {
        await deleteFromR2(r2FileName, env);
    }
}
