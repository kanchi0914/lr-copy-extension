async function handleCopy(order) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (orderArg) => {
            // Amazon Prime Video: react-draggable 内の全字幕行をまとめて返す
            const draggable = document.querySelector('.react-draggable');
            if (draggable) {
                const spans = draggable.querySelectorAll('.MuiBox-root > span.MuiBox-root');
                if (spans.length > 0) {
                    const lines = Array.from(spans)
                        .map(s => s.textContent.trim())
                        .filter(Boolean);
                    if (lines.length) return lines.join('\n');
                }
            }

            // Language Reactor (Netflix / YouTube)
            let translationEl = null;
            const selectors = [
                '.translationText',
                '.ln-whole-title-translation span',
                '.ln-subtitle-translation',
                '[class*="translationText"]',
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim()) {
                    translationEl = el;
                    break;
                }
            }
            
            if (translationEl) {
                const cloneForText = translationEl.cloneNode(true);
                cloneForText.querySelectorAll('.lr-copy-btn-container, .lr-copy-btn').forEach(btn => btn.remove());
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
                    return orderArg === 'orig-trans' ? originalText + '\n' + translationText : translationText + '\n' + originalText;
                }
                return translationText;
            }
            return null;
        },
        args: [order]
    });

    const text = results?.[0]?.result;
    const resultEl = document.getElementById('result');

    if (text) {
        await navigator.clipboard.writeText(text);
        resultEl.textContent = '✓ コピーしました！';
        setTimeout(() => { resultEl.textContent = ''; }, 2000);
    } else {
        resultEl.style.color = '#f87171';
        resultEl.textContent = '翻訳テキストが見つかりませんでした';
        setTimeout(() => { resultEl.textContent = ''; resultEl.style.color = '#6ee7b7'; }, 2500);
    }
}

document.getElementById('copyBtnOrigTrans').addEventListener('click', () => handleCopy('orig-trans'));
document.getElementById('copyBtnTransOrig').addEventListener('click', () => handleCopy('trans-orig'));
