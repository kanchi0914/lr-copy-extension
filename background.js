importScripts('capture.js');

// 右クリックコンテキストメニューの作成
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "copy-lr-orig-trans",
        title: "原文→翻訳の順でコピー",
        contexts: ["all"]
    });
    chrome.contextMenus.create({
        id: "copy-lr-trans-orig",
        title: "翻訳→原文の順でコピー",
        contexts: ["all"]
    });
});

// コンテキストメニューがクリックされたとき
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "copy-lr-orig-trans" || info.menuItemId === "copy-lr-trans-orig") {
        const order = info.menuItemId === "copy-lr-orig-trans" ? 'orig-trans' : 'trans-orig';
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: copyNearestTranslation,
            args: [order]
        });
    }
});

// ページ上で最も近い翻訳テキストを探してコピーする関数
function copyNearestTranslation(orderArg) {
    let text = null;

    // Amazon Prime Video: react-draggable 内の全字幕行をまとめてコピー
    const draggable = document.querySelector('.react-draggable');
    if (draggable) {
        const spans = draggable.querySelectorAll('.MuiBox-root > span.MuiBox-root');
        if (spans.length > 0) {
            const lines = Array.from(spans)
                .map(s => s.textContent.trim())
                .filter(Boolean);
            if (lines.length) text = lines.join('\n');
        }
    }

    let translationEl = null;

    if (!text) {
        // まず最後にホバーされた要素から探す
        const hovered = document.querySelector('[data-lr-hovered="true"]');
        if (hovered) {
            translationEl = hovered;
        }
    }

    if (!text && !translationEl) {
        const selectors = [
            '.translationText',
            '.ln-bottom-panel .ln-whole-title-translation span',
            '[class*="translation"]',
            '.ln-subtitle-translation',
            '.balance-text',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim()) {
                translationEl = el;
                break;
            }
        }
    }

    if (translationEl && !text) {
        const cloneForText = translationEl.cloneNode(true);
        cloneForText.querySelectorAll('.lr-copy-btn').forEach(btn => btn.remove());
        cloneForText.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        let translationText = cloneForText.textContent.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
        let originalText = '';
        
        try {
            const container = translationEl.closest('.lln-subs-wrap, .lln-subs-font-adjust, .lln-vertical-view, .lln-subtitle, .ln-bottom-panel, [data-index]') || translationEl.parentElement?.parentElement;
            if (container) {
                const origSelectors = ['.lln-subs', '.lln-sentence', '.wrap_text', '[translate="no"]', '.ln-whole-title'];
                for (const sel of origSelectors) {
                    const origEls = container.querySelectorAll(sel);
                    if (origEls.length > 0) {
                        let combinedOrig = '';
                        origEls.forEach(el => {
                            const clone = el.cloneNode(true);
                            clone.querySelectorAll('.translationText, [class*="translation"], .ln-subtitle-translation, .ln-whole-title-translation, .lr-copy-btn-container, .lr-copy-btn, .tt, .lln-star-and-menu-buttons').forEach(n => n.remove());
                            combinedOrig += clone.textContent + ' ';
                        });
                        originalText = combinedOrig.replace(/\s+/g, ' ').trim();
                        if (originalText && originalText !== translationText) {
                            break;
                        }
                    }
                }
            }
        } catch (err) {
            console.error('LR Copy Error:', err);
        }
        
        if (originalText && originalText !== translationText) {
            text = orderArg === 'orig-trans' ? originalText + '\n' + translationText : translationText + '\n' + originalText;
        } else {
            text = translationText;
        }
    }

    if (text) {
        navigator.clipboard.writeText(text).then(() => {
            // コピー成功の通知
            const preview = text.replace(/\n/g, ' / ');
            const toast = document.createElement('div');
            toast.textContent = '✓ コピーしました: ' + preview.substring(0, 60) + (preview.length > 60 ? '...' : '');
            toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.85);
        color: #fff;
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 99999;
        pointer-events: none;
        max-width: 500px;
        text-align: center;
      `;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
        });
    } else {
        alert('翻訳テキストが見つかりませんでした。');
    }
}
