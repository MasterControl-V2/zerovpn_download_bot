// txDownloader.js
// Twitter/X Video Downloader using your own API

import { sendMessage, sendVideo } from './telegramApiHelpers.js';
import { TX_API_BASE, PARSE_MODE } from './constants.js';

function escapeHTML(text = '') {
    if (!text) return '';
    return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function handleTXCommand(message, token, env) {
    const chatId = message.chat.id;
    const text = message.text || '';
    const args = text.split(' ');
    args.shift();
    let url = args.join(' ').trim();
    
    if (!url && message.reply_to_message?.text) {
        const match = message.reply_to_message.text.match(/https?:\/\/(twitter\.com|x\.com)\/\S+/);
        if (match) url = match[0];
    }
    
    if (!url) {
        await sendMessage(token, chatId,
            "<b>❌ Please provide a Twitter/X link</b>\n\nUsage: <code>/tx &lt;twitter_url&gt;</code>",
            PARSE_MODE);
        return;
    }
    
    try {
        const statusMsg = await sendMessage(token, chatId, "<b>🔍 Processing Twitter/X...</b>", PARSE_MODE);
        const statusId = statusMsg.result?.message_id;
        
        const apiUrl = `${TX_API_BASE}${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
        const data = await response.json();
        
        if (!data.download_url) {
            throw new Error("No video found");
        }
        
        const videoUrl = data.download_url;
        const title = escapeHTML(data.title || "Twitter/X Video");
        
        const caption = `<b>🐦 ${title.substring(0, 200)}</b>\n\n🔗 <a href="${url}">Source</a>`;
        
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
        console.error("[TX] Error:", error);
        await sendMessage(token, chatId, `<b>❌ Error: ${escapeHTML(error.message)}</b>`, PARSE_MODE);
    }
}
