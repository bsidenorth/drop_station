// =========================================================
// dr0p_station — MÓDULO: new-engagement-features.js
// PATCH 6 — TIMELINE INTEGRADA NA ENGINE + SUPPLY BAR
//
// REMOVIDO:
//   • Aba EXPLORAR do nav
//   • #screen-explorar (SPA separada)
//   • Breach Protocol mini-game
//
// ADICIONADO:
//   • Timeline de eventos_globais injetada dentro de #screen-engine
//     (abaixo do .stories-panel, dentro de #engine-timeline-panel)
//   • Subscription Supabase Realtime mostrando drops, fusões,
//     destruições na fornalha com nome do operador, raridade, ícone
//   • Supply Bar helpers (ver cards-inventory-db.js) hookados nas
//     funções de render do vault/market/album
//
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
    // ESTILOS CSS — TIMELINE INLINE NA ENGINE
    // =========================================================
    function _injectStyles() {
        if (document.getElementById('nef-styles')) return;
        const s = document.createElement('style');
        s.id = 'nef-styles';
        s.textContent = `
            /* ── ENGINE TIMELINE PANEL ── */
            #engine-timeline-panel {
                padding: 0 0 18px 0;
                border-top: 1px solid #0d0d1e;
                margin-top: 0;
            }
            .etl-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 0 8px 0;
                cursor: pointer;
                user-select: none;
            }
            .etl-title {
                font-family: 'Space Mono', monospace;
                font-size: 0.42rem;
                color: #333355;
                letter-spacing: 3px;
                text-transform: uppercase;
            }
            .etl-title .etl-dot {
                display: inline-block;
                width: 5px;
                height: 5px;
                border-radius: 50%;
                background: #00ff66;
                margin-right: 6px;
                vertical-align: middle;
                animation: etl-blink 1.4s ease-in-out infinite;
            }
            @keyframes etl-blink { 0%,100% { opacity:1; } 50% { opacity:0.2; } }
            .etl-toggle-icon {
                font-family: 'Space Mono', monospace;
                font-size: 0.4rem;
                color: #222244;
                transition: color 0.2s;
            }
            .etl-header:hover .etl-toggle-icon { color: #00ffcc55; }

            #etl-feed {
                max-height: 220px;
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: #00ffcc22 transparent;
                padding-right: 4px;
            }
            #etl-feed::-webkit-scrollbar { width: 3px; }
            #etl-feed::-webkit-scrollbar-thumb { background: #00ffcc22; border-radius:2px; }

            .etl-line {
                font-family: 'Space Mono', monospace;
                font-size: 0.44rem;
                line-height: 1.8;
                border-left: 2px solid #00ff6622;
                padding: 3px 0 3px 8px;
                margin-bottom: 2px;
                color: #00ff6666;
                word-break: break-word;
                transition: border-color 0.5s, color 0.5s, background 0.5s;
                border-radius: 0 2px 2px 0;
            }
            .etl-line.drop   { border-left-color: #00ffcc55; color: #00ffccaa; }
            .etl-line.fuse   { border-left-color: #ff00ff44; color: #ff00ffaa; }
            .etl-line.purge  { border-left-color: #ff333344; color: #ff3333aa; }
            .etl-line.ledger { border-left-color: #00ffcc33; color: #00ffcc88; }
            .etl-line.feed   { border-left-color: #ffaa0033; color: #ffaa0088; }
            .etl-line.sys    { border-left-color: #9933ff33; color: #9933ff88; }
            .etl-line.fresh  {
                background: #00ff660a;
                border-left-color: #00ff66 !important;
                color: #00ff66 !important;
            }
            .etl-ts { color: #1a1a33; margin-right: 5px; font-size: 0.38rem; }
            .etl-icon { margin-right: 4px; }
            .etl-rarity {
                font-size: 0.37rem;
                letter-spacing: 1px;
                opacity: 0.65;
                margin-left: 4px;
            }
            .etl-empty {
                font-family: 'Space Mono', monospace;
                font-size: 0.44rem;
                color: #1a1a33;
                padding: 14px 0 4px 0;
                text-align: center;
            }
            /* Collapsed state */
            #engine-timeline-panel.collapsed #etl-feed { display: none; }
            #engine-timeline-panel.collapsed .etl-toggle-icon::before { content: '▸'; }
            #engine-timeline-panel:not(.collapsed) .etl-toggle-icon::before { content: '▾'; }
        `;
        document.head.appendChild(s);
    }

    // =========================================================
    // INJEÇÃO DO PAINEL DE TIMELINE NA #screen-engine
    // =========================================================
    function _injectTimelinePanel() {
        if (document.getElementById('engine-timeline-panel')) return;

        const engineScreen = document.getElementById('screen-engine');
        if (!engineScreen) return;

        const panel = document.createElement('div');
        panel.id = 'engine-timeline-panel';
        // Começa expandido
        panel.innerHTML = `
            <div class="etl-header" onclick="_etlToggleCollapse()">
                <div class="etl-title">
                    <span class="etl-dot"></span>REDE_GLOBAL // EVENTOS AO VIVO
                </div>
                <span class="etl-toggle-icon"></span>
            </div>
            <div id="etl-feed">
                <div class="etl-empty">&gt; AGUARDANDO TRANSMISSÃO...</div>
            </div>
        `;

        // Insere após o .stories-panel (antes do .workspace ou no final do screen)
        const storiesPanel = engineScreen.querySelector('.stories-panel');
        if (storiesPanel && storiesPanel.nextSibling) {
            engineScreen.insertBefore(panel, storiesPanel.nextSibling);
        } else if (storiesPanel) {
            engineScreen.appendChild(panel);
        } else {
            // Fallback: insere como primeiro filho
            engineScreen.insertBefore(panel, engineScreen.firstChild);
        }
    }

    window._etlToggleCollapse = function () {
        const panel = document.getElementById('engine-timeline-panel');
        if (panel) panel.classList.toggle('collapsed');
    };

    // =========================================================
    // TIMELINE REALTIME — eventos_globais
    // =========================================================
    const _cache = [];
    let _realtimeSub = null;
    let _timelineBooted = false;

    function _ts(iso) {
        try {
            const d = new Date(iso);
            return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
        } catch { return '--:--'; }
    }

    // Determina tipo visual (drop, fuse, purge, ledger, feed, sys) da linha
    function _lineClass(row) {
        const tipo = (row.tipo || row.event_type || '').toLowerCase();
        const msg  = (row.mensagem || (row.payload && (row.payload.message || row.payload.text)) || '').toLowerCase();

        if (tipo === 'drop' || msg.includes('resgatou') || msg.includes('rescued') || msg.includes('claim')) return 'drop';
        if (tipo === 'fusao' || tipo === 'fusion' || msg.includes('fusão') || msg.includes('fundiu') || msg.includes('fus')) return 'fuse';
        if (tipo === 'purge' || tipo === 'fornalha' || msg.includes('destruiu') || msg.includes('purged') || msg.includes('fornalha')) return 'purge';
        if (tipo === 'ledger' || msg.startsWith('ledger')) return 'ledger';
        if (tipo === 'feed') return 'feed';
        return 'sys';
    }

    // Ícone visual por tipo
    const _ICONS = {
        drop:   '⬇',
        fuse:   '⚗',
        purge:  '🔥',
        ledger: '▸',
        feed:   '◈',
        sys:    '◆',
    };

    // Extrai texto legível da linha
    function _lineText(row) {
        return row.mensagem
            || (row.payload && (row.payload.message || row.payload.text || row.payload.label))
            || (row.username && row.tipo ? `${row.username} [${row.tipo}]` : null)
            || `[${(row.tipo || row.event_type || 'EVT').toUpperCase()}]`;
    }

    // Extrai raridade do payload se existir
    function _lineRarity(row) {
        const p = row.card_payload || (row.payload && row.payload.card_payload) || {};
        return p.rarityNameEN || p.rarity_name_en || p.rarityName || p.rarity_name || '';
    }

    function _esc(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function _addToFeed(row, fresh) {
        const cls  = _lineClass(row);
        const text = _lineText(row);
        const ts   = row.created_at || new Date().toISOString();
        const rarity = _lineRarity(row);
        const icon = _ICONS[cls] || '◆';

        const entry = { ts, cls, text, rarity, icon, fresh };
        _cache.unshift(entry);
        if (_cache.length > 100) _cache.pop();

        const feed = document.getElementById('etl-feed');
        if (!feed) return;

        const empty = feed.querySelector('.etl-empty');
        if (empty) empty.remove();

        const line = document.createElement('div');
        line.className = `etl-line ${cls}${fresh ? ' fresh' : ''}`;
        line.innerHTML = `<span class="etl-ts">[${_ts(ts)}]</span><span class="etl-icon">${icon}</span>${_esc(text)}${rarity ? `<span class="etl-rarity">[${_esc(rarity)}]</span>` : ''}`;
        feed.insertBefore(line, feed.firstChild);
        if (fresh) setTimeout(() => line.classList.remove('fresh'), 3000);

        // Limita DOM a 60 linhas
        while (feed.children.length > 60) feed.removeChild(feed.lastChild);
    }

    async function _subscribeTimeline() {
        if (_timelineBooted) return;
        _timelineBooted = true;

        // Histórico inicial (últimos 40 eventos)
        try {
            const { data } = await sb.from('eventos_globais')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(40);
            (data || []).reverse().forEach(r => _addToFeed(r, false));
        } catch (e) { console.error('[etl/timeline]', e); }

        // Subscription Realtime
        if (_realtimeSub) try { sb.removeChannel(_realtimeSub); } catch {}
        _realtimeSub = sb.channel('etl-global-events')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos_globais' }, p => {
                if (p && p.new) _addToFeed(p.new, true);
            })
            .subscribe();
    }

    // API global para outros módulos empurrarem eventos na timeline
    window._nefPushTimeline = function (message, type) {
        _addToFeed({ created_at: new Date().toISOString(), tipo: type || 'sys', mensagem: message }, true);
    };

    // Compatibilidade com pushLedger / pushFeedCard (monkey-patch)
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
    // HOOK NAS FUNÇÕES DE RENDER PARA SUPPLY BARS
    // =========================================================
    function _hookRenderForSupplyBars() {
        const renderFns = ['renderVaultGrid', 'renderMarketGrid', 'renderAlbumGrid', 'renderShowcaseInventory'];
        renderFns.forEach(fnName => {
            const orig = window[fnName];
            if (typeof orig !== 'function' || window[`_supplyHooked_${fnName}`]) return;
            window[`_supplyHooked_${fnName}`] = true;
            window[fnName] = function (...args) {
                const result = orig.apply(this, args);
                // Aguarda render terminar, depois injeta supply bars
                setTimeout(() => {
                    if (typeof window.enrichAllCardsWithSupplyBars === 'function') {
                        window.enrichAllCardsWithSupplyBars();
                    }
                }, 120);
                return result;
            };
        });
    }

    // =========================================================
    // BOOTSTRAP
    // =========================================================
    function _boot() {
        _injectStyles();
        _injectTimelinePanel();
        _subscribeTimeline();
        _hookGlobals();
        _hookRenderForSupplyBars();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => _waitReady(_boot));
    } else {
        _waitReady(_boot);
    }

})();
