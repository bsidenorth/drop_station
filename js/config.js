// =========================================================
// dr0p_station — MÓDULO: config.js
// CONFIG — constantes, catálogos (ITEMS_DB, LOJA_*), mapeamentos de colunas DB
//
// Parte 1 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================

// =========================================================
// dr0p_station — PARTE 1/4: AUTH (SUPABASE)
// SUBSTITUI no script.js original:
//   - bloco "PERSISTÊNCIA DA SESSÃO ATIVA" (saveCurrentSession / restoreCurrentSession)
//   - bloco "REGISTRY CENTRALIZADO DE UTILIZADORES" (REGISTRY_KEY, SEED_USERS,
//     loadRegistry, saveRegistry, registryGet, registrySet, initRegistry IIFE)
//   - função handleAuthSubmit
//   - função logoutSession
// MANTÉM como está: switchAuthMode, sanitizeInput, validateUsername,
//   RESERVED_USERNAMES, navigateTo, handleProfileNavClick
// SUBSTITUI TAMBÉM: validatePassword (regras de força mais rígidas)
// =========================================================

const sb = window.supabaseClient;

// =========================================================
// MOVIMENTO CONTÍNUO — estilos das variantes de filtro de movimento
// (random-glitch / vortex-wave) usadas pelo botão "GIF" da fusão.
// Injetado uma única vez aqui para que a classe .card-motion-active
// funcione em qualquer card (Inventário, Vitrine, Modal de Inspect)
// sem depender de alterações no arquivo de estilos estático.
// =========================================================
(function injectMotionFilterStyles() {
    if (document.getElementById('motionFilterStyles')) return;
    const styleTag = document.createElement('style');
    styleTag.id = 'motionFilterStyles';
    styleTag.textContent = `
        /* ── LOJA SCREEN ─────────────────────────────────────── */
        .loja-items-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 14px;
        }
        .loja-item-card {
            background: #07070f; border: 1px solid #1c1c28;
            padding: 14px; display: flex; flex-direction: column; gap: 8px;
            transition: border-color 0.2s;
        }
        .loja-item-card:hover { border-color: #ffaa00; }
        .loja-item-icon { font-size: 1.8rem; text-align: center; }
        .loja-item-name { font-size: 0.65rem; font-weight: bold; color: #ffaa00; letter-spacing: 1px; }
        .loja-item-desc { font-size: 0.55rem; color: #888899; }
        .loja-item-price { font-size: 0.7rem; color: #00ffff; font-weight: bold; }
        .loja-item-buy { margin-top: 4px; background: transparent; border: 1px solid #ffaa00;
            color: #ffaa00; font-family: 'Space Mono', monospace; font-size: 0.55rem;
            padding: 6px 10px; cursor: pointer; letter-spacing: 1px;
            transition: background 0.15s, color 0.15s; }
        .loja-item-buy:hover { background: #ffaa00; color: #000; }
        .loja-empty-notice { color: #444; font-size: 0.6rem; padding: 24px 0; text-align: center; grid-column: 1/-1; }

        /* ── CARD MOTION: 12 variantes GIF ─────────────────── */
        .card-motion-active { position: relative; overflow: hidden; }
        .card-motion-active[data-motion-filter="random-glitch"] { animation: motionRandomGlitch 2.4s steps(8) infinite; }
        .card-motion-active[data-motion-filter="vortex-wave"]   { animation: motionVortexWave 3.2s ease-in-out infinite; }
        .card-motion-active[data-motion-filter="chromatic-pulse"]{ animation: motionChromaticPulse 1.8s ease-in-out infinite; }
        .card-motion-active[data-motion-filter="scanline-drift"] { animation: motionScanlineDrift 2.6s linear infinite; }
        .card-motion-active[data-motion-filter="neon-flicker"]   { animation: motionNeonFlicker 0.9s steps(3) infinite; }
        .card-motion-active[data-motion-filter="heat-shimmer"]   { animation: motionHeatShimmer 2.0s ease-in-out infinite; }
        .card-motion-active[data-motion-filter="rgb-split"]      { animation: motionRgbSplit 1.6s steps(5) infinite; }
        .card-motion-active[data-motion-filter="static-burst"]   { animation: motionStaticBurst 0.5s steps(2) infinite; }
        .card-motion-active[data-motion-filter="deep-pulse"]     { animation: motionDeepPulse 4.0s ease-in-out infinite; }
        .card-motion-active[data-motion-filter="corruption"]     { animation: motionCorruption 1.2s steps(6) infinite; }
        .card-motion-active[data-motion-filter="hologram"]       { animation: motionHologram 2.8s ease-in-out infinite; }
        .card-motion-active[data-motion-filter="plasma-burn"]    { animation: motionPlasmaBurn 3.5s ease-in-out infinite; }

        @keyframes motionRandomGlitch {
            0%,100% { filter: hue-rotate(0deg) saturate(100%); transform: translate(0,0); }
            20% { filter: hue-rotate(40deg) saturate(180%); transform: translate(-1px,1px); }
            40% { filter: hue-rotate(-30deg) saturate(140%); transform: translate(1px,-1px); }
            60% { filter: hue-rotate(60deg) saturate(200%); transform: translate(-1px,0); }
            80% { filter: hue-rotate(-15deg) saturate(160%); transform: translate(1px,1px); }
        }
        @keyframes motionVortexWave {
            0%,100% { filter: hue-rotate(0deg) brightness(100%); transform: rotate(0deg) scale(1); }
            50% { filter: hue-rotate(180deg) brightness(115%); transform: rotate(1.5deg) scale(1.015); }
        }
        @keyframes motionChromaticPulse {
            0%,100% { filter: saturate(100%) contrast(100%); }
            25% { filter: saturate(280%) contrast(140%) hue-rotate(20deg); }
            50% { filter: saturate(180%) contrast(110%) hue-rotate(90deg); }
            75% { filter: saturate(320%) contrast(160%) hue-rotate(200deg); }
        }
        @keyframes motionScanlineDrift {
            0%   { filter: brightness(105%) contrast(110%); transform: translateY(0); }
            25%  { filter: brightness(95%) contrast(125%) hue-rotate(10deg); transform: translateY(-1px); }
            50%  { filter: brightness(110%) contrast(105%); transform: translateY(1px); }
            75%  { filter: brightness(90%) contrast(130%) hue-rotate(-10deg); transform: translateY(-1px); }
            100% { filter: brightness(105%) contrast(110%); transform: translateY(0); }
        }
        @keyframes motionNeonFlicker {
            0%,100% { filter: brightness(100%) saturate(200%); opacity: 1; }
            33%     { filter: brightness(160%) saturate(300%) hue-rotate(30deg); opacity: 0.88; }
            66%     { filter: brightness(80%) saturate(150%) hue-rotate(-20deg); opacity: 0.95; }
        }
        @keyframes motionHeatShimmer {
            0%,100% { filter: blur(0px) brightness(100%) saturate(120%); transform: scaleY(1); }
            30%     { filter: blur(0.4px) brightness(108%) saturate(140%); transform: scaleY(1.005); }
            60%     { filter: blur(0.2px) brightness(95%) saturate(130%); transform: scaleY(0.997); }
        }
        @keyframes motionRgbSplit {
            0%,100% { filter: hue-rotate(0deg) saturate(150%); transform: translate(0,0); }
            20% { filter: hue-rotate(120deg) saturate(200%); transform: translate(2px,0); }
            40% { filter: hue-rotate(240deg) saturate(180%); transform: translate(-2px,0); }
            60% { filter: hue-rotate(60deg) saturate(220%); transform: translate(0,1px); }
            80% { filter: hue-rotate(300deg) saturate(170%); transform: translate(0,-1px); }
        }
        @keyframes motionStaticBurst {
            0%,100% { filter: contrast(100%) brightness(100%); }
            50%     { filter: contrast(200%) brightness(90%) saturate(50%) hue-rotate(180deg); }
        }
        @keyframes motionDeepPulse {
            0%,100% { filter: brightness(100%) saturate(100%); transform: scale(1); }
            50%     { filter: brightness(120%) saturate(160%) hue-rotate(15deg); transform: scale(1.008); }
        }
        @keyframes motionCorruption {
            0%,100% { filter: hue-rotate(0deg) contrast(100%); transform: translate(0,0) skewX(0deg); }
            16% { filter: hue-rotate(90deg) contrast(150%); transform: translate(-2px,1px) skewX(1deg); }
            33% { filter: hue-rotate(180deg) contrast(120%); transform: translate(2px,-1px) skewX(-0.5deg); }
            50% { filter: hue-rotate(270deg) contrast(160%); transform: translate(-1px,2px) skewX(0.8deg); }
            66% { filter: hue-rotate(45deg) contrast(110%); transform: translate(1px,-2px) skewX(-1deg); }
            83% { filter: hue-rotate(315deg) contrast(140%); transform: translate(-1px,0) skewX(0.3deg); }
        }
        @keyframes motionHologram {
            0%,100% { filter: hue-rotate(180deg) brightness(110%) saturate(150%); opacity: 0.95; }
            25%     { filter: hue-rotate(200deg) brightness(130%) saturate(200%); opacity: 0.82; }
            50%     { filter: hue-rotate(160deg) brightness(100%) saturate(130%); opacity: 1; }
            75%     { filter: hue-rotate(210deg) brightness(120%) saturate(170%); opacity: 0.88; }
        }
        @keyframes motionPlasmaBurn {
            0%,100% { filter: hue-rotate(0deg) saturate(180%) brightness(100%); }
            20% { filter: hue-rotate(30deg) saturate(250%) brightness(115%); }
            40% { filter: hue-rotate(-20deg) saturate(200%) brightness(105%); }
            60% { filter: hue-rotate(50deg) saturate(300%) brightness(120%); }
            80% { filter: hue-rotate(-10deg) saturate(220%) brightness(110%); }
        }
    `;
    document.head.appendChild(styleTag);
})();

// =========================================================
// ESTILOS VISUAIS DE DROP — pool expandido (5 originais + 15 novos = 20)
// rarities: lista de raridades em que cada estilo pode aparecer
// filter: CSS filter seguro — brightness entre 87-100%, saturate >=180%
// =========================================================
const DROP_VISUAL_STYLES = [
    // ── ORIGINAIS ────────────────────────────────────────────
    { id:'neon_surge',     namePT:'NEON_SURGE',     nameEN:'NEON_SURGE',
      filter:'hue-rotate(200deg) saturate(320%) contrast(130%) brightness(95%)',
      rarities:['common','epic','legendary','ancestral'] },
    { id:'acid_wash',      namePT:'ACID_WASH',      nameEN:'ACID_WASH',
      filter:'hue-rotate(80deg) saturate(260%) contrast(120%) brightness(90%)',
      rarities:['common','epic','legendary'] },
    { id:'magenta_ghost',  namePT:'MAGENTA_GHOST',  nameEN:'MAGENTA_GHOST',
      filter:'hue-rotate(300deg) saturate(280%) contrast(115%) brightness(92%)',
      rarities:['epic','legendary','ancestral'] },
    { id:'rust_corrupted', namePT:'RUST_CORRUPTED', nameEN:'RUST_CORRUPTED',
      filter:'hue-rotate(20deg) saturate(240%) contrast(140%) brightness(88%)',
      rarities:['common','epic'] },
    { id:'void_signal',    namePT:'VOID_SIGNAL',    nameEN:'VOID_SIGNAL',
      filter:'hue-rotate(240deg) saturate(180%) contrast(160%) brightness(87%)',
      rarities:['epic','legendary','ancestral'] },
    // ── NOVOS 1-15 ───────────────────────────────────────────
    { id:'infrared_leak',  namePT:'INFRARED_LEAK',  nameEN:'INFRARED_LEAK',
      filter:'hue-rotate(350deg) saturate(300%) contrast(125%) brightness(93%)',
      rarities:['common','epic','legendary'] },
    { id:'cobalt_strike',  namePT:'COBALT_STRIKE',  nameEN:'COBALT_STRIKE',
      filter:'hue-rotate(215deg) saturate(350%) contrast(120%) brightness(96%)',
      rarities:['epic','legendary','ancestral'] },
    { id:'chlorine_burn',  namePT:'CHLORINE_BURN',  nameEN:'CHLORINE_BURN',
      filter:'hue-rotate(135deg) saturate(290%) contrast(130%) brightness(94%)',
      rarities:['common','epic'] },
    { id:'solar_flare',    namePT:'SOLAR_FLARE',    nameEN:'SOLAR_FLARE',
      filter:'hue-rotate(40deg) saturate(370%) contrast(115%) brightness(100%)',
      rarities:['legendary','ancestral'] },
    { id:'deep_violet',    namePT:'DEEP_VIOLET',    nameEN:'DEEP_VIOLET',
      filter:'hue-rotate(270deg) saturate(310%) contrast(135%) brightness(87%)',
      rarities:['epic','legendary','ancestral'] },
    { id:'thermal_static', namePT:'THERMAL_STATIC', nameEN:'THERMAL_STATIC',
      filter:'hue-rotate(15deg) saturate(200%) contrast(145%) brightness(91%)',
      rarities:['common','epic'] },
    { id:'plasma_echo',    namePT:'PLASMA_ECHO',    nameEN:'PLASMA_ECHO',
      filter:'hue-rotate(320deg) saturate(340%) contrast(118%) brightness(97%)',
      rarities:['epic','legendary','ancestral'] },
    { id:'toxic_bloom',    namePT:'TOXIC_BLOOM',    nameEN:'TOXIC_BLOOM',
      filter:'hue-rotate(100deg) saturate(400%) contrast(110%) brightness(95%)',
      rarities:['common','epic','legendary'] },
    { id:'arctic_scan',    namePT:'ARCTIC_SCAN',    nameEN:'ARCTIC_SCAN',
      filter:'hue-rotate(185deg) saturate(260%) contrast(122%) brightness(100%)',
      rarities:['epic','legendary'] },
    { id:'crimson_wave',   namePT:'CRIMSON_WAVE',   nameEN:'CRIMSON_WAVE',
      filter:'hue-rotate(355deg) saturate(330%) contrast(128%) brightness(90%)',
      rarities:['common','epic','legendary','ancestral'] },
    { id:'amber_overload', namePT:'AMBER_OVERLOAD', nameEN:'AMBER_OVERLOAD',
      filter:'hue-rotate(55deg) saturate(280%) contrast(135%) brightness(96%)',
      rarities:['legendary','ancestral'] },
    { id:'ghost_signal',   namePT:'GHOST_SIGNAL',   nameEN:'GHOST_SIGNAL',
      filter:'hue-rotate(160deg) saturate(220%) contrast(118%) brightness(98%)',
      rarities:['common','epic'] },
    { id:'nova_burst',     namePT:'NOVA_BURST',     nameEN:'NOVA_BURST',
      filter:'hue-rotate(50deg) saturate(400%) contrast(140%) brightness(92%)',
      rarities:['legendary','ancestral'] },
    { id:'midnight_hex',   namePT:'MIDNIGHT_HEX',   nameEN:'MIDNIGHT_HEX',
      filter:'hue-rotate(250deg) saturate(350%) contrast(130%) brightness(89%)',
      rarities:['epic','legendary','ancestral'] },
    { id:'bioluminescent', namePT:'BIOLUMINESCENT', nameEN:'BIOLUMINESCENT',
      filter:'hue-rotate(155deg) saturate(380%) contrast(112%) brightness(100%)',
      rarities:['ancestral'] },
];

/**
 * Sorteia um estilo visual para a raridade dada, com mistura garantida.
 * Nunca retorna um estilo que não está na lista elegível da raridade.
 */
function pickDropVisualStyle(rarityType) {
    const eligible = DROP_VISUAL_STYLES.filter(s => s.rarities.includes(rarityType));
    if (!eligible.length) return DROP_VISUAL_STYLES[0];
    return eligible[Math.floor(Math.random() * eligible.length)];
}

/**
 * Aplica filtro CSS de estilo no canvas de drop, com clamp de segurança
 * para nunca gerar imagens todo-preto (brightness < 85%) ou
 * todo-branco (brightness > 110%) ou dessaturadas (saturate < 180%).
 */
function applyDropStyleFilter(ctx, canvas, styleObj) {
    if (!styleObj || !styleObj.filter) return;
    let safe = styleObj.filter
        .replace(/brightness\((\d+(?:\.\d+)?)%\)/g, (_, v) =>
            `brightness(${Math.max(87, Math.min(108, parseFloat(v)))}%)`)
        .replace(/saturate\((\d+(?:\.\d+)?)%\)/g, (_, v) =>
            `saturate(${Math.max(180, Math.min(420, parseFloat(v)))}%)`);
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width; tmp.height = canvas.height;
    const tCtx = tmp.getContext('2d');
    tCtx.filter = safe;
    tCtx.drawImage(canvas, 0, 0);
    tCtx.filter = 'none';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0);
}

window.DROP_VISUAL_STYLES   = DROP_VISUAL_STYLES;
window.pickDropVisualStyle  = pickDropVisualStyle;
window.applyDropStyleFilter = applyDropStyleFilter;

// =========================================================
// LOJA: renderização e filtro de categoria
// =========================================================
let _lojaCategoryActive = 'all';

function setLojaCategory(cat) {
    _lojaCategoryActive = cat;
    document.querySelectorAll('#lojaFilterBar .filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.lojaCat === cat);
    });
    renderLojaGrid();
}

function renderLojaGrid() {
    const grid = document.getElementById('lojaItemsGrid');
    if (!grid) return;
    const catalog = (typeof ITEMS_DB !== 'undefined') ? Object.values(ITEMS_DB) : [];
    const filtered = _lojaCategoryActive === 'all'
        ? catalog
        : catalog.filter(item => (item.category || 'misc') === _lojaCategoryActive);
    if (!filtered.length) {
        grid.innerHTML = '<div class="loja-empty-notice">Nenhum item disponível nesta categoria.</div>';
        return;
    }
    grid.innerHTML = filtered.map(item => `
        <div class="loja-item-card">
            <div class="loja-item-icon">${item.icon || '📦'}</div>
            <div class="loja-item-name">${item.name || item.nameEN || '—'}</div>
            <div class="loja-item-desc">${item.description || item.desc || ''}</div>
            <div class="loja-item-price">${item.price || 0} B$</div>
            <button class="loja-item-buy" onclick="buyLojaItem('${item.id}')">⚡ ADQUIRIR</button>
        </div>
    `).join('');
}



// ── CONSTANTES GLOBAIS: SISTEMA DE FRAGMENTOS DE SUCATA ──────────────
const FRAGMENTS_PER_CORRUPTED_CARD = 5;
const FRAGMENTS_PER_FURNACE_FAIL   = 8;
const FRAGMENTS_TO_REDEEM_TICKET   = 30;
const FRAGMENTS_TO_REDEEM_ITEM     = 15;

// BUGFIX CRÍTICO: authMode nunca era declarada (só recebia valor dentro de
// switchAuthMode, sem let/var/const). handleAuthSubmit LÊ authMode logo no
// início — se a pessoa clicasse em "Acessar Sistema" antes de switchAuthMode
// ter rodado pelo menos uma vez (ex: token de e-mail confirmado, refresh,
// alguma ordem de carregamento específica do navegador), authMode ainda não
// existia e o acesso lançava "ReferenceError: authMode is not defined" —
// fora do try/catch original, então o clique não fazia NADA visível. Valor
// inicial 'login' porque a aba "Conectar" já vem ativa por padrão no HTML.
let authMode = 'login';

let currentUser = {
    loggedIn: false, username: "ANON_PLAYER", bumps: 100, code: "#0000",
    bio: "Explorador da rede dr0p_station.", avatar: "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", avatarFrame: "frame-style-1", avatarMotionFilter: null, banner: "",
    followers: 12, following: 4, followedByMe: false,
    inventory: [], // populado na Parte 3 (inventário)
    cosmetics: [], // ids dos cosméticos da Loja (molduras/fundos/adereços/estantes/emoticons) já comprados — persistido em profiles.cosmetics
    // Slots de equipamento ativo (um item por slot, exceto a moldura que tem coluna própria avatar_frame).
    // Persistido como objeto único em profiles.equipped_cosmetics (jsonb).
    equippedCosmetics: { background: null, prop: null, shelf: null, emoticon: null }
};

// =========================================================
// SEGURANÇA: REGRAS DE FORÇA DA SENHA
// (substitui o validatePassword original, que só exigia 6 chars)
// =========================================================
function validatePassword(raw) {
    if (!raw || raw.length < 8) return { ok: false, msg: 'Chave deve ter no mínimo 8 caracteres.' };
    if (raw.length > 128) return { ok: false, msg: 'Chave demasiado longa (máx. 128 chars).' };
    if (!/[a-z]/.test(raw)) return { ok: false, msg: 'Chave deve conter ao menos 1 letra minúscula.' };
    if (!/[A-Z]/.test(raw)) return { ok: false, msg: 'Chave deve conter ao menos 1 letra maiúscula.' };
    if (!/[0-9]/.test(raw)) return { ok: false, msg: 'Chave deve conter ao menos 1 número.' };
    const COMMON_WEAK = ['12345678', 'password', 'senha123', 'qwerty123', '11111111', 'abc12345', 'Password1'];
    if (COMMON_WEAK.some(w => w.toLowerCase() === raw.toLowerCase())) {
        return { ok: false, msg: 'Chave demasiado comum/fraca. Escolhe outra.' };
    }
    return { ok: true };
}

// =========================================================
// SEGURANÇA: ANTI-BRUTEFORCE NO LOGIN (client-side)
// Trava tentativas após N falhas seguidas. Isso é só uma camada
// de UX/atrito — a proteção real fica no painel Supabase:
// Authentication → Settings → habilite "Leaked password protection",
// reduza o rate limit de signInWithPassword e ative captcha (hCaptcha/Turnstile).
// =========================================================
const LOGIN_LOCK_KEY = 'dr0p_login_attempts';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 30000; // 30s

function getLoginAttemptState() {
    try { return JSON.parse(sessionStorage.getItem(LOGIN_LOCK_KEY)) || { count: 0, lockedUntil: 0 }; }
    catch (e) { return { count: 0, lockedUntil: 0 }; }
}
function setLoginAttemptState(state) {
    try { sessionStorage.setItem(LOGIN_LOCK_KEY, JSON.stringify(state)); } catch (e) {}
}
function registerFailedLogin() {
    const state = getLoginAttemptState();
    state.count += 1;
    if (state.count >= MAX_LOGIN_ATTEMPTS) state.lockedUntil = Date.now() + LOCKOUT_MS;
    setLoginAttemptState(state);
}
function clearLoginAttempts() {
    setLoginAttemptState({ count: 0, lockedUntil: 0 });
}
function secondsLoginLocked() {
    const state = getLoginAttemptState();
    if (state.lockedUntil && Date.now() < state.lockedUntil) {
        return Math.ceil((state.lockedUntil - Date.now()) / 1000);
    }
    return 0;
}

// =========================================================
// PERFIL (tabela public.profiles)
// ⚠️ A coluna `email` tem o SELECT revogado para anon/authenticated
// no schema.sql (privacidade). Por isso TODAS as leituras abaixo usam
// uma lista explícita de colunas públicas — nunca select('*') nem
// select('email'). A resolução de e-mail para login passa pela
// function security definer `email_by_username` (ver fetchEmailByUsername).
// =========================================================
// [FIX AVATAR ANIMADO] avatar_motion_filter guarda qual variante de
// filtro de movimento (das mesmas 12 usadas nos cards — ver
// MOTION_FILTER_VARIANTS em fusion.js) deve ser replicada no Avatar,
// quando o card escolhido como avatar é um card "isAnimated". É NULL
// quando o avatar escolhido é um card estático normal.
const PUBLIC_PROFILE_COLUMNS = 'id, username, bumps, code, bio, avatar, avatar_frame, avatar_motion_filter, banner, status, following, fusion_count, cosmetics, equipped_cosmetics, fragments, created_at, updated_at';

async function fetchProfile(userId) {
    const { data, error } = await sb.from('profiles').select(PUBLIC_PROFILE_COLUMNS).eq('id', userId).single();
    if (error) { console.error('fetchProfile:', error.message); return null; }
    return data;
}

async function createProfile(userId, username, email) {
    // Trava por id: se já existe um profile pra esse usuário do Auth
    // (re-tentativa de registro, F5 no meio do fluxo, double-click no botão,
    // etc.), retorna o que já existe em vez de inserir uma linha nova.
    const existing = await fetchProfile(userId);
    if (existing) return existing;

    const payload = {
        id: userId,
        username,
        email,
        bumps: 100,
        code: "#" + Math.floor(1000 + Math.random() * 9000),
        bio: "Membro verificado.",
        avatar: "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg",
        avatar_frame: "frame-style-1",
        banner: ""
    };
    // BUGFIX: trocado de .upsert(...) para .insert(...) puro.
    // upsert(payload, { onConflict: 'id' }) gera um INSERT ... ON CONFLICT
    // DO UPDATE no Postgres — e o caminho de UPDATE tenta reavaliar TODAS
    // as colunas do payload, incluindo `email`. Só que o GRANT UPDATE em
    // profiles (ver schema.sql) não inclui a coluna email (só leitura/escrita
    // restrita por design). Resultado: o upsert falhava com "permission
    // denied for column email" sempre que caía no ramo de conflito — e como
    // o fetchProfile() logo acima já garante que não existe linha duplicada,
    // esse ramo de conflito nunca deveria ser necessário mesmo. Um insert
    // puro evita o problema by design.
    const { data, error } = await sb.from('profiles')
        .insert(payload)
        .select(PUBLIC_PROFILE_COLUMNS)
        .single();
    if (error) { console.error('createProfile:', error.message); return null; }

    await seedStarterInventory(userId);
    return data;
}

// =========================================================
// LOGIN: resolve o e-mail real a partir do @username/alias
// (necessário pois o Supabase Auth autentica por e-mail, não por alias)
// Usa a function `email_by_username` (security definer) em vez de
// select direto, já que a coluna email não é legível pela API normal.
// =========================================================
async function fetchEmailByUsername(username) {
    // BUGFIX CRÍTICO (login travado / "Nó de rede inexistente ou assinatura
    // incorreta" em TODA conta existente): validateUsername() SEMPRE devolve
    // o alias com "@" na frente (ver `value: clean.startsWith('@') ? clean : '@' + clean`),
    // e createProfile() grava esse mesmo valor (com "@") na coluna profiles.username.
    // Ou seja, no banco o username é literalmente "@fulano".
    // Esta function ANTES removia o "@" antes de consultar
    // (`username.replace(/^@/, '')`), então a query rodava como
    // `lower(username) = lower('fulano')` contra uma coluna que guarda
    // "@fulano" — NUNCA dava match. Resultado: email_by_username sempre
    // retornava null, fetchEmailByUsername sempre retornava null, e o login
    // caía direto no ramo de "username não encontrado" — para QUALQUER
    // conta, mesmo com a senha certa, porque o e-mail nunca chegava a ser
    // resolvido e signInWithPassword nunca era chamado. Não existe (nem
    // nunca existiu) nenhuma checagem de "assinatura de nó" — é só o texto
    // do alerta. O fix correto é não normalizar o "@" aqui, já que o valor
    // já chega exatamente no mesmo formato gravado no banco (validateUsername
    // já fez essa normalização lá atrás, em handleAuthSubmit).
    const { data, error } = await sb.rpc('email_by_username', { p_username: username });
    if (error) { console.error('fetchEmailByUsername:', error.message); return null; }
    return data || null;
}

// =========================================================
// PERFIL DE TERCEIROS: leitura/escrita por username
// (substitui registryGet/registrySet, que liam/escreviam o
// "registry" inteiro no localStorage; agora cada operação é
// uma query direta à tabela `profiles` no Supabase)
// =========================================================
async function fetchProfileByUsername(username) {
    const { data, error } = await sb.from('profiles').select(PUBLIC_PROFILE_COLUMNS).eq('username', username).maybeSingle();
    if (error) { console.error('fetchProfileByUsername:', error.message); return null; }
    return data;
}

// `fieldsCamel` usa as MESMAS chaves do objeto em memória (ex: { bumps: 120, bio: '...' }).
// Funciona tanto para o currentUser (passa currentUser.id) como para outro usuário
// (passa o id obtido via fetchProfileByUsername).
const PROFILE_FIELD_TO_COLUMN = {
    bumps: 'bumps', bio: 'bio', avatar: 'avatar', avatarFrame: 'avatar_frame', banner: 'banner',
    status: 'status', following: 'following', code: 'code', username: 'username',
    fusion_count: 'fusion_count', cosmetics: 'cosmetics', equippedCosmetics: 'equipped_cosmetics', fragments: 'fragments',
    // [FIX AVATAR ANIMADO] persiste a variante de filtro de movimento junto com o avatar
    avatarMotionFilter: 'avatar_motion_filter'
};
async function updateProfileInSupabase(userId, fieldsCamel) {
    if (!userId) { console.warn('updateProfileInSupabase: userId ausente, ignorando update remoto.'); return false; }
    const updatePayload = {};
    Object.keys(fieldsCamel).forEach(key => {
        const col = PROFILE_FIELD_TO_COLUMN[key];
        if (col) updatePayload[col] = fieldsCamel[key];
    });
    if (Object.keys(updatePayload).length === 0) return false;

    const { error } = await sb.from('profiles').update(updatePayload).eq('id', userId);
    if (error) { console.error('updateProfileInSupabase:', error.message); return false; }
    return true;
}

function applyProfileToCurrentUser(profile) {
    currentUser = {
        loggedIn: true,
        id: profile.id,
        username: profile.username,
        bumps: profile.bumps,
        code: profile.code,
        bio: profile.bio,
        avatar: profile.avatar,
        avatarFrame: profile.avatar_frame || 'frame-style-1',
        // [FIX AVATAR ANIMADO] traz a variante de movimento persistida (ou null
        // se o avatar atual for um card estático comum).
        avatarMotionFilter: profile.avatar_motion_filter || null,
        banner: profile.banner,
        status: profile.status || 'online',
        followingList: profile.following || [],
        following: (profile.following || []).length,
        followers: 0, // calculado em tempo real onde for exibido (Parte futura)
        followedByMe: false,
        inventory: [], // populado na Parte 3
        cosmetics: Array.isArray(profile.cosmetics) ? profile.cosmetics : [],
        fragments: typeof profile.fragments === 'number' ? profile.fragments : 0,
        equippedCosmetics: (profile.equipped_cosmetics && typeof profile.equipped_cosmetics === 'object' && !Array.isArray(profile.equipped_cosmetics))
            ? { background: null, prop: null, shelf: null, emoticon: null, ...profile.equipped_cosmetics }
            : { background: null, prop: null, shelf: null, emoticon: null }
    };

    const navText = document.getElementById('nav-btn-text');
    if (navText) navText.innerText = currentUser.username.toUpperCase();
    const vaultBtn = document.getElementById('navVaultBtn'); if (vaultBtn) vaultBtn.style.display = 'flex';
    const marketBtn = document.getElementById('navMarketBtn'); if (marketBtn) marketBtn.style.display = 'flex';
    const msgBtn = document.getElementById('navMessagesBtn'); if (msgBtn) msgBtn.style.display = 'flex';
    const logoutBtn = document.getElementById('navLogoutBtn'); if (logoutBtn) logoutBtn.style.display = 'flex';
    const contractsBtn = document.getElementById('navContractsBtn'); if (contractsBtn) contractsBtn.style.display = 'flex';
    const lojaBtn = document.getElementById('navLojaBtn'); if (lojaBtn) lojaBtn.style.display = 'flex';
    const broadcastBtn = document.getElementById('navBroadcastBtn'); if (broadcastBtn) broadcastBtn.style.display = 'flex';
    const walletBtn = document.getElementById('navWalletBtn'); if (walletBtn) { walletBtn.style.display = 'flex'; }
    const walletBadge = document.getElementById('wallet-balance-badge'); if (walletBadge) walletBadge.innerText = `${currentUser.bumps} B$`;
    // [ESCOPO 3] Broadcast btn movido para dentro do chat — gcBroadcastBtn
    const gcBroadcastBtn = document.getElementById('gcBroadcastBtn'); if (gcBroadcastBtn) gcBroadcastBtn.style.display = 'flex';
}

function resetCurrentUserToAnon() {
    currentUser = {
        loggedIn: false, username: "ANON_PLAYER", bumps: 100, code: "#0000",
        bio: "Explorador da rede dr0p_station.", avatar: "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", avatarFrame: "frame-style-1", avatarMotionFilter: null, banner: "",
        followers: 12, following: 4, followedByMe: false, inventory: [],
        cosmetics: [], equippedCosmetics: { background: null, prop: null, shelf: null, emoticon: null }, fragments: 0
    };
    messageThreads = {};
    activeThreadUser = null;
    savedAssets = [];

    const navText = document.getElementById('nav-btn-text'); if (navText) navText.innerText = "ACESSAR TERMINAL";
    const vaultBtn = document.getElementById('navVaultBtn'); if (vaultBtn) vaultBtn.style.display = 'none';
    const msgBtn = document.getElementById('navMessagesBtn'); if (msgBtn) msgBtn.style.display = 'none';
    const logoutBtn = document.getElementById('navLogoutBtn'); if (logoutBtn) logoutBtn.style.display = 'none';
    const cBtn = document.getElementById('navContractsBtn'); if (cBtn) cBtn.style.display = 'none';
    const lojaBtn = document.getElementById('navLojaBtn'); if (lojaBtn) lojaBtn.style.display = 'none';
    const broadcastBtn = document.getElementById('navBroadcastBtn'); if (broadcastBtn) broadcastBtn.style.display = 'none';
    const walletBtn2 = document.getElementById('navWalletBtn'); if (walletBtn2) walletBtn2.style.display = 'none';
    const gcBroadcastBtn2 = document.getElementById('gcBroadcastBtn'); if (gcBroadcastBtn2) gcBroadcastBtn2.style.display = 'none';
}

// =========================================================
// SESSÃO: restaura login ao recarregar a página (F5)
// =========================================================
async function restoreCurrentSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { renderBootScreen(); return false; }

    const profile = await fetchProfile(session.user.id);
    if (!profile) { renderBootScreen(); return false; }

    applyProfileToCurrentUser(profile);
    savedAssets = await loadCardsFromSupabase(currentUser.id);
    currentUser.inventory = await loadInventoryFromSupabase(currentUser.id);

    renderBootScreen();
    return true;
}

// Renderiza a tela inicial depois que sabemos, com certeza, se há sessão ativa
// ou não — evita o "precisa de F5" causado por renderizar antes da sessão
// do Supabase ser confirmada.
function renderBootScreen() {
    if (currentUser.loggedIn) {
        showContractsBtnAndResume();
    }
    navigateTo('engine');
}

// Única fonte de verdade pro boot e pra troca de sessão entre abas.
// INITIAL_SESSION dispara uma vez, já com a sessão (ou null) resolvida pelo
// Supabase — é o gatilho certo pra só então carregar UI/missões/cofre,
// em vez de tentar ler dados antes da sessão estar confirmada.
let _bootResolved = false;
sb.auth.onAuthStateChange((event) => {
    if (event === 'INITIAL_SESSION' && !_bootResolved) {
        _bootResolved = true;
        restoreCurrentSession();
    } else if (event === 'SIGNED_OUT') {
        resetCurrentUserToAnon();
        navigateTo('engine');
    }
});

// REALTIME GLOBAL: a chamada de initGlobalRealtime() roda lá no FINAL deste
// arquivo (depois de globalFeed/ledgerCache/etc. já estarem declarados) —
// ver bloco "BOOT: REALTIME GLOBAL" no fim do script.js. Chamá-la aqui em
// cima lançava ReferenceError (TDZ: as variáveis que a function usa ainda
// não tinham sido declaradas nesse ponto da execução), o que travava TODO
// o resto do script — nenhum clique/listener depois desse ponto rodava.

// =========================================================
