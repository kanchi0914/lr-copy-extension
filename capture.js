// ============================================================
// キャプチャ (background 側)
// 📷 / 🎬 ボタンから呼ばれ、スクショ (と録画) と字幕情報 (JSON) を Downloads/eng-captures/ に保存する。
// JSON の形式は英語学習サイトの Inbox が読む「キャプチャ形式 version 1」(録画があれば video を追加)。
// 拡張はファイルを書き出すだけで、サイト側の仕組みには依存しない。
// ============================================================
const CAPTURE_DIR = 'eng-captures';

function captureTimestamp(d) {
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
        `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

/**
 * media.png: 事前に撮ったスクショ (なければ今撮る) / media.webm: 録画 (任意)
 * どちらも data URL
 */
async function saveCapture(tab, info, media = {}) {
    const now = new Date();
    const name = captureTimestamp(now);
    const image = `${name}.png`;
    const video = media.webm ? `${name}.webm` : undefined;

    const png = media.png ?? await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await chrome.downloads.download({ url: png, filename: `${CAPTURE_DIR}/${image}` });
    if (video) {
        await chrome.downloads.download({ url: media.webm, filename: `${CAPTURE_DIR}/${video}` });
    }

    const meta = {
        version: 1,
        capturedAt: now.toISOString(),
        source: {
            app: info.app,
            title: info.title || tab.title || '',
            url: tab.url,
            positionMs: info.positionMs,
        },
        line: info.line,
        context: info.context,
        word: null,
        image,
        ...(video ? { video } : {}),
    };
    await chrome.downloads.download({
        url: 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(meta, null, 2)),
        filename: `${CAPTURE_DIR}/${name}.json`,
    });
    return name;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!sender.tab) return;
    if (msg.type === 'LR_CAPTURE') {
        saveCapture(sender.tab, msg.info, msg.media)
            .then((name) => sendResponse({ ok: true, name }))
            .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true; // async response
    }
    if (msg.type === 'LR_DUMP_HTML') {
        // 調査用: ページの HTML を Downloads/eng-captures-test/ に保存する
        chrome.downloads.download({
            url: 'data:text/html;charset=utf-8,' + encodeURIComponent(msg.html),
            filename: `eng-captures-test/page_${captureTimestamp(new Date())}.html`,
        })
            .then(() => sendResponse({ ok: true }))
            .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true; // async response
    }
    if (msg.type === 'LR_SCREENSHOT') {
        // 録画の前に撮っておくスクショ (保存は録画と一緒に LR_CAPTURE で行う)
        chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
            .then((png) => sendResponse({ ok: true, png }))
            .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true; // async response
    }
});
