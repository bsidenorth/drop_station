// =========================================================
// dr0p_station — MÓDULO: new-engagement-features.js
// NOVAS MECÂNICAS DE ENGAJAMENTO (PATCH 5)
//
// Carregado APÓS missions-leaderboard.js na ordem de scripts.
// Injeta via DOM manipulation (sem tocar no index.html):
//   1. Aba "EXPLORAR" — Timeline realtime de eventos globais
//   2. Seção de Lore — Trechos dinâmicos por nível do operador
//   3. Mini-game de Decodificação — Hack matrix (Breach Protocol)
//
// Dependências globais esperadas (definidas nos outros módulos):
//   sb (Supabase client), currentUser, savedAssets,
//   showCyberAlert, playSynthSound, playTerminalSound,
//   updateProfileInSupabase, pushLedger, pushFeedCard
// =========================================================

(function() {
'use strict';

// =========================================================
// GUARD — aguarda o DOM estar pronto antes de injetar
// =========================================================
function onDOMReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn);
    } else {
        fn();
    }
}

// =========================================================
// UTILITÁRIOS INTERNOS
// =========================================================

/** Gera uma string de N chars aleatórios estilo hacker */
function _randHex(n) {
    const chars = '0123456789ABCDEF';
    let s = '';
    for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

/** Efeito de digitação em um elemento */
function _typeText(el, text, speed = 18) {
    return new Promise(resolve => {
        el.textContent = '';
        let i = 0;
        const tick = () => {
            if (i < text.length) {
                el.textContent += text[i++];
                setTimeout(tick, speed);
            } else resolve();
        };
        tick();
    });
}

/** Injeta estilos CSS uma única vez */
let _stylesInjected = false;
function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'nef-styles';
    style.textContent = `
        /* ── TAB NAV INJETADA ── */
        .nef-tab-btn {
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: #555566;
            font-family: 'Space Mono', monospace;
            font-size: 0.52rem;
            letter-spacing: 2px;
            padding: 8px 14px;
            cursor: pointer;
            transition: color 0.2s, border-color 0.2s;
            text-transform: uppercase;
        }
        .nef-tab-btn:hover { color: #00ffcc; }
        .nef-tab-btn.active {
            color: #00ffcc;
            border-bottom-color: #00ffcc;
        }
        .nef-tab-panel {
            display: none;
            animation: nef-fadein 0.25s ease;
        }
        .nef-tab-panel.active { display: block; }
        @keyframes nef-fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

        /* ── TIMELINE ── */
        #nef-timeline-feed {
            max-height: 340px;
            overflow-y: auto;
            padding: 0 2px;
            scrollbar-width: thin;
            scrollbar-color: #00ffcc22 transparent;
        }
        .nef-event-line {
            font-family: 'Space Mono', monospace;
            font-size: 0.5rem;
            color: #00ff6699;
            line-height: 1.9;
            border-left: 2px solid #00ff6622;
            padding-left: 8px;
            margin-bottom: 3px;
            transition: border-color 0.3s;
            word-break: break-all;
        }
        .nef-event-line.type-ledger { border-left-color: #00ffcc44; color: #00ffccaa; }
        .nef-event-line.type-feed   { border-left-color: #ffaa0044; color: #ffaa00aa; }
        .nef-event-line.type-sys    { border-left-color: #9933ff44; color: #9933ffaa; }
        .nef-event-line.new-entry   { border-left-color: #00ff66; color: #00ff66; }
        .nef-event-ts {
            color: #333344;
            margin-right: 6px;
            font-size: 0.45rem;
        }

        /* ── LORE ── */
        #nef-lore-section {
            padding: 16px 0 8px;
        }
        .nef-lore-header {
            font-size: 0.45rem;
            color: #444455;
            letter-spacing: 3px;
            margin-bottom: 10px;
        }
        .nef-lore-style-name {
            font-family: 'Archivo Black', sans-serif;
            font-size: 0.9rem;
            color: #00ffcc;
            margin-bottom: 6px;
        }
        .nef-lore-text {
            font-family: 'Space Mono', monospace;
            font-size: 0.52rem;
            color: #888899;
            line-height: 1.85;
            border-left: 2px solid #00ffcc22;
            padding-left: 10px;
            margin-bottom: 12px;
        }
        .nef-lore-empty {
            font-family: 'Space Mono', monospace;
            font-size: 0.52rem;
            color: #333344;
            font-style: italic;
        }

        /* ── BREACH PROTOCOL (MINI-GAME) ── */
        #nef-breach-wrapper {
            padding: 12px 0;
        }
        .nef-breach-header {
            font-family: 'Space Mono', monospace;
            font-size: 0.45rem;
            color: #ffaa00;
            letter-spacing: 3px;
            margin-bottom: 4px;
        }
        .nef-breach-subheader {
            font-size: 0.45rem;
            color: #444455;
            margin-bottom: 14px;
        }
        .nef-breach-sequence-display {
            font-family: 'Space Mono', monospace;
            font-size: 0.7rem;
            color: #00ffcc;
            letter-spacing: 6px;
            margin-bottom: 14px;
            min-height: 22px;
        }
        .nef-breach-seq-char {
            display: inline-block;
            transition: color 0.15s;
        }
        .nef-breach-seq-char.hit  { color: #00ff66; }
        .nef-breach-seq-char.miss { color: #ff3333; }
        .nef-breach-grid {
            display: grid;
            gap: 5px;
            margin-bottom: 14px;
        }
        .nef-node {
            background: #0a0a14;
            border: 1px solid #222233;
            color: #00ffcc;
            font-family: 'Space Mono', monospace;
            font-size: 0.6rem;
            padding: 9px 5px;
            text-align: center;
            cursor: pointer;
            transition: background 0.12s, border-color 0.12s, color 0.12s;
            user-select: none;
            letter-spacing: 2px;
        }
        .nef-node:hover:not(.used):not(.target-active) {
            background: #111122;
            border-color: #00ffcc44;
        }
        .nef-node.target-active {
            border-color: #ffaa00;
            color: #ffaa00;
            background: #1a0e00;
            box-shadow: 0 0 8px rgba(255,170,0,0.25);
            animation: nef-pulse-node 0.5s ease infinite alternate;
        }
        .nef-node.used.correct {
            background: #001a0a;
            border-color: #00ff6644;
            color: #00ff6666;
            cursor: default;
        }
        .nef-node.used.wrong {
            background: #1a0000;
            border-color: #ff333344;
            color: #ff333366;
            cursor: default;
        }
        @keyframes nef-pulse-node {
            from { box-shadow: 0 0 4px rgba(255,170,0,0.2); }
            to   { box-shadow: 0 0 12px rgba(255,170,0,0.5); }
        }
        .nef-breach-status {
            font-family: 'Space Mono', monospace;
            font-size: 0.52rem;
            min-height: 18px;
            color: #555566;
            margin-bottom: 12px;
        }
        .nef-breach-btn {
            background: none;
            border: 1px solid #333344;
            color: #555566;
            font-family: 'Space Mono', monospace;
            font-size: 0.52rem;
            padding: 8px 18px;
            cursor: pointer;
            letter-spacing: 2px;
            text-transform: uppercase;
            transition: border-color 0.2s, color 0.2s;
        }
        .nef-breach-btn:hover {
            border-color: #ffaa00;
            color: #ffaa00;
        }
        .nef-breach-result-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: rgba(2,2,8,0.92);
            z-index: 5;
            font-family: 'Space Mono', monospace;
        }
        .nef-breach-result-title {
            font-family: 'Archivo Black', sans-serif;
            font-size: 1.1rem;
            margin-bottom: 8px;
        }
        .nef-breach-result-desc {
            font-size: 0.52rem;
            color: #888899;
            margin-bottom: 18px;
            text-align: center;
            padding: 0 20px;
        }
    `;
    document.head.appendChild(style);
}

// =========================================================
// 1. INJEÇÃO DE ABAS NO TERMINAL
// Busca o nav de abas existente e injeta "EXPLORAR" ao lado
// das abas originais sem sobrescrever nada.
// =========================================================

/** Estado das abas injetadas */
const NEF_TABS = {
    activePanel: null,
    panels: {}
};

/**
 * Encontra o container de abas do terminal no DOM.
 * Tenta vários seletores progressivamente para ser compatível
 * com diferentes versões do index.html.
 */
function _findTabNav() {
    return (
        document.querySelector('.tab-bar') ||
        document.querySelector('.nav-tabs') ||
        document.querySelector('[data-tab-nav]') ||
        document.querySelector('.terminal-tabs') ||
        document.querySelector('nav.tabs') ||
        null
    );
}

/**
 * Encontra o container de painéis de abas onde injetar os novos painéis.
 */
function _findTabPanelContainer() {
    return (
        document.querySelector('.tab-panels') ||
        document.querySelector('.tab-content') ||
        document.querySelector('[data-tab-panels]') ||
        document.querySelector('.terminal-content') ||
        null
    );
}

/**
 * Cria e registra uma nova aba + painel no terminal.
 * @param {string} id        Identificador da aba (slug)
 * @param {string} label     Texto exibido na tab
 * @param {Function} renderFn  Função chamada ao ativar o painel (pode ser async)
 */
function _createTab(id, label, renderFn) {
    const tabNav = _findTabNav();
    const panelContainer = _findTabPanelContainer();

    // ── Tab button ──
    const btn = document.createElement('button');
    btn.className = 'nef-tab-btn';
    btn.dataset.nefTab = id;
    btn.textContent = label;
    btn.addEventListener('click', () => _activateTab(id));

    if (tabNav) {
        tabNav.appendChild(btn);
    } else {
        // Fallback: injeta mini-nav flutuante no topo do body
        let fallbackNav = document.getElementById('nef-fallback-nav');
        if (!fallbackNav) {
            fallbackNav = document.createElement('div');
            fallbackNav.id = 'nef-fallback-nav';
            fallbackNav.style.cssText = `
                position: fixed; top: 0; right: 0; z-index: 9000;
                display: flex; gap: 4px; padding: 6px 10px;
                background: rgba(7,7,15,0.95); border-bottom: 1px solid #222233;
            `;
            document.body.appendChild(fallbackNav);
        }
        fallbackNav.appendChild(btn);
    }

    // ── Panel ──
    const panel = document.createElement('div');
    panel.id = `nef-panel-${id}`;
    panel.className = 'nef-tab-panel';
    panel.dataset.nefPanel = id;

    if (panelContainer) {
        panelContainer.appendChild(panel);
    } else {
        // Fallback: painel centralizado overlay
        panel.style.cssText = `
            position: fixed; top: 42px; right: 0; bottom: 0;
            width: min(420px, 100vw);
            background: #07070f;
            border-left: 1px solid #222233;
            z-index: 8999;
            overflow-y: auto;
            padding: 16px;
        `;
        document.body.appendChild(panel);
    }

    NEF_TABS.panels[id] = { btn, panel, renderFn, rendered: false };
}

function _activateTab(id) {
    // Desativa tudo
    Object.values(NEF_TABS.panels).forEach(t => {
        t.btn.classList.remove('active');
        t.panel.classList.remove('active');
    });

    // Ativa aba alvo
    const tab = NEF_TABS.panels[id];
    if (!tab) return;
    tab.btn.classList.add('active');
    tab.panel.classList.add('active');
    NEF_TABS.activePanel = id;

    // Chama renderFn na primeira ativação (lazy render)
    if (!tab.rendered) {
        tab.rendered = true;
        try { tab.renderFn(tab.panel); } catch(e) { console.error('[nef] render error:', e); }
    }
}

// =========================================================
// 2. ABA EXPLORAR — TIMELINE REALTIME
// =========================================================

/** Cache da timeline (máx 120 entradas) */
const _timelineCache = [];
const TIMELINE_MAX = 120;
let _timelineSubscription = null;
let _timelinePanelEl = null;

function _fmtTimestamp(ts) {
    try {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    } catch { return '--:--:--'; }
}

function _classifyEventType(row) {
    const t = (row.event_type || '').toLowerCase();
    if (t === 'ledger' || t.startsWith('ledger')) return 'type-ledger';
    if (t === 'feed'   || t.startsWith('feed'))   return 'type-feed';
    return 'type-sys';
}

function _buildEventLabel(row) {
    const payload = row.payload || {};
    // Tenta extrair mensagem de vários formatos de payload
    if (payload.message) return payload.message;
    if (payload.text)    return payload.text;
    if (payload.label)   return payload.label;
    if (payload.username && payload.action) return `${payload.username} ${payload.action}`;
    return row.event_type ? `[${row.event_type.toUpperCase()}] ${_randHex(8)}` : `>> ${_randHex(16)}`;
}

/**
 * Adiciona uma entrada à timeline e atualiza o DOM se o painel estiver ativo.
 * @param {object} row  Linha de eventos_globais
 * @param {boolean} isNew  Se true, aplica highlight de entrada nova
 */
function _pushTimelineEntry(row, isNew = false) {
    const entry = {
        ts:    row.created_at || new Date().toISOString(),
        type:  _classifyEventType(row),
        label: _buildEventLabel(row),
        isNew
    };
    _timelineCache.unshift(entry); // mais recente primeiro
    if (_timelineCache.length > TIMELINE_MAX) _timelineCache.pop();

    // Atualiza DOM se o painel estiver montado e visível
    if (_timelinePanelEl) {
        const feed = _timelinePanelEl.querySelector('#nef-timeline-feed');
        if (feed) _prependTimelineDOM(feed, entry);
    }
}

function _prependTimelineDOM(feedEl, entry) {
    const line = document.createElement('div');
    line.className = `nef-event-line ${entry.type}${entry.isNew ? ' new-entry' : ''}`;
    line.innerHTML = `<span class="nef-event-ts">[${_fmtTimestamp(entry.ts)}]</span>${_escapeHtml(entry.label)}`;
    feedEl.insertBefore(line, feedEl.firstChild);

    // Remove highlight após 2.5s
    if (entry.isNew) {
        setTimeout(() => line.classList.remove('new-entry'), 2500);
    }

    // Limita DOM a 60 itens para não vazar memória
    while (feedEl.children.length > 60) feedEl.removeChild(feedEl.lastChild);
}

function _escapeHtml(str) {
    return String(str)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;');
}

/**
 * Injeta mensagem sintética na timeline (chamável de fora como pushLedger/pushFeedCard).
 * Exposto globalmente para ser interceptado pelos outros módulos.
 */
window._nefPushTimeline = function(message, type = 'sys') {
    _pushTimelineEntry({
        created_at: new Date().toISOString(),
        event_type: type,
        payload: { message }
    }, true);
};

/**
 * Monkey-patches globais: intercepta pushLedger e pushFeedCard (definidos
 * nos outros módulos) para espelhar na timeline sem alterar o comportamento original.
 */
function _hookGlobalFeedFunctions() {
    const _hookFn = (fnName, type) => {
        const originalFn = window[fnName];
        window[fnName] = function(...args) {
            // Tenta extrair texto da chamada original
            const msg = typeof args[0] === 'string' ? args[0]
                : (args[0] && args[0].text) ? args[0].text
                : (args[0] && args[0].message) ? args[0].message
                : null;
            if (msg) window._nefPushTimeline(msg, type);
            if (typeof originalFn === 'function') return originalFn.apply(this, args);
        };
    };

    // Hooks com fallback (funções podem não existir ainda)
    if (typeof window.pushLedger !== 'undefined')   _hookFn('pushLedger',   'ledger');
    else window.addEventListener('nef-ready', () => { if (typeof window.pushLedger !== 'undefined') _hookFn('pushLedger', 'ledger'); });

    if (typeof window.pushFeedCard !== 'undefined') _hookFn('pushFeedCard', 'feed');
    else window.addEventListener('nef-ready', () => { if (typeof window.pushFeedCard !== 'undefined') _hookFn('pushFeedCard', 'feed'); });
}

/**
 * Inscreve-se em tempo real na tabela eventos_globais via Supabase Realtime.
 */
async function _subscribeGlobalEvents() {
    // Carrega histórico inicial (últimas 40 entradas)
    try {
        const { data: history } = await sb
            .from('eventos_globais')
            .select('*')
            .in('event_type', ['ledger', 'feed', 'sys', 'drop', 'furnace'])
            .order('created_at', { ascending: false })
            .limit(40);

        (history || []).reverse().forEach(row => _pushTimelineEntry(row, false));
    } catch(e) {
        console.error('[nef/timeline] history load error:', e);
    }

    // Subscription realtime
    if (_timelineSubscription) {
        try { sb.removeChannel(_timelineSubscription); } catch {}
    }
    _timelineSubscription = sb
        .channel('nef-global-events')
        .on('postgres_changes', {
            event:  'INSERT',
            schema: 'public',
            table:  'eventos_globais'
        }, (payload) => {
            if (payload && payload.new) _pushTimelineEntry(payload.new, true);
        })
        .subscribe();
}

/** Renderiza o painel da aba Explorar */
async function _renderExplorePanel(panelEl) {
    _timelinePanelEl = panelEl;
    panelEl.innerHTML = `
        <div style="font-size:0.45rem; color:#444455; letter-spacing:3px; margin-bottom:12px; font-family:'Space Mono',monospace;">
            &gt; EVENTOS_GLOBAIS // STREAM AO VIVO
        </div>
        <div id="nef-timeline-feed"></div>
        <div id="nef-lore-section"></div>
    `;

    // Popula timeline com cache existente
    const feed = panelEl.querySelector('#nef-timeline-feed');
    if (feed && _timelineCache.length > 0) {
        _timelineCache.forEach(entry => _prependTimelineDOM(feed, entry));
    } else if (feed) {
        feed.innerHTML = `<div class="nef-event-line type-sys" style="color:#333344; font-size:0.48rem;">
            > AGUARDANDO TRANSMISSÃO DA REDE...
        </div>`;
    }

    // Renderiza lore no mesmo painel
    const loreSection = panelEl.querySelector('#nef-lore-section');
    if (loreSection) await _renderLoreSection(loreSection);

    // Inicia subscription (idempotente)
    await _subscribeGlobalEvents();
}

// =========================================================
// 3. SEÇÃO DE LORE (INLINE NA ABA EXPLORAR)
// Carrega de drop_station_lore baseado no nível do operador.
// "Nível" é calculado a partir de bumps (simples e sem coluna extra).
// =========================================================

function _operatorLevel(bumps) {
    if (bumps >= 10000) return 10;
    if (bumps >= 5000)  return 7;
    if (bumps >= 2000)  return 5;
    if (bumps >= 1000)  return 3;
    if (bumps >= 300)   return 2;
    return 1;
}

async function _renderLoreSection(containerEl) {
    containerEl.innerHTML = `
        <div id="nef-lore-section">
            <div class="nef-lore-header">&gt; ARQUIVO_DE_LORE // FRAGMENTOS DECODIFICADOS</div>
            <div id="nef-lore-content" class="nef-lore-empty">⟳ INICIALIZANDO...</div>
        </div>
    `;
    const contentEl = containerEl.querySelector('#nef-lore-content');

    try {
        const level = _operatorLevel((window.currentUser && currentUser.bumps) || 0);

        const { data: loreRows, error } = await sb
            .from('drop_station_lore')
            .select('style_name, lore_text_pt')
            .lte('min_level', level)
            .order('min_level', { ascending: false })
            .limit(3);

        if (error) throw error;

        if (!loreRows || loreRows.length === 0) {
            contentEl.innerHTML = '<span class="nef-lore-empty">// NENHUM FRAGMENTO ACESSÍVEL NO SEU NÍVEL ATUAL. CONTINUE OPERANDO.</span>';
            return;
        }

        contentEl.innerHTML = loreRows.map(row => `
            <div class="nef-lore-style-name">${_escapeHtml(row.style_name)}</div>
            <div class="nef-lore-text">${_escapeHtml(row.lore_text_pt)}</div>
        `).join('');

    } catch(e) {
        console.error('[nef/lore] error:', e);
        contentEl.innerHTML = '<span class="nef-lore-empty">// ERRO AO CARREGAR ARQUIVO DE LORE.</span>';
    }
}

// =========================================================
// 4. MINI-GAME DE DECODIFICAÇÃO — BREACH PROTOCOL
//
// Uma sequência de 4 nós hexadecimais é gerada aleatoriamente.
// Uma grade 4×4 de nós é exibida. O usuário deve clicar nos
// nós na ordem correta dentro de um tempo limite (12s).
//
// Resultado:
//   SUCESSO → +scrap_fragments (15 frags) + flag bonusHack=true na sessão
//   FALHA   → flag corruptNextDrop=true (tag "CORRUPTED" injetada no próximo drop)
//
// As flags são exposta globalmente para drop-vault.js consumir.
// =========================================================

const BREACH = {
    sequence:       [],   // nós alvo na ordem correta
    grid:           [],   // todos os nós da grade (hex strings)
    currentStep:    0,    // índice do próximo nó a clicar
    timerRef:       null,
    timeLeft:       12,
    active:         false,
    panelEl:        null,
    GRID_SIZE:      4,    // 4×4
    SEQ_LEN:        4,
    TIME_LIMIT:     12,
    FRAG_REWARD:    15
};

// Flags globais consumidas por outros módulos
window._nefBonusHack      = false;  // true após breach bem-sucedido (sessão)
window._nefCorruptNext    = false;  // true após breach falhado (consumido 1x no próximo drop)

function _generateBreachGame() {
    const hexPool = [];
    // Gera pool de valores únicos hex de 2 chars (ex: A4, FF, 1C)
    const base = ['1C','55','7A','BD','E9','2F','A4','FF','00','3E','6B','C0','D5','49','8F','17'];
    // Embaralha
    const shuffled = base.sort(() => Math.random() - 0.5);
    BREACH.grid = shuffled.slice(0, BREACH.GRID_SIZE * BREACH.GRID_SIZE);
    // Sequência: 4 índices aleatórios da grade
    const idxPool = Array.from({ length: BREACH.grid.length }, (_, i) => i)
        .sort(() => Math.random() - 0.5)
        .slice(0, BREACH.SEQ_LEN);
    BREACH.sequence   = idxPool.map(i => BREACH.grid[i]);
    BREACH.currentStep = 0;
    BREACH.timeLeft    = BREACH.TIME_LIMIT;
    BREACH.active      = false;
}

function _renderBreachGame(panelEl) {
    BREACH.panelEl = panelEl;
    _generateBreachGame();

    panelEl.innerHTML = `
        <div id="nef-breach-wrapper" style="position:relative;">
            <div class="nef-breach-header">⟁ BREACH_PROTOCOL // DECODIFICAÇÃO DE NÓ</div>
            <div class="nef-breach-subheader">Clique nos nós na sequência exata. Tempo: ${BREACH.TIME_LIMIT}s</div>

            <div class="nef-breach-sequence-display" id="nef-seq-display">
                ${BREACH.sequence.map((h, i) => `<span class="nef-breach-seq-char" id="nef-seq-${i}">${h}</span>`).join(' ')}
            </div>

            <div class="nef-breach-grid" id="nef-grid"
                 style="grid-template-columns: repeat(${BREACH.GRID_SIZE}, 1fr);">
                ${BREACH.grid.map((h, i) => `
                    <div class="nef-node" id="nef-node-${i}" data-idx="${i}" data-val="${h}"
                         onclick="window._nefNodeClick(${i})">
                        ${h}
                    </div>
                `).join('')}
            </div>

            <div class="nef-breach-status" id="nef-breach-status">
                &gt; AGUARDANDO INÍCIO...
            </div>

            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button class="nef-breach-btn" id="nef-breach-start-btn" onclick="window._nefBreachStart()">
                    ▶ INICIAR DECODIFICAÇÃO
                </button>
                <button class="nef-breach-btn" onclick="window._nefBreachRerender()" style="color:#333344; border-color:#222233;">
                    ↺ NOVO PUZZLE
                </button>
            </div>
        </div>
    `;

    _highlightTargetNode();
}

/** Re-renderiza o mini-game com novo puzzle */
window._nefBreachRerender = function() {
    if (BREACH.timerRef) { clearInterval(BREACH.timerRef); BREACH.timerRef = null; }
    if (BREACH.panelEl) _renderBreachGame(BREACH.panelEl);
};

/** Destaca visualmente o nó que deve ser clicado agora */
function _highlightTargetNode() {
    // Remove destaques anteriores
    document.querySelectorAll('.nef-node.target-active').forEach(n => n.classList.remove('target-active'));
    if (BREACH.currentStep >= BREACH.SEQ_LEN) return;

    // O nó correto é qualquer nó com o valor alvo que ainda não foi usado.
    // Encontra o primeiro nó disponível com o valor correto.
    const targetVal = BREACH.sequence[BREACH.currentStep];
    // Destaca TODOS os nós com aquele valor (pode haver repetições na grade)
    document.querySelectorAll(`.nef-node:not(.used)[data-val="${targetVal}"]`).forEach(n => {
        n.classList.add('target-active');
    });
}

/** Inicia o timer do breach */
window._nefBreachStart = function() {
    if (BREACH.active) return;
    BREACH.active = true;

    const startBtn = document.getElementById('nef-breach-start-btn');
    if (startBtn) startBtn.disabled = true;

    const statusEl = document.getElementById('nef-breach-status');

    BREACH.timerRef = setInterval(() => {
        BREACH.timeLeft--;
        if (statusEl) {
            statusEl.textContent = `> DECODIFICANDO... ${BREACH.timeLeft}s restantes`;
            statusEl.style.color = BREACH.timeLeft <= 3 ? '#ff3333' : '#555566';
        }
        if (BREACH.timeLeft <= 0) {
            clearInterval(BREACH.timerRef);
            BREACH.timerRef = null;
            _breachFail('TIMEOUT — SEQUÊNCIA EXPIRADA');
        }
    }, 1000);

    if (statusEl) statusEl.textContent = `> DECODIFICANDO... ${BREACH.timeLeft}s restantes`;
    _highlightTargetNode();
};

/** Handler de clique num nó da grade */
window._nefNodeClick = function(idx) {
    if (!BREACH.active) return;
    if (BREACH.currentStep >= BREACH.SEQ_LEN) return;

    const nodeEl = document.getElementById(`nef-node-${idx}`);
    if (!nodeEl || nodeEl.classList.contains('used')) return;

    const val = BREACH.grid[idx];
    const expected = BREACH.sequence[BREACH.currentStep];

    nodeEl.classList.add('used');

    if (val === expected) {
        // ✓ Acerto
        nodeEl.classList.add('correct');
        nodeEl.classList.remove('target-active');

        // Marca na sequência display
        const seqCharEl = document.getElementById(`nef-seq-${BREACH.currentStep}`);
        if (seqCharEl) seqCharEl.classList.add('hit');

        BREACH.currentStep++;

        if (BREACH.currentStep >= BREACH.SEQ_LEN) {
            // Sequência completa!
            clearInterval(BREACH.timerRef);
            BREACH.timerRef = null;
            _breachSuccess();
        } else {
            _highlightTargetNode();
        }
    } else {
        // ✗ Erro
        nodeEl.classList.add('wrong');

        const seqCharEl = document.getElementById(`nef-seq-${BREACH.currentStep}`);
        if (seqCharEl) seqCharEl.classList.add('miss');

        clearInterval(BREACH.timerRef);
        BREACH.timerRef = null;
        _breachFail('SEQUÊNCIA INCORRETA — NÓ INVÁLIDO');
    }
};

async function _breachSuccess() {
    BREACH.active = false;
    window._nefBonusHack   = true;
    window._nefCorruptNext = false;

    // Concede fragmentos de sucata
    let fragsMsg = '';
    if (window.currentUser && currentUser.loggedIn && currentUser.id) {
        try {
            const newFrags = (currentUser.fragments || 0) + BREACH.FRAG_REWARD;
            currentUser.fragments = newFrags;
            await updateProfileInSupabase(currentUser.id, { fragments: newFrags });
            fragsMsg = `+${BREACH.FRAG_REWARD} fragmentos de sucata creditados.`;
            // Atualiza badge se visível
            const fragEl = document.getElementById('profFragments');
            if (fragEl) fragEl.innerText = `${newFrags} FRAGS`;
        } catch(e) { console.error('[nef/breach] frag credit error:', e); }
    }

    // Notifica timeline
    window._nefPushTimeline(`BREACH CONCLUÍDO // NÓ DECODIFICADO EM ${BREACH.TIME_LIMIT - BREACH.timeLeft}s`, 'sys');

    _showBreachResult(true,
        '// ACESSO CONCEDIDO //',
        `Sequência decodificada com sucesso.<br>${fragsMsg}<br><small style="color:#333344;">Flag BONUS_HACK ativa para o próximo drop.</small>`,
        '#00ff66'
    );

    try { playSynthSound('success'); } catch {}
}

function _breachFail(reason) {
    BREACH.active = false;
    window._nefBonusHack   = false;
    window._nefCorruptNext = true;

    // Notifica timeline
    window._nefPushTimeline(`BREACH FALHOU // ${reason}`, 'sys');

    _showBreachResult(false,
        '// FALHA DE INTRUSÃO //',
        `${reason}<br><small style="color:#333344;">Próximo card dropado receberá tag CORRUPTED.</small>`,
        '#ff3333'
    );

    try { playTerminalSound('error'); } catch {}
}

function _showBreachResult(success, title, desc, color) {
    const wrapper = document.getElementById('nef-breach-wrapper');
    if (!wrapper) return;

    // Remove overlay anterior se existir
    const prev = wrapper.querySelector('.nef-breach-result-overlay');
    if (prev) prev.remove();

    const overlay = document.createElement('div');
    overlay.className = 'nef-breach-result-overlay';
    overlay.innerHTML = `
        <div class="nef-breach-result-title" style="color:${color};">${title}</div>
        <div class="nef-breach-result-desc">${desc}</div>
        <button class="nef-breach-btn" onclick="window._nefBreachRerender()">↺ NOVO PUZZLE</button>
    `;
    // Torna o wrapper position:relative para o overlay funcionar
    wrapper.style.position = 'relative';
    wrapper.appendChild(overlay);
}

/** Renderiza o painel completo da aba "DECODIFICAR" */
function _renderBreachPanel(panelEl) {
    _renderBreachGame(panelEl);
}

// =========================================================
// 5. BOOTSTRAP — monta abas e inicializa subscriptions
// =========================================================

async function _bootstrap() {
    _injectStyles();
    _hookGlobalFeedFunctions();

    // Cria as abas (em ordem)
    _createTab('explorar',   '// EXPLORAR',   _renderExplorePanel);
    _createTab('decodificar','// DECODIFICAR', _renderBreachPanel);

    // Inicia subscription ao vivo mesmo antes do painel ser aberto,
    // para que o cache já esteja populado quando o usuário clicar.
    await _subscribeGlobalEvents();

    // Dispara evento para que outros módulos saibam que o NEF está pronto
    window.dispatchEvent(new Event('nef-ready'));
}

onDOMReady(() => {
    // Pequeno delay para garantir que sb (Supabase client) e demais
    // globais dos outros módulos já foram definidos.
    setTimeout(_bootstrap, 400);
});

})(); // IIFE — não polui o escopo global
