// ============================================================
// キャプチャ (background 側)
// 📷 ボタンから呼ばれ、表示中のタブのスクショと字幕情報 (JSON) を Downloads/eng-captures/ に保存する。
// JSON の形式は英語学習サイトの Inbox が読む「キャプチャ形式 version 1」。
// 拡張はファイルを書き出すだけで、サイト側の仕組みには依存しない。
// ============================================================
const CAPTURE_DIR = 'eng-captures';

function captureTimestamp(d) {
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
        `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

async function saveCapture(tab, info) {
    const now = new Date();
    const name = captureTimestamp(now);
    const image = `${name}.png`;

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await chrome.downloads.download({ url: dataUrl, filename: `${CAPTURE_DIR}/${image}` });

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
    };
    await chrome.downloads.download({
        url: 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(meta, null, 2)),
        filename: `${CAPTURE_DIR}/${name}.json`,
    });
    return name;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'LR_CAPTURE' || !sender.tab) return;
    saveCapture(sender.tab, msg.info)
        .then((name) => sendResponse({ ok: true, name }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async response
});
