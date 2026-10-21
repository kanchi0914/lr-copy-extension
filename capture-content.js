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

    const clipBtn = document.createElement('button');
    clipBtn.id = 'lr-clip-btn';
    clipBtn.textContent = '🎬';
    clipBtn.title = '今の字幕を録画 (スクショ・字幕と一緒に保存)';

    const starBtn = document.createElement('button');
    starBtn.id = 'lr-star-btn';
    starBtn.textContent = '⭐';
    starBtn.title = 'Language Reactor で★を付けた字幕をまとめて保存 (Shift+クリックで録画も)。実行中に押すと中止';

    const buttons = [btn, clipBtn, starBtn];

    function showCaptureToast(msg, duration = 2500) {
        const toast = document.createElement('div');
        toast.className = 'lr-capture-toast';
        toast.textContent = msg;
        (document.fullscreenElement || document.body).appendChild(toast);
        setTimeout(() => toast.remove(), duration);
    }

    // 撮影の前に自分の UI (ボタン・トースト) を隠し、再描画されるのを待つ
    async function hideUi() {
        buttons.forEach((b) => (b.style.visibility = 'hidden'));
        document.querySelectorAll('.lr-capture-toast').forEach((t) => t.remove());
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    function showUi() {
        buttons.forEach((b) => (b.style.visibility = ''));
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

    // ---------- 録画 ----------
    // Netflix は video.currentTime を直接変えるとエラーになるので、Language Reactor の
    // 「字幕をもう一度再生」ボタンで字幕の頭に戻し、字幕が次に変わるまでタブを録画する。
    // タブの映像は画面共有 (getDisplayMedia) で取る。確認ダイアログはページを開いて最初の 1 回だけ
    const CLIP_TAIL_MS = 300;
    const CLIP_MAX_MS = 15000;
    const CLIP_MAX_WIDTH = 1280;
    const CLIP_BITRATE = 2500000;
    const CLIP_AUDIO_BITRATE = 160000; // ステレオの Opus
    let clipStream = null;
    let clipping = false;
    let lastError = ''; // 直近の失敗理由 (まとめて保存の結果表示用)

    async function getClipStream() {
        if (clipStream && clipStream.getVideoTracks().some((t) => t.readyState === 'live')) return clipStream;
        clipStream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: { max: CLIP_MAX_WIDTH }, frameRate: { max: 30 } },
            audio: {
                suppressLocalAudioPlayback: false, // 録画中もタブの音を聞こえるままにする
                // 通話向けの処理 (エコー除去・ノイズ抑制・自動音量) を切る。有効だと効果音や BGM がこもり、モノラルになる
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 2,
            },
            preferCurrentTab: true,
            selfBrowserSurface: 'include',
            surfaceSwitching: 'exclude',
            systemAudio: 'exclude',
        });
        return clipStream;
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function waitFor(cond, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        return new Promise((resolve) => {
            const tick = () => {
                if (cond()) resolve(true);
                else if (Date.now() > deadline) resolve(false);
                else requestAnimationFrame(tick);
            };
            tick();
        });
    }

    // 実際に使われた音声の設定 (通話向けの処理が切れているかの確認用)
    function audioInfo(stream) {
        const a = stream.getAudioTracks()[0]?.getSettings();
        if (!a) return '音声なし';
        const fx = [a.echoCancellation && 'EC', a.noiseSuppression && 'NS', a.autoGainControl && 'AGC'].filter(Boolean);
        return `音声 ${a.channelCount ?? '?'}ch${fx.length ? ' 処理あり:' + fx.join('/') : ' 処理なし'}`;
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /** 今の字幕を録画して保存する。成功したら true (quiet: 結果のトーストを出さない) */
    async function recordClip({ quiet = false } = {}) {
        if (clipping) return false;
        const subs = document.getElementById('lln-subs');
        const replay = subs?.querySelector('.lln-subs-replay-btn');
        const video = document.querySelector('video');
        if (!subs || !replay || !video || !sentenceText(subs)) {
            lastError = `録画できる字幕がありません (${!subs ? '字幕なし' : !replay ? 'リプレイボタンなし' : !video ? '動画なし' : '字幕が空'})`;
            showCaptureToast('字幕が表示されていません (Language Reactor の字幕が出ている場面で押してください)', 4000);
            return false;
        }
        clipping = true;
        const index = subs.dataset.index;
        const info = captureInfo(); // 録画が終わる頃には次の字幕に変わっているので先に取る
        try {
            const stream = await getClipStream();

            // スクショも録画の前に撮る
            await hideUi();
            const shot = await chrome.runtime.sendMessage({ type: 'LR_SCREENSHOT' });
            if (!shot?.ok) throw new Error(`スクショ失敗: ${shot?.error}`);

            const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
                .find((t) => MediaRecorder.isTypeSupported(t));
            const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: CLIP_BITRATE, audioBitsPerSecond: CLIP_AUDIO_BITRATE });
            const chunks = [];
            recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
            const stopped = new Promise((resolve) => (recorder.onstop = resolve));
            recorder.start();
            recorder.pause(); // 字幕の頭に戻るまでは録らない

            const seeked = new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
            replay.click();
            const ok = await Promise.race([seeked.then(() => true), sleep(3000).then(() => false)]);
            if (!ok) throw new Error('リプレイボタンで巻き戻せませんでした');
            await waitFor(() => !video.paused, 3000);
            recorder.resume();
            const t0 = performance.now();

            // 字幕が次に変わる (番号が変わる / 消える / 一時停止される) まで録る
            await waitFor(() => {
                const cur = document.getElementById('lln-subs');
                return video.paused || !cur || cur.dataset.index !== index || !sentenceText(cur);
            }, CLIP_MAX_MS);
            await sleep(CLIP_TAIL_MS);
            recorder.stop();
            video.pause();
            await stopped;

            const seconds = ((performance.now() - t0) / 1000).toFixed(1);
            const blob = new Blob(chunks, { type: 'video/webm' }); // codecs=vp9,opus のカンマが data URL を壊すので付けない
            const settings = stream.getVideoTracks()[0].getSettings();
            const webm = await blobToDataUrl(blob);
            const res = await chrome.runtime.sendMessage({ type: 'LR_CAPTURE', info, media: { png: shot.png, webm } });
            if (!res?.ok) throw new Error(`保存失敗: ${res?.error}`);
            if (!quiet) {
                showCaptureToast(`録画を保存: ${info.line.text.slice(0, 30)} / ${seconds}秒 / ${Math.round(blob.size / 1024)}KB / ${settings.width}x${settings.height} / ${audioInfo(stream)}`, 6000);
            }
            return true;
        } catch (e) {
            lastError = `録画失敗: ${e.message}`;
            showCaptureToast(`録画失敗: ${e.name}: ${e.message}`, 6000);
            return false;
        } finally {
            showUi();
            clipping = false;
        }
    }

    clipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        recordClip();
    });

    // ---------- スクショ ----------

    /** 今の字幕のスクショを保存する。成功したら true (quiet: 結果のトーストを出さない) */
    async function captureScreenshot({ quiet = false } = {}) {
        const info = captureInfo();
        if (!info) {
            showCaptureToast('字幕が表示されていません (Language Reactor の字幕が出ている場面で押してください)');
            return false;
        }
        await hideUi();
        try {
            const res = await chrome.runtime.sendMessage({ type: 'LR_CAPTURE', info });
            if (!res?.ok) throw new Error(res?.error ?? 'no response');
            if (!quiet) showCaptureToast(`保存しました: ${info.line.text.slice(0, 40)}`);
            return true;
        } catch (e) {
            lastError = `保存失敗: ${e.message}`;
            showCaptureToast(`保存失敗: ${e.message}`);
            return false;
        } finally {
            showUi();
        }
    }

    // ---------- ★をまとめて保存 ----------
    // 右パネルは見えている行しか中身がないので、スクロールしながら★の付いた行の番号を集め、
    // 1 件ずつパネルの再生ボタンでその字幕に移動して保存する (Netflix は再生位置を直接変えられない)
    let batchRunning = false;
    let batchCancel = false;

    function panel() {
        return document.getElementById('lln-vertical-view-subs');
    }

    async function collectStarred() {
        const box = panel();
        const found = new Set();
        const saved = box.scrollTop;
        box.style.scrollBehavior = 'auto'; // smooth のままだとスクロールが追いつかない
        const step = Math.max(100, box.clientHeight * 0.8);
        for (let top = 0; ; top += step) {
            box.scrollTop = top;
            await sleep(150);
            box.querySelectorAll('.lln-vertical-view-sub .lln-star-sub-btn.active').forEach((star) => {
                const i = star.closest('.lln-vertical-view-sub')?.dataset.index;
                if (i !== undefined) found.add(Number(i));
            });
            if (top + box.clientHeight >= box.scrollHeight) break;
        }
        box.scrollTop = saved;
        box.style.scrollBehavior = '';
        return [...found].sort((a, b) => a - b);
    }

    async function goToSub(index) {
        const box = panel();
        const item = box.querySelector(`.lln-vertical-view-sub[data-index="${index}"]`);
        if (!item) return false;
        box.style.scrollBehavior = 'auto';
        box.scrollTop = parseFloat(item.style.top || '0') - box.clientHeight / 3;
        box.style.scrollBehavior = '';
        await sleep(200); // スクロールした先の行に中身が入るのを待つ
        const play = item.querySelector('.lln-sub-play-btn');
        if (!play) return false;
        play.click();
        return waitFor(() => {
            const subs = document.getElementById('lln-subs');
            return subs?.dataset.index === String(index) && !!sentenceText(subs);
        }, 6000);
    }

    async function captureStarred(withClip) {
        if (batchRunning) {
            batchCancel = true;
            showCaptureToast('中止します (今の 1 件が終わったら止まります)');
            return;
        }
        if (!panel()) {
            showCaptureToast('Language Reactor の右側の字幕パネルを開いてください', 4000);
            return;
        }
        batchRunning = true;
        batchCancel = false;
        const failed = [];
        let saved = 0;
        let total = 0;
        try {
            if (withClip) await getClipStream(); // 画面共有の確認はクリック直後でないと出せないので最初に
            document.querySelector('video')?.pause(); // パネルが再生位置に合わせて勝手にスクロールしないように
            starBtn.textContent = '⏳';
            const list = await collectStarred();
            total = list.length;
            if (!total) {
                showCaptureToast('このエピソードに★の付いた字幕がありません', 4000);
                return;
            }
            for (const [n, index] of list.entries()) {
                if (batchCancel) break;
                starBtn.textContent = `⏹${n + 1}/${total}`;
                lastError = '';
                if (!(await goToSub(index))) {
                    failed.push({ index, reason: 'その字幕に移動できませんでした' });
                    continue;
                }
                let ok;
                if (withClip) {
                    // 移動の直後にリプレイで巻き戻すと無視されることがあるので、移動が終わって再生が始まるまで待つ
                    const video = document.querySelector('video');
                    await waitFor(() => video && !video.seeking && !video.paused && video.readyState >= 3, 5000);
                    await sleep(500);
                    ok = await recordClip({ quiet: true });
                } else {
                    await sleep(500); // 移動直後は映像が乱れることがあるので少し再生してから止める
                    document.querySelector('video')?.pause();
                    await sleep(300);
                    ok = await captureScreenshot({ quiet: true });
                }
                if (ok) saved++;
                else failed.push({ index, reason: lastError || '不明' });
            }
        } catch (e) {
            showCaptureToast(`まとめて保存に失敗: ${e.name}: ${e.message}`, 6000);
        } finally {
            starBtn.textContent = '⭐';
            batchRunning = false;
        }
        if (failed.length) console.warn('[LR capture] ★まとめて保存の失敗', failed);
        if (total) {
            showCaptureToast(
                `★ ${saved}/${total} 件を保存しました${batchCancel ? ' (中止)' : ''}` +
                (failed.length ? ` / 失敗: ${failed.length} 件 (例: ${failed[0].reason})` : ''),
                8000,
            );
        }
    }

    starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        captureStarred(e.shiftKey);
    });

    // ---------- ボタン ----------

    // 調査用: Alt+クリックで、script / style / svg などを除いたページの HTML を保存する
    function dumpHtml() {
        const clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll('script, style, svg, link, noscript, video').forEach((n) => n.remove());
        const html = `<!-- ${location.href} -->\n` + clone.outerHTML;
        chrome.runtime.sendMessage({ type: 'LR_DUMP_HTML', html }, (res) => {
            showCaptureToast(res?.ok ? 'HTML を保存しました (eng-captures-test)' : `保存失敗: ${chrome.runtime.lastError?.message ?? res?.error}`);
        });
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.altKey) {
            dumpHtml();
            return;
        }
        captureScreenshot();
    });

    // 再生画面 (/watch/) のときだけ表示。全画面中は全画面の要素の中に置かないと見えない
    function place() {
        const onWatch = location.pathname.startsWith('/watch');
        const parent = document.fullscreenElement || document.body;
        if (!onWatch) {
            buttons.forEach((b) => b.remove());
            lastTitle = '';
            return;
        }
        buttons.forEach((b) => {
            if (parent && b.parentElement !== parent) parent.appendChild(b);
        });
        readTitle(); // タイトルは操作 UI が出ている間しか DOM にないので、見えたときに覚えておく
    }

    document.addEventListener('fullscreenchange', place);
    setInterval(place, 1000); // Netflix は SPA なので URL の変化を定期的に確認する
    place();
})();
