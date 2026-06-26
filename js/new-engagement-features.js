// =========================================================
// dr0p_station — MÓDULO: new-engagement-features.js
// NOVAS MECÂNICAS DE ENGAJAMENTO (PATCH 5)
//
// Injeta via DOM manipulation (sem tocar no index.html):
//   • Botão "EXPLORAR" no header nav (navMenuWrapper)
//   • Nova SPA screen: #screen-explorar com:
//       1. Timeline realtime de eventos_globais
//       2. Seção de Lore dinâmica (drop_station_lore)
//       3. Mini-game Breach Protocol
//
// Compatível com o padrão SPA: navigateTo() / .spa-screen / .active
// Carregado por último na lista de <script> do index.html.
// =========================================================

(function () {
    'use strict';

    // ─── GUARD: espera sb e currentUser estarem disponíveis ───────────
    function _waitReady(fn) {
        if (typeof sb !== 'undefined' && typeof currentUser !== 'undefined') {
            fn();
        } else {
            setTimeout(() => _waitReady(fn), 150);
        }
    }

    // =========================================================
    // ESTILOS CSS
    // =========================================================
    function _injectStyles() {
        if (document.getElementById('nef-styles')) return;
        const s = document.createElement('style');
        s.id = 'nef-styles';
        s.textContent = `
            /* ── SCREEN EXPLORAR ── */
            #screen-explorar .vault-layout { max-width: 900px; }
            .nef-section-label {
                font-family: 'Space Mono', monospace;
                font-size: 0.45rem;
                color: #333355;
                letter-spacing: 3px;
                margin-bottom: 10px;
                text-transform: uppercase;
            }

            /* ── TABS INTERNAS ── */
            .nef-inner-tabs {
                display: flex;
                gap: 0;
                border-bottom: 1px solid #1a1a2e;
                margin-bottom: 20px;
            }
            .nef-itab-btn {
                background: none;
                border: none;
                border-bottom: 2px solid transparent;
                color: #444466;
                font-family: 'Space Mono', monospace;
                font-size: 0.5rem;
                letter-spacing: 2px;
                padding: 9px 16px;
                cursor: pointer;
                text-transform: uppercase;
                margin-bottom: -1px;
                transition: color 0.2s, border-color 0.2s;
            }
            .nef-itab-btn:hover { color: #00ffcc; }
            .nef-itab-btn.active { color: #00ffcc; border-bottom-color: #00ffcc; }
            .nef-itab-panel { display: none; }
            .nef-itab-panel.active { display: block; animation: nef-fin 0.22s ease; }
            @keyframes nef-fin { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:none; } }

            /* ── TIMELINE ── */
            #nef-feed {
                max-height: 380px;
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: #00ffcc22 transparent;
                padding-right: 4px;
            }
            .nef-line {
                font-family: 'Space Mono', monospace;
                font-size: 0.5rem;
                line-height: 1.85;
                border-left: 2px solid #00ff6622;
                padding: 2px 0 2px 8px;
                margin-bottom: 2px;
                color: #00ff6699;
                word-break: break-all;
                transition: border-color 0.4s, color 0.4s;
            }
            .nef-line.ledger { border-left-color:#00ffcc44; color:#00ffccaa; }
            .nef-line.feed   { border-left-color:#ffaa0044; color:#ffaa00aa; }
            .nef-line.sys    { border-left-color:#9933ff44; color:#9933ffaa; }
            .nef-line.fresh  { border-left-color:#00ff66;   color:#00ff66; }
            .nef-ts { color:#2a2a44; margin-right:6px; font-size:0.44rem; }
            .nef-empty-feed {
                font-family: 'Space Mono', monospace;
                font-size: 0.5rem;
                color: #222244;
                padding: 20px 0;
            }

            /* ── LORE ── */
            .nef-lore-card {
                border-left: 2px solid #00ffcc22;
                padding: 10px 0 10px 12px;
                margin-bottom: 14px;
            }
            .nef-lore-style {
                font-family: 'Archivo Black', sans-serif;
                font-size: 0.75rem;
                color: #00ffcc;
                margin-bottom: 5px;
            }
            .nef-lore-body {
                font-family: 'Space Mono', monospace;
                font-size: 0.51rem;
                color: #777799;
                line-height: 1.9;
            }
            .nef-lore-lvl {
                font-size: 0.42rem;
                color: #333355;
                letter-spacing: 1px;
                margin-bottom: 3px;
            }

            /* ── BREACH PROTOCOL ── */
            .nef-breach-seq {
                font-family: 'Space Mono', monospace;
                font-size: 0.75rem;
                color: #00ffcc;
                letter-spacing: 8px;
                margin-bottom: 14px;
                min-height: 24px;
            }
            .nef-seq-ch { display:inline-block; transition:color 0.15s; }
            .nef-seq-ch.hit  { color:#00ff66; }
            .nef-seq-ch.miss { color:#ff3333; }

            .nef-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 5px;
                margin-bottom: 14px;
                max-width: 340px;
            }
            .nef-node {
                background: #07070f;
                border: 1px solid #1a1a2e;
                color: #00ffcc;
                font-family: 'Space Mono', monospace;
                font-size: 0.58rem;
                padding: 10px 4px;
                text-align: center;
                cursor: pointer;
                letter-spacing: 1px;
                user-select: none;
                transition: background 0.1s, border-color 0.1s;
            }
            .nef-node:hover:not(.nef-used) { background:#0d0d1e; border-color:#00ffcc44; }
            .nef-node.nef-target {
                border-color: #ffaa00;
                color: #ffaa00;
                background: #100a00;
                animation: nef-pulse 0.6s ease infinite alternate;
            }
            .nef-node.nef-used.nef-ok  { border-color:#00ff6633; color:#00ff6633; cursor:default; background:#001a08; }
            .nef-node.nef-used.nef-err { border-color:#ff333333; color:#ff333333; cursor:default; background:#1a0000; }
            @keyframes nef-pulse {
                from { box-shadow:0 0 4px rgba(255,170,0,0.2); }
                to   { box-shadow:0 0 14px rgba(255,170,0,0.55); }
            }
            .nef-breach-status {
                font-family: 'Space Mono', monospace;
                font-size: 0.51rem;
                color: #444466;
                min-height: 18px;
                margin-bottom: 12px;
            }
            .nef-breach-timer {
                font-family: 'Space Mono', monospace;
                font-size: 0.65rem;
                color: #ffaa00;
                margin-bottom: 10px;
                letter-spacing: 2px;
            }
            .nef-btn {
                background: none;
                border: 1px solid #222233;
                color: #444466;
                font-family: 'Space Mono', monospace;
                font-size: 0.5rem;
                padding: 8px 16px;
                cursor: pointer;
                letter-spacing: 2px;
                text-transform: uppercase;
                transition: border-color 0.2s, color 0.2s;
                margin-right: 8px;
            }
            .nef-btn:hover { border-color:#ffaa00; color:#ffaa00; }
            .nef-btn.primary { border-color:#00ffcc; color:#00ffcc; }
            .nef-btn.primary:hover { border-color:#00ff66; color:#00ff66; }

            .nef-result-box {
                border: 1px solid #1a1a2e;
                padding: 18px;
                margin-top: 14px;
                font-family: 'Space Mono', monospace;
                font-size: 0.52rem;
            }
            .nef-result-box.success { border-color:#00ff6644; background:#001a0a; color:#00ff66; }
            .nef-result-box.fail    { border-color:#ff333344; background:#1a0000; color:#ff3333; }
        `;
        document.head.appendChild(s);
    }

    // =========================================================
    // INJEÇÃO DO BOTÃO NO HEADER
    // =========================================================
    function _injectNavButton() {
        const navWrapper = document.getElementById('navMenuWrapper');
        if (!navWrapper || document.getElementById('navExplorBtn')) return;

        const btn = document.createElement('button');
        btn.className = 'btn-navigation';
        btn.id = 'navExplorBtn';
        btn.onclick = () => { if (typeof navigateTo === 'function') navigateTo('explorar'); };
        btn.innerHTML = `
            <span>EXPLORAR</span>
            <span class="btn-sub-nav">LORE · EVENTS · HACK</span>
        `;

        // Insere antes do botão de AUTH (último antes do logout)
        const authBtn = document.getElementById('navAuthBtn');
        if (authBtn) navWrapper.insertBefore(btn, authBtn);
        else navWrapper.appendChild(btn);
    }

    // =========================================================
    // INJEÇÃO DA SPA SCREEN #screen-explorar
    // =========================================================
    function _injectScreen() {
        if (document.getElementById('screen-explorar')) return;

        const screen = document.createElement('div');
        screen.id = 'screen-explorar';
        screen.className = 'spa-screen';
        screen.innerHTML = `
            <div class="vault-layout">
                <div class="vault-header">
                    <h2 style="color:#00ffcc;">EXPLORAR // REDE_GLOBAL</h2>
                    <p style="font-size:0.6rem; color:#888899;">Timeline ao vivo, fragmentos de lore desbloqueados e terminal de intrusão.</p>
                </div>

                <!-- Tabs internas -->
                <div class="nef-inner-tabs">
                    <button class="nef-itab-btn active" data-panel="timeline" onclick="nefSwitchTab('timeline')">▸ TIMELINE</button>
                    <button class="nef-itab-btn"        data-panel="lore"     onclick="nefSwitchTab('lore')">▸ LORE</button>
                    <button class="nef-itab-btn"        data-panel="breach"   onclick="nefSwitchTab('breach')">▸ BREACH_PROTOCOL</button>
                </div>

                <!-- PAINEL: TIMELINE -->
                <div class="nef-itab-panel active" id="nef-panel-timeline">
                    <div class="nef-section-label">&gt; EVENTOS_GLOBAIS // STREAM AO VIVO</div>
                    <div id="nef-feed">
                        <div class="nef-empty-feed">&gt; AGUARDANDO TRANSMISSÃO DA REDE...</div>
                    </div>
                </div>

                <!-- PAINEL: LORE -->
                <div class="nef-itab-panel" id="nef-panel-lore">
                    <div class="nef-section-label">&gt; FRAGMENTOS_DE_LORE // DESBLOQUEADOS PELO SEU NÍVEL</div>
                    <div id="nef-lore-content">
                        <div class="nef-empty-feed">&gt; INICIALIZANDO...</div>
                    </div>
                </div>

                <!-- PAINEL: BREACH -->
                <div class="nef-itab-panel" id="nef-panel-breach">
                    <div class="nef-section-label">&gt; BREACH_PROTOCOL // DECODIFICAÇÃO DE NÓ</div>
                    <p style="font-family:'Space Mono',monospace; font-size:0.5rem; color:#444466; margin-bottom:16px;">
                        Clique nos nós na sequência exata antes do tempo esgotar.<br>
                        ✓ SUCESSO → +15 fragmentos de sucata + bônus no próximo drop.<br>
                        ✗ FALHA → próximo card recebe tag CORRUPTED.
                    </p>
                    <div id="nef-breach-area"></div>
                </div>
            </div>
        `;

        // Insere antes do primeiro modal (após as spa-screens principais)
        const firstModal = document.querySelector('.modal-overlay');
        if (firstModal) document.body.insertBefore(screen, firstModal);
        else document.body.appendChild(screen);
    }

    // =========================================================
    // PATCH em navigateTo para reconhecer 'explorar'
    // =========================================================
    function _patchNavigateTo() {
        const _orig = window.navigateTo;
        if (!_orig || window._nefNavigatePatched) return;
        window._nefNavigatePatched = true;

        window.navigateTo = function (screenId) {
            if (screenId === 'explorar') {
                // Mesma lógica do navigateTo original: remove .active de todas as screens
                document.querySelectorAll('.spa-screen').forEach(s => s.classList.remove('active'));
                const target = document.getElementById('screen-explorar');
                if (target) target.classList.add('active');
                // Lazy-render do conteúdo
                _lazyRenderExplorar();
                return;
            }
            return _orig.apply(this, arguments);
        };
    }

    // =========================================================
    // TAB SWITCHER INTERNO (exposto globalmente)
    // =========================================================
    const _nefRendered = { lore: false, breach: false };

    window.nefSwitchTab = function (panelId) {
        document.querySelectorAll('.nef-itab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.panel === panelId);
        });
        document.querySelectorAll('.nef-itab-panel').forEach(p => {
            p.classList.toggle('active', p.id === `nef-panel-${panelId}`);
        });
        if (panelId === 'lore'   && !_nefRendered.lore)   { _nefRendered.lore   = true; _renderLore(); }
        if (panelId === 'breach' && !_nefRendered.breach)  { _nefRendered.breach = true; _renderBreach(); }
    };

    let _explorarRendered = false;
    function _lazyRenderExplorar() {
        if (_explorarRendered) return;
        _explorarRendered = true;
        _subscribeTimeline();
    }

    // =========================================================
    // 1. TIMELINE REALTIME
    // =========================================================
    const _cache = []; // max 100 entradas
    let _realtimeSub = null;

    function _ts(iso) {
        try {
            const d = new Date(iso);
            return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
        } catch { return '--:--'; }
    }

    function _typeClass(row) {
        const t = (row.event_type || '').toLowerCase();
        if (t.startsWith('ledger')) return 'ledger';
        if (t.startsWith('feed'))   return 'feed';
        return 'sys';
    }

    function _label(row) {
        const p = row.payload || {};
        return p.message || p.text || p.label
            || (p.username && p.action ? `${p.username} ${p.action}` : null)
            || `[${(row.event_type || 'EVT').toUpperCase()}]`;
    }

    function _esc(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function _addToFeed(row, fresh) {
        const entry = { ts: row.created_at || new Date().toISOString(), cls: _typeClass(row), text: _label(row), fresh };
        _cache.unshift(entry);
        if (_cache.length > 100) _cache.pop();

        const feed = document.getElementById('nef-feed');
        if (!feed) return;

        // Remove placeholder vazio
        const empty = feed.querySelector('.nef-empty-feed');
        if (empty) empty.remove();

        const line = document.createElement('div');
        line.className = `nef-line ${entry.cls}${fresh ? ' fresh' : ''}`;
        line.innerHTML = `<span class="nef-ts">[${_ts(entry.ts)}]</span>${_esc(entry.text)}`;
        feed.insertBefore(line, feed.firstChild);
        if (fresh) setTimeout(() => line.classList.remove('fresh'), 2800);

        // Limita DOM
        while (feed.children.length > 60) feed.removeChild(feed.lastChild);
    }

    async function _subscribeTimeline() {
        // Histórico inicial
        try {
            const { data } = await sb.from('eventos_globais')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(40);
            (data || []).reverse().forEach(r => _addToFeed(r, false));
        } catch (e) { console.error('[nef/timeline]', e); }

        // Subscription realtime
        if (_realtimeSub) try { sb.removeChannel(_realtimeSub); } catch {}
        _realtimeSub = sb.channel('nef-global-events')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos_globais' }, p => {
                if (p && p.new) _addToFeed(p.new, true);
            })
            .subscribe();
    }

    // Exposto globalmente para outros módulos espelharem eventos
    window._nefPushTimeline = function (message, type) {
        _addToFeed({ created_at: new Date().toISOString(), event_type: type || 'sys', payload: { message } }, true);
    };

    // Monkey-patches para pushLedger / pushFeedCard (se existirem)
    function _hookGlobals() {
        ['pushLedger', 'pushFeedCard'].forEach((fn, i) => {
            const type = i === 0 ? 'ledger' : 'feed';
            const orig = window[fn];
            if (typeof orig !== 'function') return;
            window[fn] = function (...args) {
                const msg = typeof args[0] === 'string' ? args[0] : (args[0] && (args[0].text || args[0].message)) || null;
                if (msg) window._nefPushTimeline(msg, type);
                return orig.apply(this, args);
            };
        });
    }

    // =========================================================
    // 2. LORE
    // =========================================================
    function _operatorLevel(bumps) {
        if (bumps >= 10000) return 10;
        if (bumps >= 5000)  return 7;
        if (bumps >= 2000)  return 5;
        if (bumps >= 1000)  return 3;
        if (bumps >= 300)   return 2;
        return 1;
    }

    async function _renderLore() {
        const el = document.getElementById('nef-lore-content');
        if (!el) return;
        el.innerHTML = '<div class="nef-empty-feed">&gt; CARREGANDO ARQUIVOS...</div>';

        try {
            const level = _operatorLevel((currentUser && currentUser.bumps) || 0);
            const { data, error } = await sb.from('drop_station_lore')
                .select('style_name, lore_text_pt, min_level')
                .lte('min_level', level)
                .order('min_level', { ascending: false })
                .limit(4);

            if (error) throw error;
            if (!data || data.length === 0) {
                el.innerHTML = '<div class="nef-empty-feed">&gt; NENHUM FRAGMENTO ACESSÍVEL NO SEU NÍVEL. CONTINUE OPERANDO.</div>';
                return;
            }
            el.innerHTML = data.map(r => `
                <div class="nef-lore-card">
                    <div class="nef-lore-lvl">NÍVEL MÍNIMO: ${r.min_level}</div>
                    <div class="nef-lore-style">${_esc(r.style_name)}</div>
                    <div class="nef-lore-body">${_esc(r.lore_text_pt)}</div>
                </div>
            `).join('');
        } catch (e) {
            console.error('[nef/lore]', e);
            el.innerHTML = '<div class="nef-empty-feed">&gt; ERRO AO CARREGAR LORE.</div>';
        }
    }

    // =========================================================
    // 3. BREACH PROTOCOL
    // =========================================================
    const B = {
        seq: [], grid: [], step: 0,
        timer: null, timeLeft: 12, active: false,
        TIME: 12, FRAGS: 15, SIZE: 4, SEQ: 4
    };

    // Flags globais consumidas por drop-vault.js
    window._nefBonusHack   = false;
    window._nefCorruptNext = false;

    const HEX_POOL = ['1C','55','7A','BD','E9','2F','A4','FF','00','3E','6B','C0','D5','49','8F','17'];

    function _genBreach() {
        B.grid = [...HEX_POOL].sort(() => Math.random() - 0.5).slice(0, B.SIZE * B.SIZE);
        const idxs = Array.from({length: B.grid.length}, (_,i) => i).sort(() => Math.random() - 0.5).slice(0, B.SEQ);
        B.seq = idxs.map(i => B.grid[i]);
        B.step = 0; B.timeLeft = B.TIME; B.active = false;
    }

    function _renderBreach() {
        const area = document.getElementById('nef-breach-area');
        if (!area) return;
        _genBreach();

        area.innerHTML = `
            <div class="nef-breach-seq" id="nef-seq">
                ${B.seq.map((h,i) => `<span class="nef-seq-ch" id="nef-sc-${i}">${h}</span>`).join(' ')}
            </div>
            <div class="nef-breach-timer" id="nef-timer">${B.TIME}s</div>
            <div class="nef-grid" id="nef-grid">
                ${B.grid.map((h,i) => `
                    <div class="nef-node" id="nef-n-${i}" data-v="${h}" onclick="nefNodeClick(${i})">${h}</div>
                `).join('')}
            </div>
            <div class="nef-breach-status" id="nef-bstat">&gt; AGUARDANDO INÍCIO...</div>
            <button class="nef-btn primary" onclick="nefBreachStart()">▶ INICIAR</button>
            <button class="nef-btn" onclick="nefBreachReset()">↺ NOVO PUZZLE</button>
            <div id="nef-breach-result"></div>
        `;
        _highlightTargets();
    }

    function _highlightTargets() {
        document.querySelectorAll('.nef-node:not(.nef-used)').forEach(n => n.classList.remove('nef-target'));
        if (B.step >= B.SEQ) return;
        const val = B.seq[B.step];
        document.querySelectorAll(`.nef-node:not(.nef-used)[data-v="${val}"]`).forEach(n => n.classList.add('nef-target'));
    }

    window.nefBreachStart = function () {
        if (B.active) return;
        B.active = true;
        const stat = document.getElementById('nef-bstat');
        B.timer = setInterval(() => {
            B.timeLeft--;
            const timerEl = document.getElementById('nef-timer');
            if (timerEl) { timerEl.textContent = `${B.timeLeft}s`; timerEl.style.color = B.timeLeft <= 3 ? '#ff3333' : '#ffaa00'; }
            if (stat) stat.textContent = `> DECODIFICANDO... ${B.timeLeft}s restantes`;
            if (B.timeLeft <= 0) { clearInterval(B.timer); _breachFail('TIMEOUT'); }
        }, 1000);
        if (stat) stat.textContent = `> DECODIFICANDO... ${B.timeLeft}s restantes`;
    };

    window.nefBreachReset = function () {
        if (B.timer) clearInterval(B.timer);
        _renderBreach();
    };

    window.nefNodeClick = function (idx) {
        if (!B.active || B.step >= B.SEQ) return;
        const node = document.getElementById(`nef-n-${idx}`);
        if (!node || node.classList.contains('nef-used')) return;

        const val = B.grid[idx];
        const expected = B.seq[B.step];
        node.classList.add('nef-used');
        node.classList.remove('nef-target');

        if (val === expected) {
            node.classList.add('nef-ok');
            const sc = document.getElementById(`nef-sc-${B.step}`);
            if (sc) sc.classList.add('hit');
            B.step++;
            if (B.step >= B.SEQ) { clearInterval(B.timer); _breachSuccess(); }
            else _highlightTargets();
        } else {
            node.classList.add('nef-err');
            const sc = document.getElementById(`nef-sc-${B.step}`);
            if (sc) sc.classList.add('miss');
            clearInterval(B.timer);
            _breachFail('SEQUÊNCIA INCORRETA');
        }
    };

    async function _breachSuccess() {
        B.active = false;
        window._nefBonusHack   = true;
        window._nefCorruptNext = false;

        let fragsMsg = '';
        if (currentUser && currentUser.loggedIn && currentUser.id) {
            try {
                const newFrags = (currentUser.fragments || 0) + B.FRAGS;
                currentUser.fragments = newFrags;
                await updateProfileInSupabase(currentUser.id, { fragments: newFrags });
                fragsMsg = `+${B.FRAGS} fragmentos de sucata creditados.`;
                const fragEl = document.getElementById('profFragments');
                if (fragEl) fragEl.innerText = `${newFrags} FRAGS`;
            } catch (e) { console.error('[nef/breach]', e); }
        }

        window._nefPushTimeline('BREACH CONCLUÍDO // NÓ DECODIFICADO', 'sys');
        _showResult(true, `// ACESSO CONCEDIDO //<br><small style="color:#00aa44;">${fragsMsg} Flag BONUS_HACK ativa.</small>`);
        try { playSynthSound && playSynthSound('success'); } catch {}
    }

    function _breachFail(reason) {
        B.active = false;
        window._nefBonusHack   = false;
        window._nefCorruptNext = true;

        window._nefPushTimeline(`BREACH FALHOU // ${reason}`, 'sys');
        _showResult(false, `// FALHA DE INTRUSÃO //<br><small style="color:#aa2222;">${reason}. Próximo drop receberá tag CORRUPTED.</small>`);
        try { playTerminalSound && playTerminalSound('error'); } catch {}
    }

    function _showResult(ok, html) {
        const el = document.getElementById('nef-breach-result');
        if (!el) return;
        el.className = `nef-result-box ${ok ? 'success' : 'fail'}`;
        el.innerHTML = `${html}<br><br><button class="nef-btn" onclick="nefBreachReset()">↺ NOVO PUZZLE</button>`;
    }

    // =========================================================
    // BOOTSTRAP
    // =========================================================
    function _boot() {
        _injectStyles();
        _injectNavButton();
        _injectScreen();
        _patchNavigateTo();
        _hookGlobals();
    }

    // Aguarda DOM + globals
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => _waitReady(_boot));
    } else {
        _waitReady(_boot);
    }

})();
