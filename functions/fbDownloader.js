// fbDownloader.js
// Facebook Video Downloader using your own API

import { sendMessage, sendVideo } from './telegramApiHelpers.js';
import { FB_API_BASE, PARSE_MODE } from './constants.js';

function escapeHTML(text = '') {
    if (!text) return '';
    return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function handleFBCommand(message, token, env) {
    const chatId = message.chat.id;
    const text = message.text || '';
    const args = text.split(' ');
    args.shift();
    let url = args.join(' ').trim();
    
    if (!url && message.reply_to_message?.text) {
        const fbMatch = message.reply_to_message.text.match(/https?:\/\/(www\.|m\.)?facebook\.com\/\S+|https?:\/\/fb\.watch\/\S+/);
        if (fbMatch) url = fbMatch[0];
    }
    
    if (!url) {
        await sendMessage(token, chatId, 
            "<b>❌ Please provide a Facebook Video Link</b>\n\nUsage: <code>/fb &lt;facebook_video_url&gt;</code>",
            PARSE_MODE);
        return;
    }
    
    try {
        const statusMsg = await sendMessage(token, chatId, "<b>🔍 Processing Facebook video...</b>", PARSE_MODE);
        const statusId = statusMsg.result?.message_id;
        
        const apiUrl = `${FB_API_BASE}${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
        const data = await response.json();
        
        if (!data.links || data.links.length === 0) {
            throw new Error("No video links found");
        }
        
        const videoObj = data.links.find(l => l.quality === "HD") || data.links[0];
        const videoUrl = videoObj.url;
        const title = escapeHTML(data.title || "Facebook Video");
        
        const caption = `<b>📹 ${title.substring(0, 200)}</b>\n\n🔗 <a href="${url}">Source</a>`;
        
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
        console.error("[FB] Error:", error);
        await sendMessage(token, chatId, `<b>❌ Error: ${escapeHTML(error.message)}</b>`, PARSE_MODE);
    }
}
