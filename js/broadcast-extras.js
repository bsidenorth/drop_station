// =========================================================
// dr0p_station — MÓDULO: broadcast-extras.js
// TRANSMISSÃO (OVNI), chat global, deep link de QR code e extras finais
//
// Parte 14 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================

const AIR_BROADCAST_COST = 500;

function openAirBroadcastModal() {
    if (!currentUser || !currentUser.loggedIn) {
        showCyberAlert('ACESSO NEGADO', 'Você precisa estar conectado pra enviar um broadcast aéreo.', 'error');
        return;
    }
    // Abre o painel de broadcast inline no chat, sem modal separado
    const existing = document.getElementById('inlineBroadcastPanel');
    if (existing) { existing.remove(); return; } // toggle: clicou de novo = fecha

    const panel = document.createElement('div');
    panel.id = 'inlineBroadcastPanel';
    panel.className = 'inline-broadcast-panel';
    panel.innerHTML = `
        <div class="ibp-header">
            <span class="ibp-title">📡 BROADCAST AÉREO // REDE INTEIRA</span>
            <button class="ibp-close" onclick="document.getElementById('inlineBroadcastPanel').remove()">✕</button>
        </div>
        <p class="ibp-desc">Sua mensagem sobrevoa TODAS as sessões ativas puxada por um OVNI.<br>Custo fixo: <b style="color:#00ff66;">500 B$</b> &nbsp;|&nbsp; Saldo: <b id="ibpBalance" style="color:#ffaa00;">${(currentUser.bumps||0).toLocaleString('pt-BR')} B$</b></p>
        <textarea id="ibpInput" class="ibp-textarea" maxlength="120" rows="2" placeholder="Escreva a mensagem que vai sobrevoar a rede..."></textarea>
        <div class="ibp-footer">
            <span class="ibp-counter"><span id="ibpCount">0</span>/120</span>
            <button class="ibp-send-btn" onclick="sendAirBroadcast()">⚡ ENVIAR // -500 B$</button>
        </div>
    `;
    panel.querySelector('#ibpInput').addEventListener('input', (e) => {
        const c = document.getElementById('ibpCount');
        if (c) c.textContent = e.target.value.length;
    });

    // Injeta logo acima do input do chat
    const chatInput = document.querySelector('#globalChatPanel .global-chat-input-row');
    if (chatInput) {
        chatInput.parentNode.insertBefore(panel, chatInput);
    } else {
        document.getElementById('globalChatPanel').appendChild(panel);
    }

    // Garante que o chat está aberto
    const chatPanel = document.getElementById('globalChatPanel');
    if (chatPanel && !chatPanel.classList.contains('open')) toggleGlobalChat();
}

function closeAirBroadcastModal() {
    const panel = document.getElementById('inlineBroadcastPanel');
    if (panel) panel.remove();
    // Compatibilidade com o modal legado (caso ainda exista no DOM)
    const modal = document.getElementById('airBroadcastModal');
    if (modal) modal.style.display = 'none';
}

async function sendAirBroadcast() {
    // Suporta tanto o painel inline quanto o modal legado
    const input = document.getElementById('ibpInput') || document.getElementById('airBroadcastInput');
    const text = input ? input.value.trim() : '';
    if (!text) { showCyberAlert('MENSAGEM VAZIA', 'Escreva algo pra rede ver no céu.', 'warn'); return; }
    if (text.length > 120) { showCyberAlert('MENSAGEM MUITO LONGA', 'Máximo de 120 caracteres.', 'warn'); return; }

    const newBalance = await debitBumpsAtomic(AIR_BROADCAST_COST);
    if (newBalance === null) return;

    try {
        const { error } = await sb.from('broadcasts_aereos').insert({
            id_usuario: currentUser.id,
            username: currentUser.username,
            mensagem: text
        });
        if (error) {
            console.error('sendAirBroadcast:', error.message);
            showCyberAlert('FALHA NA TRANSMISSÃO', 'O OVNI não decolou. Tente novamente.', 'error');
            return;
        }
    } catch (e) {
        console.error('sendAirBroadcast:', e);
        return;
    }

    closeAirBroadcastModal();
    showCyberAlert('BROADCAST ENVIADO', `Sua mensagem está sobrevoando a rede inteira agora.<br>Débito: <b style="color:#00ff66;">-${AIR_BROADCAST_COST} B$</b> &nbsp;|&nbsp; Saldo atual: <b>${currentUser.bumps} B$</b>`, 'success');
}

// Calcula, em milissegundos, quanto tempo depois do spawn a FRENTE do OVNI
// cruza a borda direita da viewport (ou seja, o instante em que ele
// realmente "entra na tela" pra quem está vendo).
//
// BUGFIX (voz dessincronizada do OVNI): a fala da Web Speech API antes
// disparava num `setTimeout` fixo de 1200ms, sem relação nenhuma com a
// posição real do OVNI — que varia a cada broadcast, porque a duração do
// voo é sorteada (28s–34s) E o ponto de entrada na tela depende da largura
// da viewport (telas largas "engolem" os 680px de offset inicial muito
// mais rápido que telas estreitas). O resultado era a voz tocando ora
// antes, ora bem depois do OVNI aparecer.
//
// Esta função espelha os MESMOS keyframes de `ufoFlyAcross` (CSS) — os
// pontos 0%/30%/70%/100% e seus deslocamentos em X — e interpola
// linearmente (mesmo timing-function "linear" usado na animação) pra achar
// em que fração da duração total o deslocamento X chega a -680px, que é
// exatamente o offset inicial de `right: -680px` em `.air-broadcast-unit`
// (ponto em que a borda direita do OVNI cruza x = largura da viewport).
function computeUfoEntryDelayMs(durationSeconds) {
    const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    const ENTRY_OFFSET_PX = 680; // mesmo valor do `right: -680px` no CSS

    // Pontos de controle de translateX (eixo horizontal) usados em
    // @keyframes ufoFlyAcross — precisam ficar em sincronia se o CSS mudar.
    const stops = [
        { t: 0.00, x: 0 },
        { t: 0.30, x: -0.40 * vw },
        { t: 0.70, x: -0.75 * vw },
        { t: 1.00, x: -(vw + 750) }
    ];

    let entryT = stops[stops.length - 1].t; // fallback de segurança
    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i], b = stops[i + 1];
        if (a.x >= -ENTRY_OFFSET_PX && b.x <= -ENTRY_OFFSET_PX) {
            const frac = (a.x - (-ENTRY_OFFSET_PX)) / (a.x - b.x);
            entryT = a.t + (b.t - a.t) * frac;
            break;
        }
    }
    return Math.max(0, entryT * durationSeconds * 1000);
}

// Cria e anima um OVNI puxando a faixa de texto na tela. Suporta múltiplos
// broadcasts simultâneos (cada um numa altura/duração levemente diferente,
// pra não sobrepor perfeitamente se dois chegarem perto um do outro).
function spawnAirBroadcast(username, mensagem) {
    const layer = document.getElementById('airBroadcastLayer');
    if (!layer) return;

    // topPct/duration calculados ANTES dos efeitos sonoros, porque a
    // sincronização da voz (abaixo) depende da duração real do voo deste
    // OVNI específico.
    const topPct = 10 + Math.random() * 50; // 10%–60% da altura da tela
    // Duração maior: 28s–34s para usuário ler confortavelmente
    const duration = 28 + Math.random() * 6;
    const ufoEntryDelayMs = computeUfoEntryDelayMs(duration);

    // 1) Efeito sonoro de Sirene Cyberpunk ao entrar no broadcast
    try {
        if (typeof initAudio === 'function') initAudio();
        if (typeof audioCtx !== 'undefined' && audioCtx) {
            const now = audioCtx.currentTime;
            // Sirene zig-zag: dois tons alternando 4x
            [[0,1400],[0.18,700],[0.36,1400],[0.54,700],[0.72,1400],[0.90,700],[1.08,400]].forEach(([t, hz]) => {
                const o = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                o.type = 'sawtooth'; o.frequency.setValueAtTime(hz, now + t);
                g.gain.setValueAtTime(0.22, now + t);
                g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.17);
                o.connect(g); g.connect(audioCtx.destination);
                o.start(now + t); o.stop(now + t + 0.17);
            });
        }
    } catch(e) {}

    // 2) Leitura da mensagem via Web Speech API (voz sintetizada) — agora
    // disparada exatamente no milissegundo (ufoEntryDelayMs) em que a
    // FRENTE do OVNI cruza a borda direita da tela, calculado acima a
    // partir da mesma curva de animação usada no CSS.
    try {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            setTimeout(() => {
                const u = new SpeechSynthesisUtterance(`Broadcast aéreo de ${username}: ${mensagem}`);
                u.lang = 'pt-BR'; u.rate = 0.92; u.pitch = 0.85;
                window.speechSynthesis.speak(u);
            }, ufoEntryDelayMs);
        }
    } catch(e) {}

    const unit = document.createElement('div');
    unit.className = 'air-broadcast-unit';
    unit.style.setProperty('--ufo-top', topPct + '%');
    unit.style.setProperty('--ufo-duration', duration + 's');

    // OVNI na FRENTE (esquerda), faixa atrás (direita) — puxando na direção do movimento
    unit.innerHTML = `
        <div class="ufo-craft">
            <div class="ufo-dome"></div>
            <div class="ufo-body"></div>
            <div class="ufo-lights"><span></span><span></span><span></span><span></span><span></span></div>
            <div class="ufo-beam"></div>
        </div>
        <div class="ufo-banner-rope"></div>
        <div class="ufo-banner">
            <span class="ufo-banner-text"></span>
            <span class="ufo-banner-author"></span>
        </div>
    `;
    // Texto inserido via textContent (não innerHTML) pra mensagem do
    // usuário nunca ser interpretada como HTML/script — mesma cautela de
    // sanitização usada no resto do app pra conteúdo gerado por usuário.
    unit.querySelector('.ufo-banner-text').textContent = mensagem;
    unit.querySelector('.ufo-banner-author').textContent = `// ${username}`;

    layer.appendChild(unit);
    unit.addEventListener('animationend', () => unit.remove());
    // Failsafe: remove mesmo se o evento de animação não disparar por
    // algum motivo (ex: aba em background pausando rAF/animations).
    setTimeout(() => { if (unit.parentNode) unit.remove(); }, (duration + 2) * 1000);
}

/* ─────────────────────────────────────────────────────────────────────
   CHAT GLOBAL FLUTUANTE
   ───────────────────────────────────────────────────────────────────── */
const GLOBAL_CHAT_COST = 15;
let globalChatCache = [];
let globalChatOpen = false;
let globalChatUnread = 0;

function toggleGlobalChat() {
    const panel = document.getElementById('globalChatPanel');
    if (!panel) return;
    globalChatOpen = !globalChatOpen;
    panel.classList.toggle('open', globalChatOpen);
    if (globalChatOpen) {
        globalChatUnread = 0;
        updateGlobalChatBadge();
        renderGlobalChatMessages();
        const input = document.getElementById('globalChatInput');
        if (input) input.focus();
    }
}

function updateGlobalChatBadge() {
    const badge = document.getElementById('globalChatBadge');
    if (!badge) return;
    if (globalChatUnread > 0) {
        badge.style.display = 'flex';
        badge.innerText = globalChatUnread > 99 ? '99+' : String(globalChatUnread);
    } else {
        badge.style.display = 'none';
    }
}

function escapeHtmlForChat(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function renderGlobalChatMessages() {
    const box = document.getElementById('globalChatMessages');
    if (!box) return;
    if (globalChatCache.length === 0) {
        box.innerHTML = '<div class="global-chat-empty">Nenhuma mensagem ainda. Seja o primeiro a falar com a rede.</div>';
        return;
    }
    box.innerHTML = globalChatCache.map(m => {
        const isOwn = currentUser && currentUser.loggedIn && m.username === currentUser.username;
        const isBroadcast = m.is_broadcast === true; // mensagens de broadcast têm neon glow
        const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        // Renderiza cosméticos equipados do remetente (moldura, avatar, emoticon)
        const cos = (m.cosmetics && typeof m.cosmetics === 'object') ? m.cosmetics : {};
        const avatarSrc = cos.avatar || '';
        const frameClass = cos.frame ? `frame-chat-${cos.frame.replace(/[^a-z0-9_-]/gi,'_')}` : '';
        const emoticon = cos.emoticon ? `<span class="gc-emoticon" title="Emoticon equipado">${escapeHtmlForChat(cos.emoticon)}</span>` : '';
        const avatarHtml = avatarSrc
            ? `<span class="gc-avatar-wrap ${frameClass}"><img class="gc-avatar-img" src="${escapeHtmlForChat(avatarSrc)}" alt=""></span>`
            : `<span class="gc-avatar-wrap gc-avatar-placeholder">${escapeHtmlForChat(m.username.charAt(0).toUpperCase())}</span>`;

        return `<div class="gc-msg${isOwn ? ' gc-own' : ''}">
            ${avatarHtml}
            <div class="gc-msg-body">
                <span class="gc-user gc-user-link${isBroadcast ? ' gc-user-broadcast-glow' : ''}" onclick="toggleGlobalChat(); viewExternalProfile('${escapeHtmlForChat(m.username).replace(/'/g, "\\'")}')" title="Ver perfil de ${escapeHtmlForChat(m.username)}">${escapeHtmlForChat(m.username)}${isBroadcast ? ' 📡' : ''}</span>${emoticon}
                <span class="gc-text">${escapeHtmlForChat(m.mensagem)}</span>
            </div>
            <span class="gc-time">${time}</span>
        </div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
}

async function fetchAndSeedGlobalChat() {
    // ANTI-EGRESS: colunas explícitas. Nota: is_broadcast NÃO existe na
    // tabela chat_global (ver schema.sql) — pedir essa coluna no select
    // causaria erro 400 do PostgREST ("column does not exist"), o que
    // quebraria o carregamento do chat inteiro. m.is_broadcast no render
    // continua undefined/falsy como já era (o glow de broadcast nunca
    // chegou a funcionar porque a coluna nunca existiu; se quiserem esse
    // recurso de fato, é preciso adicionar a coluna no schema primeiro).
    const { data, error } = await sb.from('chat_global')
        .select('id, username, mensagem, cosmetics, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) { console.error('fetchAndSeedGlobalChat:', error.message); return; }
    globalChatCache = data.reverse();
    renderGlobalChatMessages();
}

async function sendGlobalChatMessage() {
    const input = document.getElementById('globalChatInput');
    const text = input ? input.value.trim() : '';
    if (!text) return;
    if (text.length > 280) { showCyberAlert('MENSAGEM MUITO LONGA', 'Máximo de 280 caracteres.', 'warn'); return; }

    if (!currentUser || !currentUser.loggedIn) {
        showCyberAlert('ACESSO NEGADO', 'Você precisa estar conectado pra usar o chat global.', 'error');
        return;
    }

    const sendBtn = document.getElementById('globalChatSendBtn');
    if (sendBtn) sendBtn.disabled = true;

    const newBalance = await debitBumpsAtomic(GLOBAL_CHAT_COST);
    if (newBalance === null) { if (sendBtn) sendBtn.disabled = false; return; }

    try {
        // Inclui cosméticos equipados para renderização no feed de todos
        const chatCosmetics = {
            emoticon: currentUser.equippedCosmetics ? (currentUser.equippedCosmetics.emoticon || null) : null,
            frame: currentUser.avatar_frame || null,
            avatar: currentUser.avatar || null
        };
        const { error } = await sb.from('chat_global').insert({
            id_usuario: currentUser.id,
            username: currentUser.username,
            mensagem: text,
            cosmetics: chatCosmetics
        });
        if (error) {
            console.error('sendGlobalChatMessage:', error.message);
            showCyberAlert('FALHA NO ENVIO', 'Mensagem não chegou à rede. Tente novamente.', 'error');
        } else {
            input.value = '';
        }
    } catch (e) {
        console.error('sendGlobalChatMessage:', e);
    } finally {
        if (sendBtn) sendBtn.disabled = false;
    }
}

/* ─────────────────────────────────────────────────────────────────────
   REALTIME — assina os dois canais incondicionalmente no boot (logado
   ou não), igual initGlobalRealtime() já faz pra eventos_globais/cards.
   ───────────────────────────────────────────────────────────────────── */
let _airChatRealtimeStarted = false;
function initAirBroadcastAndChatRealtime() {
    if (_airChatRealtimeStarted) return;
    _airChatRealtimeStarted = true;

    fetchAndSeedGlobalChat();

    sb.channel('broadcasts_aereos_live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcasts_aereos' }, (payload) => {
            const row = payload.new;
            spawnAirBroadcast(row.username, row.mensagem);
        })
        .subscribe();

    sb.channel('chat_global_live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_global' }, (payload) => {
            const row = payload.new;
            globalChatCache.push(row);
            if (globalChatCache.length > 50) globalChatCache.shift();
            if (globalChatOpen) {
                renderGlobalChatMessages();
            } else {
                const isOwn = currentUser && currentUser.loggedIn && row.username === currentUser.username;
                if (!isOwn) { globalChatUnread++; updateGlobalChatBadge(); }
            }
        })
        .subscribe();
}

// Dispara junto com o resto da inicialização Realtime global. Roda
// incondicionalmente — inclusive em aba anônima, já que a leitura de
// ambas as tabelas é pública via RLS (escrita continua exigindo login).
// ═══════════════════════════════════════════════════════════════
// [ESCOPO 4] EMOTE PANEL — Chat Global
// ═══════════════════════════════════════════════════════════════
function toggleGlobalChatEmotePanel() {
    const panel = document.getElementById('globalChatEmotePanel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' || !panel.style.display ? 'flex' : 'none';
}

function insertGlobalChatEmote(emote) {
    const input = document.getElementById('globalChatInput');
    if (!input) return;
    const pos = input.selectionStart || input.value.length;
    input.value = input.value.slice(0, pos) + emote + input.value.slice(pos);
    input.focus();
    input.selectionStart = input.selectionEnd = pos + emote.length;
    // Fecha o painel após inserir
    const panel = document.getElementById('globalChatEmotePanel');
    if (panel) panel.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════
// [ESCOPO 3] WALLET DASHBOARD — Painel financeiro com gráfico
// ═══════════════════════════════════════════════════════════════
let _walletChartInstance = null;

function openWalletDashboard() {
    if (!currentUser.loggedIn) {
        showCyberAlert('ACESSO NEGADO', 'Faça login para acessar a Carteira.', 'error');
        return;
    }
    const modal = document.getElementById('walletDashboardModal');
    if (!modal) return;
    modal.style.display = 'flex';

    // Atualiza saldo
    const balanceEl = document.getElementById('walletBalanceDisplay');
    if (balanceEl) balanceEl.innerText = `${currentUser.bumps} B$`;

    // Atualiza badge
    const walletBadge = document.getElementById('wallet-balance-badge');
    if (walletBadge) walletBadge.innerText = `${currentUser.bumps} B$`;

    // Preenche stats (baseado em ledgerCache)
    _renderWalletStats();
    drawWalletChart();
    _renderWalletHistory();
}

function closeWalletDashboard() {
    const modal = document.getElementById('walletDashboardModal');
    if (modal) modal.style.display = 'none';
}

function _renderWalletStats() {
    // Analisa ledger dos últimos 7 dias para ganhos/gastos do usuário
    const now = Date.now();
    const cutoff7d = now - 7 * 24 * 3600 * 1000;
    const me = currentUser.username;
    let gain7d = 0, spend7d = 0, tradesTotal = 0, topSale = 0;

    ledgerCache.forEach(entry => {
        if (!entry || !entry.text) return;
        const t = entry.text;
        if (!t.includes(me)) return;
        const bumpsMatch = t.match(/(\d+)\s*B\$/);
        const val = bumpsMatch ? parseInt(bumpsMatch[1]) : 0;
        if (t.includes('comprou') && t.includes(me + ' comprou')) { spend7d += val; tradesTotal++; }
        if (t.includes('vendeu') && !t.includes(me + ' comprou')) { gain7d += val; tradesTotal++; if (val > topSale) topSale = val; }
        if (t.includes('presenteou') && t.includes(me)) { tradesTotal++; }
    });

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setEl('walletGain7d', `+${gain7d} B$`);
    setEl('walletSpend7d', `-${spend7d} B$`);
    setEl('walletTradesTotal', tradesTotal);
    setEl('walletTopSale', `${topSale} B$`);
}

function drawWalletChart() {
    const canvas = document.getElementById('walletChartCanvas');
    if (!canvas) return;
    const ctx2 = canvas.getContext('2d');
    const W = canvas.offsetWidth || 580;
    const H = 140;
    canvas.width = W; canvas.height = H;

    // Gera dados fictícios de fluxo dos últimos 30 dias baseados no saldo atual
    const DAYS = 30;
    const points = [];
    let running = Math.max(0, currentUser.bumps - Math.floor(Math.random() * 200));
    for (let i = 0; i < DAYS; i++) {
        const delta = (Math.random() - 0.45) * 30;
        running = Math.max(0, running + delta);
        points.push(Math.round(running));
    }
    points[DAYS - 1] = currentUser.bumps;

    const min = Math.min(...points);
    const max = Math.max(...points, min + 1);
    const norm = v => H - 10 - ((v - min) / (max - min)) * (H - 20);
    const xStep = W / (DAYS - 1);

    ctx2.clearRect(0, 0, W, H);

    // Grid lines
    ctx2.strokeStyle = '#1a1a2e';
    ctx2.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = 10 + (i / 4) * (H - 20);
        ctx2.beginPath(); ctx2.moveTo(0, y); ctx2.lineTo(W, y); ctx2.stroke();
    }

    // Area gradient
    const grad = ctx2.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(0,255,102,0.25)');
    grad.addColorStop(1, 'rgba(0,255,102,0)');
    ctx2.beginPath();
    ctx2.moveTo(0, norm(points[0]));
    points.forEach((v, i) => ctx2.lineTo(i * xStep, norm(v)));
    ctx2.lineTo(W, H); ctx2.lineTo(0, H);
    ctx2.closePath();
    ctx2.fillStyle = grad;
    ctx2.fill();

    // Line
    ctx2.beginPath();
    ctx2.strokeStyle = '#00ff66';
    ctx2.lineWidth = 2;
    ctx2.shadowBlur = 8; ctx2.shadowColor = '#00ff6688';
    points.forEach((v, i) => i === 0 ? ctx2.moveTo(0, norm(v)) : ctx2.lineTo(i * xStep, norm(v)));
    ctx2.stroke();
    ctx2.shadowBlur = 0;

    // Current point
    const lastY = norm(points[DAYS - 1]);
    ctx2.beginPath();
    ctx2.arc(W - 1, lastY, 5, 0, Math.PI * 2);
    ctx2.fillStyle = '#00ff66';
    ctx2.shadowBlur = 12; ctx2.shadowColor = '#00ff66';
    ctx2.fill();
    ctx2.shadowBlur = 0;
}

function _renderWalletHistory() {
    const list = document.getElementById('walletHistoryList');
    if (!list) return;
    const me = currentUser.username;
    const myEntries = ledgerCache.filter(e => e && e.text && e.text.includes(me)).slice(0, 8);
    if (myEntries.length === 0) {
        list.innerHTML = '<div style="font-size:0.6rem;color:#444;padding:8px 0;">Nenhuma transação registrada ainda.</div>';
        return;
    }
    list.innerHTML = myEntries.map(e => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1a1a2e;font-size:0.58rem;">
            <span style="color:#888899;">[${e.ts}]</span>
            <span style="color:#ccc;flex:1;margin:0 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.text}</span>
        </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// [ESCOPO 3] Profile: Transferir Bumps em perfil de terceiros
// ═══════════════════════════════════════════════════════════════
function openTransferBumpsModal(targetUsername) {
    const amount = prompt(`Quantos B$ deseja transferir para ${targetUsername}?`, '');
    if (!amount) return;
    const parsed = parseInt(amount);
    if (isNaN(parsed) || parsed <= 0) { showCyberAlert('ERRO', 'Valor inválido.', 'error'); return; }
    if (parsed > currentUser.bumps) { showCyberAlert('SALDO INSUFICIENTE', `Seu saldo: ${currentUser.bumps} B$`, 'warn'); return; }
    _executeTransferBumps(targetUsername, parsed);
}

async function _executeTransferBumps(targetUsername, amount) {
    if (!amount || amount <= 0) { showCyberAlert('ERRO', 'Valor de transferência inválido.', 'error'); return; }
    if (amount > currentUser.bumps) { showCyberAlert('SALDO_INSUFICIENTE', 'Você não possui Bumps suficientes para esta transferência.', 'error'); return; }

    const targetProfile = await fetchProfileByUsername(targetUsername);
    if (!targetProfile) { showCyberAlert('ERRO', 'Usuário não encontrado.', 'error'); return; }
    if (targetProfile.id === currentUser.id) { showCyberAlert('OPERAÇÃO INVÁLIDA', 'Não é possível transferir Bumps para si mesmo.', 'error'); return; }

    // [ESCOPO 7] BUGFIX DE SEGURANÇA: a versão anterior fazia DOIS updates
    // sequenciais direto do cliente (debitar o remetente, depois creditar o
    // destinatário) sem nenhuma transação — se a rede caísse entre os dois
    // updates, o valor era debitado e NUNCA creditado (Bumps somem do
    // ecossistema), e nada impedia uma corrida de cliques duplicados de
    // deixar o saldo negativo. Substituído por uma única chamada atômica à
    // RPC transferir_bumps (security definer), que faz tudo numa transação
    // só no servidor e já grava o ledger de ambos os lados.
    const { data: novoSaldoRemetente, error } = await sb.rpc('transferir_bumps', {
        p_remetente_id: currentUser.id,
        p_destinatario_id: targetProfile.id,
        p_valor: amount
    });

    if (error) {
        console.error('transferir_bumps:', error.message);
        const msg = error.message.includes('saldo insuficiente')
            ? 'Saldo insuficiente para concluir a transferência.'
            : 'Falha ao processar a transferência. Tente novamente.';
        showCyberAlert('ERRO_DE_REDE', msg, 'error');
        return;
    }

    currentUser.bumps = novoSaldoRemetente;
    const profBumpsEl = document.getElementById('profBumps');
    if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
    const walletBadge = document.getElementById('wallet-balance-badge');
    if (walletBadge) walletBadge.innerText = `${currentUser.bumps} B$`;

    pushLedger(`${currentUser.username} transferiu ${amount} B$ para ${targetUsername}`);
    playSynthSound('success');
    showCyberAlert('✓ TRANSFERÊNCIA CONCLUÍDA', `<b>${amount} B$</b> enviados para <b>${targetUsername}</b>.<br>Saldo atual: <b>${currentUser.bumps} B$</b>`, 'success');
}

// ═══════════════════════════════════════════════════════════════
// [ESCOPO 2] LOJA — setLojaTab (aba/filtro dinâmico)
// ═══════════════════════════════════════════════════════════════
let _currentLojaTab = 'all';

function setLojaTab(tab) {
    _currentLojaTab = tab;
    document.querySelectorAll('.loja-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    renderLoja(false);
}

// ═══════════════════════════════════════════════════════════════
// [VAULT] Arena de Apostas — toggle + modo
// ═══════════════════════════════════════════════════════════════
let _arenaMode = 'menu';

function toggleArenaPanel() {
    const panel = document.getElementById('arenaApostasPanel');
    if (!panel) return;
    if (panel.style.display === 'none' || !panel.style.display) {
        if (!currentUser.loggedIn) {
            showCyberAlert('ACESSO NEGADO', 'Precisas de estar logado para aceder à Arena.', 'error');
            return;
        }
        panel.style.display = 'block';
        setArenaMode('menu');
    } else {
        panel.style.display = 'none';
    }
}

function setArenaMode(mode) {
    _arenaMode = mode;
    const menuView = document.getElementById('arenaMenuView');
    const dueloView = document.getElementById('arenaDueloView');
    const roletaView = document.getElementById('arenaRoletaView');
    if (menuView)  menuView.style.display  = mode === 'menu'   ? 'block' : 'none';
    if (dueloView) dueloView.style.display = mode === 'duelo'  ? 'block' : 'none';
    if (roletaView) roletaView.style.display = mode === 'roleta' ? 'block' : 'none';
}


// ═══════════════════════════════════════════════════════════════
// [ESCOPO 2] LOJA TAB FILTER — filtra as seções visíveis conforme aba ativa
// As seções da loja têm h3/h2 com data-loja-cat preenchidos por lojaBuildMarkup.
// Como a loja usa classes internas (lojaSwitchTab já existe), este helper
// mapeia as abas externas (lojaTabBar) para as internas da loja, ou oculta
// seções irrelevantes diretamente no DOM após o innerHTML ser preenchido.
// ═══════════════════════════════════════════════════════════════
function _applyLojaTabFilter(tab) {
    const lojaCatMap = {
        'all':       null, // mostra tudo via lojaSwitchTab default
        'molduras':  'cosmeticos', // internamente molduras estão em cosméticos
        'estantes':  'cosmeticos',
        'temas':     'cosmeticos',
        'cosmeticos':'cosmeticos',
        'emotes':    'emoticons',
    };

    if (typeof lojaSwitchTab === 'function') {
        const internalTab = lojaCatMap[tab];
        if (tab === 'all') {
            lojaSwitchTab('cosmeticos');
        } else if (internalTab) {
            lojaSwitchTab(internalTab);
        }
    }

    // Filtragem extra por categoria de itens dentro do grid
    const lojaGrid = document.getElementById(LOJA_TARGET_ID);
    if (!lojaGrid || tab === 'all') return;

    // Marca as seções de categorias para mostrar/ocultar
    const CAT_FILTER_MAP = {
        'molduras':  ['moldura'],
        'estantes':  ['estante'],
        'temas':     ['fundo'],
        'cosmeticos':['adereco','emoticon'],
        'emotes':    ['emoticon'],
    };

    const allowedCats = CAT_FILTER_MAP[tab];
    if (!allowedCats) return;

    // Tenta ocultar seções com data-loja-section-cat se existirem
    lojaGrid.querySelectorAll('[data-loja-section-cat]').forEach(section => {
        const scat = section.dataset.lojaSectionCat;
        section.style.display = allowedCats.includes(scat) ? '' : 'none';
    });
}


initAirBroadcastAndChatRealtime();


// ═══════════════════════════════════════════════════════════════
// DEEP LINK via QR CODE — abre o modal de inspect diretamente
// quando a URL contém ?card=ID&hash=HASH (gerado pelo QR do card)
// ═══════════════════════════════════════════════════════════════
(function handleQrDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const cardId = params.get('card');
    const cardHash = params.get('hash');
    if (!cardId) return;

    // Aguarda o app inicializar (Supabase + feed carregado) antes de abrir o modal
    function tryOpenCard(attempts) {
        if (attempts <= 0) return;

        // Tenta encontrar o card em todas as fontes disponíveis
        const allCards = [
            ...(typeof globalFeed !== 'undefined' ? globalFeed : []),
            ...(typeof marketAssets !== 'undefined' ? marketAssets : []),
            ...(typeof savedAssets !== 'undefined' ? savedAssets : [])
        ];

        const decoded = decodeURIComponent(cardId);
        const found = allCards.find(c =>
            String(c.id) === decoded ||
            (c.qr_code_hash && c.qr_code_hash === decodeURIComponent(cardHash || ''))
        );

        if (found) {
            openInspectModal(found);
            // Limpa o parâmetro da URL sem recarregar a página
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, '', cleanUrl);
        } else {
            setTimeout(() => tryOpenCard(attempts - 1), 800);
        }
    }

    // Espera 1.5s para o feed carregar do Supabase, depois tenta por até 8s
    setTimeout(() => tryOpenCard(10), 1500);
})();
