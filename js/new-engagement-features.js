// =========================================================
// dr0p_station — MÓDULO: new-engagement-features.js
// PATCH 6 — FEED VISUAL EXPLORAR (estilo Instagram/stories)
//
// • Aba EXPLORAR no nav (mantida)
// • #screen-explorar com feed de cards visuais em grid
//   mostrando a arte real (imgSrc do card_payload), operador,
//   raridade, tipo de evento (drop/fusão/purge)
// • Cards purged com o mesmo efeito is-purged do cofre
// • Subscription Supabase Realtime em eventos_globais
// • Tab LORE mantida
// • Breach Protocol REMOVIDO
//
// Reutiliza as classes CSS já existentes:
//   .album-card .album-preview-wrapper .album-meta
//   .album-rarity .rare-* .is-purged
// =========================================================

(function () {
    'use strict';

    function _waitReady(fn) {
        if (typeof sb !== 'undefined' && typeof currentUser !== 'undefined') fn();
        else setTimeout(() => _waitReady(fn), 150);
    }

    // =========================================================
    // ESTILOS — só o que não existe ainda no style.css
    // =========================================================
    function _injectStyles() {
        if (document.getElementById('nef-styles')) return;
        const s = document.createElement('style');
        s.id = 'nef-styles';
        s.textContent = `
            /* ── SCREEN EXPLORAR ── */
            #screen-explorar .vault-layout { max-width: 960px; }

            /* ── TABS INTERNAS ── */
            .nef-inner-tabs {
                display: flex;
                gap: 0;
                border-bottom: 1px solid #1a1a2e;
                margin-bottom: 20px;
            }
            .nef-itab-btn {
                background: none; border: none;
                border-bottom: 2px solid transparent;
                color: #444466;
                font-family: 'Space Mono', monospace;
                font-size: 0.55rem; letter-spacing: 2px;
                padding: 9px 18px; cursor: pointer;
                text-transform: uppercase;
                margin-bottom: -1px;
                transition: color 0.2s, border-color 0.2s;
            }
            .nef-itab-btn:hover { color: #00ffcc; }
            .nef-itab-btn.active { color: #00ffcc; border-bottom-color: #00ffcc; }
            .nef-itab-panel { display: none; }
            .nef-itab-panel.active { display: block; animation: nef-fin 0.22s ease; }
            @keyframes nef-fin { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }

            /* ── FEED GRID (Explorar) ── */
            #nef-explore-feed {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                gap: 16px;
                padding-bottom: 20px;
            }
            @media (max-width: 600px) {
                #nef-explore-feed {
                    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                    gap: 10px;
                }
            }

            /* ── CARD DO FEED — estende .album-card com contexto de evento ── */
            .nef-feed-card {
                position: relative;
                cursor: pointer;
                animation: nef-card-in 0.35s cubic-bezier(0.16,1,0.3,1);
            }
            @keyframes nef-card-in {
                from { opacity:0; transform: scale(0.92) translateY(8px); }
                to   { opacity:1; transform: none; }
            }

            /* Badge de evento (DROP / FUSÃO / PURGE) no topo do card */
            .nef-event-badge {
                position: absolute;
                top: 6px; left: 6px;
                z-index: 10;
                font-family: 'Space Mono', monospace;
                font-size: 0.38rem;
                font-weight: 700;
                letter-spacing: 1.5px;
                padding: 2px 6px;
                text-transform: uppercase;
                pointer-events: none;
            }
            .nef-event-badge.drop   { background: #00ffcc22; color: #00ffcc; border: 1px solid #00ffcc55; }
            .nef-event-badge.fuse   { background: #ff00ff22; color: #ff00ff; border: 1px solid #ff00ff55; }
            .nef-event-badge.purge  { background: #ff003322; color: #ff0033; border: 1px solid #ff003355; }
            .nef-event-badge.market { background: #ffaa0022; color: #ffaa00; border: 1px solid #ffaa0055; }

            /* Operador (@username) abaixo da arte */
            .nef-card-operator {
                font-family: 'Space Mono', monospace;
                font-size: 0.44rem;
                color: #555577;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 2px;
                letter-spacing: 0.5px;
            }
            .nef-card-operator span { color: #00ffcc88; }

            /* Card sem imagem — placeholder */
            .nef-no-art {
                width: 100%;
                aspect-ratio: 1/1;
                background: #07070f;
                border: 1px dashed #1c1c28;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: 'Space Mono', monospace;
                font-size: 0.42rem;
                color: #222233;
                letter-spacing: 2px;
            }

            /* NEW badge piscando em cards frescos */
            .nef-feed-card.fresh-card .nef-event-badge {
                animation: nef-badge-blink 0.8s steps(1) 4;
            }
            @keyframes nef-badge-blink {
                0%,100% { opacity:1; } 50% { opacity:0; }
            }

            /* ESTADO VAZIO */
            .nef-empty {
                grid-column: 1 / -1;
                text-align: center;
                padding: 60px 20px;
                font-family: 'Space Mono', monospace;
                font-size: 0.55rem;
                color: #1a1a33;
                border: 2px dashed #0d0d1e;
            }

            /* ── LORE ── */
            .nef-lore-card {
                border-left: 2px solid #00ffcc22;
                padding: 10px 0 10px 12px;
                margin-bottom: 14px;
            }
            .nef-lore-style {
                font-family: 'Archivo Black', sans-serif;
                font-size: 0.75rem; color: #00ffcc; margin-bottom: 5px;
            }
            .nef-lore-body {
                font-family: 'Space Mono', monospace;
                font-size: 0.51rem; color: #777799; line-height: 1.9;
            }
            .nef-lore-lvl { font-size: 0.42rem; color: #333355; letter-spacing: 1px; margin-bottom: 3px; }
            .nef-empty-feed {
                font-family: 'Space Mono', monospace;
                font-size: 0.5rem; color: #222244; padding: 20px 0;
            }

            /* ── LOAD MORE ── */
            .nef-load-more-wrap {
                grid-column: 1 / -1;
                text-align: center;
                padding: 10px 0 4px;
            }
            .nef-load-more {
                background: none;
                border: 1px solid #1a1a2e;
                color: #333355;
                font-family: 'Space Mono', monospace;
                font-size: 0.48rem;
                padding: 8px 20px;
                cursor: pointer;
                letter-spacing: 2px;
                text-transform: uppercase;
                transition: border-color 0.2s, color 0.2s;
            }
            .nef-load-more:hover { border-color: #00ffcc44; color: #00ffcc88; }

            /* Dot realtime no header da tab */
            .nef-live-dot {
                display: inline-block;
                width: 5px; height: 5px;
                border-radius: 50%;
                background: #00ff66;
                margin-left: 6px;
                vertical-align: middle;
                animation: etl-blink 1.4s ease-in-out infinite;
            }
            @keyframes etl-blink { 0%,100% { opacity:1; } 50% { opacity:0.15; } }
        `;
        document.head.appendChild(s);
    }

    // =========================================================
    // INJEÇÃO DO BOTÃO EXPLORAR NO HEADER NAV
    // =========================================================
    function _injectNavButton() {
        const navWrapper = document.getElementById('navMenuWrapper');
        if (!navWrapper || document.getElementById('navExplorBtn')) return;
        const btn = document.createElement('button');
        btn.className = 'btn-navigation';
        btn.id = 'navExplorBtn';
        btn.onclick = () => { if (typeof navigateTo === 'function') navigateTo('explorar'); };
        btn.innerHTML = `<span>EXPLORAR</span><span class="btn-sub-nav">FEED · LORE</span>`;
        const authBtn = document.getElementById('navAuthBtn');
        if (authBtn) navWrapper.insertBefore(btn, authBtn);
        else navWrapper.appendChild(btn);
    }

    // =========================================================
    // INJEÇÃO DA SPA #screen-explorar
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
                    <p style="font-size:0.6rem; color:#888899;">Cards ao vivo — drops, fusões e destruições da rede.</p>
                </div>

                <div class="nef-inner-tabs">
                    <button class="nef-itab-btn active" data-panel="feed" onclick="nefSwitchTab('feed')">
                        ▸ FEED<span class="nef-live-dot"></span>
                    </button>
                    <button class="nef-itab-btn" data-panel="lore" onclick="nefSwitchTab('lore')">▸ LORE</button>
                </div>

                <!-- PAINEL: FEED VISUAL -->
                <div class="nef-itab-panel active" id="nef-panel-feed">
                    <div id="nef-explore-feed">
                        <div class="nef-empty">&gt; AGUARDANDO TRANSMISSÃO DA REDE...</div>
                    </div>
                </div>

                <!-- PAINEL: LORE -->
                <div class="nef-itab-panel" id="nef-panel-lore">
                    <div class="nef-section-label" style="font-family:'Space Mono',monospace;font-size:0.45rem;color:#333355;letter-spacing:3px;margin-bottom:10px;text-transform:uppercase;">&gt; FRAGMENTOS_DE_LORE // DESBLOQUEADOS PELO SEU NÍVEL</div>
                    <div id="nef-lore-content">
                        <div class="nef-empty-feed">&gt; INICIALIZANDO...</div>
                    </div>
                </div>
            </div>
        `;
        const firstModal = document.querySelector('.modal-overlay');
        if (firstModal) document.body.insertBefore(screen, firstModal);
        else document.body.appendChild(screen);
    }

    // =========================================================
    // PATCH navigateTo para reconhecer 'explorar'
    // =========================================================
    function _patchNavigateTo() {
        const _orig = window.navigateTo;
        if (!_orig || window._nefNavigatePatched) return;
        window._nefNavigatePatched = true;
        window.navigateTo = function (screenId) {
            if (screenId === 'explorar') {
                document.querySelectorAll('.spa-screen').forEach(s => s.classList.remove('active'));
                const target = document.getElementById('screen-explorar');
                if (target) target.classList.add('active');
                _lazyBootFeed();
                return;
            }
            return _orig.apply(this, arguments);
        };
    }

    // =========================================================
    // TAB SWITCHER
    // =========================================================
    const _tabRendered = { lore: false };
    window.nefSwitchTab = function (panelId) {
        document.querySelectorAll('.nef-itab-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === panelId));
        document.querySelectorAll('.nef-itab-panel').forEach(p => p.classList.toggle('active', p.id === `nef-panel-${panelId}`));
        if (panelId === 'lore' && !_tabRendered.lore) { _tabRendered.lore = true; _renderLore(); }
    };

    // =========================================================
    // HELPERS — tipo de evento, raridade, classes
    // =========================================================
    function _eventType(row) {
        const tipo = (row.tipo || row.event_type || '').toLowerCase();
        const msg  = (row.mensagem || '').toLowerCase();
        if (tipo === 'drop'   || msg.includes('resgatou') || msg.includes('drop'))    return 'drop';
        if (tipo === 'fusao'  || tipo === 'fusion' || msg.includes('fundiu') || msg.includes('fus')) return 'fuse';
        if (tipo === 'purge'  || msg.includes('destruiu') || msg.includes('fornalha')) return 'purge';
        if (tipo === 'market' || msg.includes('vendeu') || msg.includes('comprou'))   return 'market';
        return 'drop'; // fallback mais comum
    }

    const EVENT_LABEL = { drop: '⬇ DROP', fuse: '⚗ FUSÃO', purge: '🔥 PURGE', market: '◈ TRADE' };

    function _rarityClass(r) {
        const v = (r || '').toLowerCase();
        if (v.includes('ancestral')) return 'rare-ancestral';
        if (v.includes('legendary') || v.includes('lendário')) return 'rare-legendary';
        if (v.includes('epic')      || v.includes('épico'))    return 'rare-epic';
        return 'rare-common';
    }

    function _rarityColor(r) {
        const v = (r || '').toLowerCase();
        if (v.includes('ancestral')) return '#ff007f';
        if (v.includes('legendary') || v.includes('lendário')) return '#00ffff';
        if (v.includes('epic')      || v.includes('épico'))    return '#ffaa00';
        return '#555566';
    }

    function _extractPayload(row) {
        // card_payload pode estar na raiz ou dentro de payload
        return row.card_payload
            || (row.payload && typeof row.payload === 'object' && row.payload.card_payload)
            || null;
    }

    function _operatorName(row) {
        return row.username
            || (row.payload && row.payload.username)
            || row.id_usuario
            || '???';
    }

    function _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // =========================================================
    // CONSTRUÇÃO DO CARD VISUAL
    // =========================================================
    function _buildCardEl(row, fresh) {
        const evType  = _eventType(row);
        const payload = _extractPayload(row);
        const imgSrc  = payload && (payload.imgSrc || payload.img_src);
        const rarity  = payload && (payload.rarityNameEN || payload.rarity_name_en || payload.rarityName || payload.rarity_name || '');
        const styleNm = payload && (payload.styleName  || payload.style_name  || '');
        const cardId  = payload && (payload.id || payload.display_id || '');
        const isPurged= payload && (payload.isPurged || payload.is_purged);
        const operator= _operatorName(row);

        const rarClass = _rarityClass(rarity);
        const rarColor = _rarityColor(rarity);

        const wrapper = document.createElement('div');
        wrapper.className = `nef-feed-card album-card ${rarClass}${isPurged ? ' is-purged' : ''}${fresh ? ' fresh-card' : ''}`;
        if (isPurged) {
            // Aplica variável CSS para texto PURGED/DETONADA igual ao cofre
            const lang = (typeof currentLang !== 'undefined' && currentLang === 'EN') ? 'PURGED' : 'DETONADA';
            wrapper.style.setProperty('--purge-label', `"${lang}"`);
        }

        const artHTML = imgSrc
            ? `<div class="album-preview-wrapper"><img src="${_esc(imgSrc)}" alt="${_esc(styleNm || cardId)}" loading="lazy" draggable="false"></div>`
            : `<div class="nef-no-art">SEM_ARTE</div>`;

        const rarLabel = rarity
            ? `<div class="album-rarity" style="color:${rarColor};">${_esc(rarity)}</div>`
            : '';

        const idLabel = cardId
            ? `<div class="album-id" style="font-size:0.7rem;">${_esc(cardId)}</div>`
            : (styleNm ? `<div class="album-id" style="font-size:0.65rem;color:#888899;">${_esc(styleNm)}</div>` : '');

        wrapper.innerHTML = `
            <div class="nef-event-badge ${evType}">${EVENT_LABEL[evType] || '◆'}</div>
            ${artHTML}
            <div class="album-meta">
                ${rarLabel}
                ${idLabel}
                <div class="nef-card-operator"><span>@</span>${_esc(operator)}</div>
            </div>
        `;

        // Clique abre inspect se disponível
        wrapper.addEventListener('click', () => {
            if (payload && typeof window.openInspectModal === 'function') {
                window.openInspectModal(payload);
            }
        });

        return wrapper;
    }

    // =========================================================
    // FEED REALTIME
    // =========================================================
    let _feedBooted = false;
    let _realtimeSub = null;
    let _feedOffset = 0;
    const FEED_PAGE = 24;
    const _renderedIds = new Set(); // deduplicação: evita que histórico + realtime + pushFeedCard insiram o mesmo evento duas vezes

    function _lazyBootFeed() {
        if (_feedBooted) return;
        _feedBooted = true;
        _loadFeedPage(true);
        _subscribeRealtime();
    }

    async function _loadFeedPage(initial) {
        const grid = document.getElementById('nef-explore-feed');
        if (!grid) return;

        grid.querySelector('.nef-empty')?.remove();
        grid.querySelector('.nef-load-more-wrap')?.remove();

        try {
            const { data, error } = await sb.from('eventos_globais')
                .select('*')
                .order('created_at', { ascending: false })
                .range(_feedOffset, _feedOffset + FEED_PAGE - 1);

            if (error) throw error;

            if (!data || data.length === 0) {
                if (initial) grid.innerHTML = '<div class="nef-empty">&gt; NENHUM EVENTO NA REDE AINDA.</div>';
                return;
            }

            // Só eventos com arte, sem duplicatas
            const fresh = data.filter(r => _extractPayload(r) && !_renderedIds.has(r.id));
            fresh.forEach(row => {
                _renderedIds.add(row.id);
                grid.appendChild(_buildCardEl(row, false));
            });

            if (data.length === FEED_PAGE) {
                _feedOffset += FEED_PAGE;
                const wrap = document.createElement('div');
                wrap.className = 'nef-load-more-wrap';
                wrap.innerHTML = '<button class="nef-load-more" onclick="nefLoadMoreFeed()">▾ CARREGAR MAIS</button>';
                grid.appendChild(wrap);
            }

        } catch (e) {
            console.error('[nef/feed]', e);
            if (initial) grid.innerHTML = '<div class="nef-empty">&gt; ERRO AO CARREGAR O FEED. TENTE NOVAMENTE.</div>';
        }
    }

    window.nefLoadMoreFeed = function () { _loadFeedPage(false); };

    function _subscribeRealtime() {
        if (_realtimeSub) try { sb.removeChannel(_realtimeSub); } catch {}
        _realtimeSub = sb.channel('nef-explorar-realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos_globais' }, p => {
                if (!p || !p.new) return;
                const row = p.new;
                if (!_extractPayload(row)) return;
                // Deduplicação: ignora se já foi inserido pelo histórico ou pushFeedCard
                if (_renderedIds.has(row.id)) return;
                _renderedIds.add(row.id);
                const grid = document.getElementById('nef-explore-feed');
                if (!grid) return;
                grid.querySelector('.nef-empty')?.remove();
                const el = _buildCardEl(row, true);
                grid.insertBefore(el, grid.firstChild);
                setTimeout(() => el.classList.remove('fresh-card'), 3200);
                // Limita DOM a 60 cards
                const cards = grid.querySelectorAll('.nef-feed-card');
                if (cards.length > 60) cards[cards.length - 1].remove();
            })
            .subscribe();
    }

    // API global — outros módulos podem empurrar eventos manualmente
    window._nefPushTimeline = function (message, type) {
        // Compatibilidade com chamadas legadas (não empurra no feed visual sem arte)
    };

    // Monkey-patches pushLedger / pushFeedCard para injetar no feed visual
    function _hookGlobals() {
        // pushFeedCard recebe o card diretamente — injeta no feed se explorar estiver aberto
        const origPush = window.pushFeedCard;
        if (typeof origPush === 'function' && !window._nefHookedPushFeedCard) {
            window._nefHookedPushFeedCard = true;
            window.pushFeedCard = function (card, evType) {
                const result = origPush.apply(this, arguments);
                // Monta row fake para o feed visual
                const fakeRow = {
                    tipo: evType || 'drop',
                    username: (typeof currentUser !== 'undefined' && currentUser.username) || '???',
                    card_payload: card,
                    created_at: new Date().toISOString()
                };
                // Usa display_id do card como chave local (sem ID de banco)
                const localKey = `local_${card.id || card.display_id || Date.now()}`;
                if (!_renderedIds.has(localKey)) {
                    _renderedIds.add(localKey);
                    const grid = document.getElementById('nef-explore-feed');
                    if (grid) {
                        grid.querySelector('.nef-empty')?.remove();
                        const el = _buildCardEl(fakeRow, true);
                        grid.insertBefore(el, grid.firstChild);
                        setTimeout(() => el.classList.remove('fresh-card'), 3200);
                        const cards = grid.querySelectorAll('.nef-feed-card');
                        if (cards.length > 60) cards[cards.length - 1].remove();
                    }
                }
                return result;
            };
        }
    }

    // =========================================================
    // LORE
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
    // BOOTSTRAP
    // =========================================================
    function _boot() {
        _injectStyles();
        _injectNavButton();
        _injectScreen();
        _patchNavigateTo();
        _hookGlobals();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => _waitReady(_boot));
    } else {
        _waitReady(_boot);
    }

})();
