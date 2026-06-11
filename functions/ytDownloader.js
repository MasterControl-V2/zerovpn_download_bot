// ytDownloader.js
// YouTube Video & Audio Downloader - Original Logic

import { sendMessage, sendVideo, sendAudio } from './telegramApiHelpers.js';
import { YT_API_URL, YT_SEARCH_API_URL, PARSE_MODE } from './constants.js';

function escapeHTML(text = '') {
    if (!text) return '';
    return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function searchYouTube(query) {
    const searchUrl = `${YT_SEARCH_API_URL}?action=search&query=${encodeURIComponent(query)}&limit=1`;
    const response = await fetch(searchUrl, { signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    
    if (!data.success || !data.data.length) {
        throw new Error("No results found");
    }
    return data.data[0];
}

async function getYouTubeDownloadInfo(url) {
    const downloadUrl = `${YT_API_URL}?url=${encodeURIComponent(url)}`;
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    
    if (!data.success) throw new Error(data.error || "Could not extract video data");
    
    const apiData = data.raw_response?.api || data;
    const mediaItems = apiData.mediaItems || [];
    
    let videoUrl = null;
    let audioUrl = null;
    
    for (const item of mediaItems) {
        if (item.type === 'Video' && !videoUrl) {
            videoUrl = item.mediaPreviewUrl || item.mediaUrl;
        }
        if (item.type === 'Audio' && !audioUrl) {
            audioUrl = item.mediaPreviewUrl || item.mediaUrl;
        }
    }
    
    return {
        title: apiData.title || "YouTube Video",
        channel: apiData.userInfo?.name || "Unknown",
        views: apiData.mediaStats?.viewsCount || "N/A",
        videoUrl: videoUrl,
        audioUrl: audioUrl
    };
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
            finalUrl = `https://www.youtube.com/watch?v=${searchResult.videoId}`;
        }
        
        videoInfo = await getYouTubeDownloadInfo(finalUrl);
        
        if (!videoInfo.videoUrl) {
            throw new Error("No video found");
        }
        
        const caption = `<b>🎥 Title:</b> <code>${escapeHTML(videoInfo.title)}</code>\n━━━━━━━━━━━━━━━━━━━━━\n<b>👁️ Views:</b> ${videoInfo.views}\n<b>🎤 Channel:</b> ${escapeHTML(videoInfo.channel)}\n🔗 <a href="${finalUrl}">Watch on YouTube</a>`;
        
        const result = await sendVideo(token, chatId, videoInfo.videoUrl, caption, PARSE_MODE);
        
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
            finalUrl = `https://www.youtube.com/watch?v=${searchResult.videoId}`;
        }
        
        videoInfo = await getYouTubeDownloadInfo(finalUrl);
        
        if (!videoInfo.audioUrl) {
            throw new Error("No audio found");
        }
        
        const caption = `<b>🎵 Title:</b> <code>${escapeHTML(videoInfo.title)}</code>\n<b>🎤 Artist:</b> ${escapeHTML(videoInfo.channel)}\n🔗 <a href="${finalUrl}">Source</a>`;
        
        const result = await sendAudio(token, chatId, videoInfo.audioUrl, caption, videoInfo.title.substring(0, 64), videoInfo.channel.substring(0, 64), PARSE_MODE);
        
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
