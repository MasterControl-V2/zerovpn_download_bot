// telegramApiHelpers.js
// Minimal Telegram API helpers for Download Bot

import { TELEGRAM_API } from './constants.js';

export async function sendMessage(token, chat_id, text, parse_mode = 'HTML', reply_markup = null) {
    const apiUrl = `${TELEGRAM_API}${token}/sendMessage`;
    const payload = { chat_id, text, parse_mode, disable_web_page_preview: true };
    if (reply_markup) payload.reply_markup = reply_markup;
    
    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error("[sendMessage] Error:", error);
        return { ok: false };
    }
}

export async function sendVideo(token, chat_id, video_url, caption, parse_mode = 'HTML') {
    const apiUrl = `${TELEGRAM_API}${token}/sendVideo`;
    const payload = { chat_id, video: video_url, caption, parse_mode, supports_streaming: true };
    
    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error("[sendVideo] Error:", error);
        return { ok: false };
    }
}

export async function sendAudio(token, chat_id, audio_url, caption, title, performer, parse_mode = 'HTML') {
    const apiUrl = `${TELEGRAM_API}${token}/sendAudio`;
    const payload = { chat_id, audio: audio_url, caption, parse_mode, title, performer };
    
    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error("[sendAudio] Error:", error);
        return { ok: false };
    }
}
