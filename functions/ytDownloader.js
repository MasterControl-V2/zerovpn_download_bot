// ytDownloader.js
// YouTube Video & Audio Downloader using your own API

import { sendMessage, sendVideo, sendAudio } from './telegramApiHelpers.js';
import { YT_API_BASE, YT_SEARCH_API_BASE, PARSE_MODE } from './constants.js';

function escapeHTML(text = '') {
    if (!text) return '';
    return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function searchYouTube(query) {
    const searchUrl = `${YT_SEARCH_API_BASE}${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, { signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    
    if (!data.search_results || data.search_results.length === 0) {
        throw new Error("No results found");
    }
    return data.search_results[0];
}

async function getVideoInfo(url) {
    const apiUrl = `${YT_API_BASE}${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
    return await response.json();
}

export async function handleYTCommand(message, token, env) {
    const chatId = message.chat.id;
    const text = message.text || '';
    const args = text.split(' ');
    args.shift();
    let input = args.join(' ').trim();
    
    if (!input && message.reply_to_message?.text) {
        input = message.reply_to_message.text.trim();
    }
    
    if (!input) {
        await sendMessage(token, chatId,
            "<b>❌ Please provide a YouTube link or search</b>\n\nUsage: <code>/yt &lt;url_or_query&gt;</code>",
            PARSE_MODE);
        return;
    }
    
    try {
        const statusMsg = await sendMessage(token, chatId, "<b>🔍 Processing YouTube...</b>", PARSE_MODE);
        const statusId = statusMsg.result?.message_id;
        
        let finalUrl = input;
        let videoInfo = null;
        
        const isUrl = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+/.test(input);
        
        if (!isUrl) {
            const searchResult = await searchYouTube(input);
            finalUrl = searchResult.url;
        }
        
        videoInfo = await getVideoInfo(finalUrl);
        
        if (!videoInfo.download_url) {
            throw new Error("No video found");
        }
        
        const videoUrl = videoInfo.download_url;
        const title = escapeHTML(videoInfo.title || "YouTube Video");
        const channel = escapeHTML(videoInfo.channel || "Unknown");
        const views = videoInfo.views || "N/A";
        
        const caption = `<b>🎥 Title:</b> <code>${title}</code>\n━━━━━━━━━━━━━━━━━━━━━\n<b>👁️ Views:</b> ${views}\n<b>🎤 Channel:</b> ${channel}\n🔗 <a href="${finalUrl}">Watch on YouTube</a>`;
        
        const result = await sendVideo(token, chatId, videoUrl, caption, PARSE_MODE);
        
        if (result.ok && statusId) {
            await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, message_id: statusId })
            });
        } else if (!result.ok) {
            throw new Error(result.description || "Failed to send");
        }
        
    } catch (error) {
        console.error("[YT] Error:", error);
        await sendMessage(token, chatId, `<b>❌ Error: ${escapeHTML(error.message)}</b>`, PARSE_MODE);
    }
}

export async function handleSongCommand(message, token, env) {
    const chatId = message.chat.id;
    const text = message.text || '';
    const args = text.split(' ');
    args.shift();
    let input = args.join(' ').trim();
    
    if (!input && message.reply_to_message?.text) {
        input = message.reply_to_message.text.trim();
    }
    
    if (!input) {
        await sendMessage(token, chatId,
            "<b>❌ Please provide a song name or YouTube link</b>\n\nUsage: <code>/song &lt;name_or_url&gt;</code>",
            PARSE_MODE);
        return;
    }
    
    try {
        const statusMsg = await sendMessage(token, chatId, "<b>🎵 Processing audio...</b>", PARSE_MODE);
        const statusId = statusMsg.result?.message_id;
        
        let finalUrl = input;
        let videoInfo = null;
        
        const isUrl = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+/.test(input);
        
        if (!isUrl) {
            const searchResult = await searchYouTube(input);
            finalUrl = searchResult.url;
        }
        
        videoInfo = await getVideoInfo(finalUrl);
        
        if (!videoInfo.audio_url) {
            throw new Error("No audio found");
        }
        
        const audioUrl = videoInfo.audio_url;
        const title = escapeHTML(videoInfo.title || "YouTube Audio");
        const channel = escapeHTML(videoInfo.channel || "Unknown");
        
        const caption = `<b>🎵 Title:</b> <code>${title}</code>\n<b>🎤 Artist:</b> ${channel}\n🔗 <a href="${finalUrl}">Source</a>`;
        
        const result = await sendAudio(token, chatId, audioUrl, caption, title.substring(0, 64), channel.substring(0, 64), PARSE_MODE);
        
        if (result.ok && statusId) {
            await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, message_id: statusId })
            });
        } else if (!result.ok) {
            throw new Error(result.description || "Failed to send");
        }
        
    } catch (error) {
        console.error("[Song] Error:", error);
        await sendMessage(token, chatId, `<b>❌ Error: ${escapeHTML(error.message)}</b>`, PARSE_MODE);
    }
}
