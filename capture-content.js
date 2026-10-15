// ============================================================
// キャプチャ (content 側)
// Netflix の再生画面に 📷 ボタンを出し、押したら Language Reactor の字幕
// (原文・翻訳・前後の行) を集めて background にスクショと保存を依頼する。
// 保存形式は英語学習サイトの Inbox が読む「キャプチャ形式 version 1」(background 側で組み立てる)
// ============================================================
(function () {
    if (window !== window.top) return;
    if (location.hostname !== 'www.netflix.com') return;

    const CONTEXT_LINES = 2;
    let lastTitle = '';

    const btn = document.createElement('button');
    btn.id = 'lr-capture-btn';
    btn.textContent = '📷';
    btn.title = 'スクショと字幕を保存';

    function showCaptureToast(msg) {
        const toast = document.createElement('div');
        toast.id = 'lr-capture-toast';
        toast.textContent = msg;
        (document.fullscreenElement || document.body).appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }

    // ---------- 字幕の取り出し ----------

    // 単語と区切りだけを繋げる (辞書ツールチップやメニューの文字を混ぜない)
    function sentenceText(el) {
        if (!el) return '';
        const parts = el.querySelectorAll(':scope .lln-word, :scope .lln-not-word');
        const text = parts.length
            ? Array.from(parts)
                .filter((p) => !p.closest('.tt'))
                .map((p) => Array.from(p.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(''))
                .join('')
            : el.textContent;
        return text.replace(/\s+/g, ' ').trim();
    }

    function translationText() {
        const el = document.querySelector('.lln-whole-title-translation .translationText');
        if (!el) return '';
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.lr-copy-btn-container').forEach((n) => n.remove());
        const lines = clone.textContent.split('\n').map((l) => l.trim()).filter(Boolean);
        // 日本語は改行をそのまま詰め、それ以外は空白で繋ぐ
        return lines.reduce((acc, l) => {
            if (!acc) return l;
            const cjk = /[\u3000-\u9fff\uff00-\uffef]$/.test(acc) && /^[\u3000-\u9fff\uff00-\uffef]/.test(l);
            return acc + (cjk ? '' : ' ') + l;
        }, '');
    }

    // 右パネルの行 (画面に見えている範囲しか中身がないので、空の行は飛ばす)
    function panelLines(index, from, to) {
        const lines = [];
        for (let i = from; i <= to; i++) {
            if (i === index) continue;
            const text = sentenceText(document.querySelector(`.lln-vertical-view-sub[data-index="${i}"] .lln-sub-text`));
            if (text) lines.push({ i, text });
        }
        return lines;
    }

    function readTitle() {
        const el = document.querySelector('[data-uia="video-title"]');
        if (!el) return;
        const show = el.querySelector('h4')?.textContent.trim();
        const rest = Array.from(el.querySelectorAll('span')).map((s) => s.textContent.trim()).filter(Boolean).join(' ');
        const title = [show, rest].filter(Boolean).join(' ');
        if (title) lastTitle = title;
    }

    function captureInfo() {
        const subs = document.getElementById('lln-subs');
        const text = sentenceText(subs);
        if (!text) return null;
        const index = Number(subs.dataset.index);
        const translation = translationText();
        const video = document.querySelector('video');
        readTitle();

        const line = { text };
        if (translation) line.translation = translation;
        const context = Number.isNaN(index)
            ? { before: [], after: [] }
            : {
                before: panelLines(index, index - CONTEXT_LINES - 2, index - 1).slice(-CONTEXT_LINES).map(({ text }) => ({ text })),
                after: panelLines(index, index + 1, index + CONTEXT_LINES + 2).slice(0, CONTEXT_LINES).map(({ text }) => ({ text })),
            };
        return {
            app: 'netflix',
            title: lastTitle,
            positionMs: video ? Math.round(video.currentTime * 1000) : undefined,
            line,
            context,
        };
    }

    // ---------- ボタン ----------

    // ボタン自体が写り込まないよう隠して再描画を待ってから撮影を依頼する
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const info = captureInfo();
        if (!info) {
            showCaptureToast('字幕が表示されていません (Language Reactor の字幕が出ている場面で押してください)');
            return;
        }
        btn.style.visibility = 'hidden';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            chrome.runtime.sendMessage({ type: 'LR_CAPTURE', info }, (res) => {
                btn.style.visibility = '';
                if (chrome.runtime.lastError || !res?.ok) {
                    showCaptureToast(`保存失敗: ${chrome.runtime.lastError?.message ?? res?.error ?? 'no response'}`);
                    return;
                }
                showCaptureToast(`保存しました: ${info.line.text.slice(0, 40)}`);
            });
        }));
    });

    // 再生画面 (/watch/) のときだけ表示。全画面中は全画面の要素の中に置かないと見えない
    function place() {
        const onWatch = location.pathname.startsWith('/watch');
        const parent = document.fullscreenElement || document.body;
        if (!onWatch) {
            btn.remove();
            lastTitle = '';
            return;
        }
        if (parent && btn.parentElement !== parent) parent.appendChild(btn);
        readTitle(); // タイトルは操作 UI が出ている間しか DOM にないので、見えたときに覚えておく
    }

    document.addEventListener('fullscreenchange', place);
    setInterval(place, 1000); // Netflix は SPA なので URL の変化を定期的に確認する
    place();
})();
