// Language Reactor の翻訳テキストセレクター一覧
const TRANSLATION_SELECTORS = [
    '.translationText',
    '.ln-whole-title-translation span',
    '.ln-subtitle-translation',
    '[class*="translationText"]',
    // Amazon Prime Video 字幕
    '.react-draggable .MuiBox-root > span.MuiBox-root',
];

let lastRightClickedEl = null;

// 右クリックされた要素を追跡（background.js がコンテキストメニュー経由でコピーする際に使用）
document.addEventListener('contextmenu', (e) => {
    // 翻訳テキスト要素か、その子要素への右クリックを検出
    const translationEl = e.target.closest(TRANSLATION_SELECTORS.join(','));
    if (translationEl) {
        lastRightClickedEl = translationEl;
        // background.js から参照できるようデータ属性でマーク
        document.querySelectorAll('[data-lr-hovered]').forEach(el => el.removeAttribute('data-lr-hovered'));
        translationEl.setAttribute('data-lr-hovered', 'true');
    }
}, true);

// ============================================================
// 翻訳テキストにコピーボタンを追加 (ホバー時に表示)
// ============================================================
function addCopyButton(el) {
    if (el.dataset.lrCopyAdded) return;
    el.dataset.lrCopyAdded = 'true';

    // 親に relative を設定
    const parent = el.parentElement;
    if (parent) {
        const style = window.getComputedStyle(parent);
        if (style.position === 'static') parent.style.position = 'relative';
    }

    const btnContainer = document.createElement('div');
    btnContainer.className = 'lr-copy-btn-container';

    // 共通のSVGアイコン
    const copySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>`;

    const btnOrigTrans = document.createElement('button');
    btnOrigTrans.className = 'lr-copy-btn';
    btnOrigTrans.title = '原文→翻訳の順でコピー';
    btnOrigTrans.innerHTML = `原→訳 ${copySvg}`;

    const btnTransOrig = document.createElement('button');
    btnTransOrig.className = 'lr-copy-btn';
    btnTransOrig.title = '翻訳→原文の順でコピー';
    btnTransOrig.innerHTML = `訳→原 ${copySvg}`;

    const createClickHandler = (order, btnNode) => (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const cloneForText = el.cloneNode(true);
        cloneForText.querySelectorAll('.lr-copy-btn-container').forEach(btn => btn.remove());
        cloneForText.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        let text = cloneForText.textContent.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
        
        try {
            const container = el.closest('.lln-subs-wrap, .lln-subs-font-adjust, .lln-vertical-view, .lln-subtitle, .ln-bottom-panel, .react-draggable, [data-index]') || el.parentElement?.parentElement;
            if (container && !container.classList.contains('react-draggable')) {
                const origSelectors = ['.lln-subs', '.lln-sentence', '.wrap_text', '[translate="no"]', '.ln-whole-title'];
                let originalText = '';
                for (const sel of origSelectors) {
                    const origEls = container.querySelectorAll(sel);
                    if (origEls.length > 0) {
                        let combinedOrig = '';
                        origEls.forEach(origEl => {
                            const clone = origEl.cloneNode(true);
                            // 翻訳テキスト、コピーボタン、辞書ツールチップ(.tt)、保存ボタンなどを削除して純粋な原文だけにする
                            clone.querySelectorAll('.translationText, [class*="translation"], .ln-subtitle-translation, .ln-whole-title-translation, .lr-copy-btn-container, .tt, .lln-star-and-menu-buttons').forEach(n => n.remove());
                            combinedOrig += clone.textContent + ' ';
                        });
                        originalText = combinedOrig.replace(/\s+/g, ' ').trim();
                        if (originalText && originalText !== text) {
                            break;
                        }
                    }
                }
                if (originalText && originalText !== text) {
                    text = order === 'orig-trans' ? originalText + '\n' + text : text + '\n' + originalText;
                }
            } else if (container && container.classList.contains('react-draggable')) {
                 const spans = container.querySelectorAll('.MuiBox-root > span.MuiBox-root');
                 if (spans.length > 0) {
                     const lines = Array.from(spans).map(s => s.textContent.trim()).filter(l => l && !l.includes('翻訳をコピー') && !l.includes('原→訳') && !l.includes('訳→原'));
                     if (lines.length) text = lines.join('\n');
                 }
            }
        } catch (err) {
            console.error('LR Copy Error:', err);
        }

        navigator.clipboard.writeText(text).then(() => {
            showToast('✓ コピー: ' + text.substring(0, 50) + (text.length > 50 ? '…' : ''));
            btnNode.classList.add('lr-copy-btn--copied');
            setTimeout(() => btnNode.classList.remove('lr-copy-btn--copied'), 1500);
        }).catch(() => {
            // clipboard API が使えない場合のフォールバック
            if (document.body) {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            showToast('✓ コピー: ' + text.substring(0, 50) + (text.length > 50 ? '…' : ''));
        });
    };

    btnOrigTrans.addEventListener('click', createClickHandler('orig-trans', btnOrigTrans));
    btnTransOrig.addEventListener('click', createClickHandler('trans-orig', btnTransOrig));

    btnContainer.appendChild(btnOrigTrans);
    btnContainer.appendChild(btnTransOrig);
    el.appendChild(btnContainer);
}

function showToast(msg) {
    if (!document.body) return;
    const existing = document.getElementById('lr-copy-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'lr-copy-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// ============================================================
// MutationObserver で動的に追加される翻訳要素を監視
// ============================================================
function scanAndAttach() {
    TRANSLATION_SELECTORS.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            if (el.textContent.trim()) addCopyButton(el);
        });
    });
}

function initObserver() {
    const target = document.body || document.documentElement;
    if (!target) return;
    
    scanAndAttach();
    
    const observer = new MutationObserver(() => {
        scanAndAttach();
    });
    
    observer.observe(target, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
} else {
    initObserver();
}
