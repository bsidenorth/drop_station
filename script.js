// =========================================================
// DROP STATION — PARTE 1/4: AUTH (SUPABASE)
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

let currentUser = {
    loggedIn: false, username: "ANON_PLAYER", bumps: 100, code: "#0000",
    bio: "Explorador da rede Drop Station.", avatar: "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", banner: "",
    followers: 12, following: 4, followedByMe: false,
    inventory: [] // populado na Parte 3 (inventário)
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
const PUBLIC_PROFILE_COLUMNS = 'id, username, bumps, code, bio, avatar, banner, status, following, fusion_count, created_at, updated_at';

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
    const clean = username.replace(/^@/, '');
    const { data, error } = await sb.rpc('email_by_username', { p_username: clean });
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
    bumps: 'bumps', bio: 'bio', avatar: 'avatar', banner: 'banner',
    status: 'status', following: 'following', code: 'code', username: 'username',
    fusion_count: 'fusion_count'
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
        banner: profile.banner,
        status: profile.status || 'online',
        followingList: profile.following || [],
        following: (profile.following || []).length,
        followers: 0, // calculado em tempo real onde for exibido (Parte futura)
        followedByMe: false,
        inventory: [] // populado na Parte 3
    };

    const navText = document.getElementById('nav-btn-text');
    if (navText) navText.innerText = currentUser.username.toUpperCase();
    const vaultBtn = document.getElementById('navVaultBtn'); if (vaultBtn) vaultBtn.style.display = 'flex';
    const marketBtn = document.getElementById('navMarketBtn'); if (marketBtn) marketBtn.style.display = 'flex';
    const msgBtn = document.getElementById('navMessagesBtn'); if (msgBtn) msgBtn.style.display = 'flex';
    const logoutBtn = document.getElementById('navLogoutBtn'); if (logoutBtn) logoutBtn.style.display = 'flex';
    const contractsBtn = document.getElementById('navContractsBtn'); if (contractsBtn) contractsBtn.style.display = 'flex';
}

function resetCurrentUserToAnon() {
    currentUser = {
        loggedIn: false, username: "ANON_PLAYER", bumps: 100, code: "#0000",
        bio: "Explorador da rede Drop Station.", avatar: "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", banner: "",
        followers: 12, following: 4, followedByMe: false, inventory: []
    };
    messageThreads = {};
    activeThreadUser = null;
    savedAssets = [];

    const navText = document.getElementById('nav-btn-text'); if (navText) navText.innerText = "ACESSAR TERMINAL";
    const vaultBtn = document.getElementById('navVaultBtn'); if (vaultBtn) vaultBtn.style.display = 'none';
    const msgBtn = document.getElementById('navMessagesBtn'); if (msgBtn) msgBtn.style.display = 'none';
    const logoutBtn = document.getElementById('navLogoutBtn'); if (logoutBtn) logoutBtn.style.display = 'none';
    const cBtn = document.getElementById('navContractsBtn'); if (cBtn) cBtn.style.display = 'none';
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

// =========================================================
// LOGIN / REGISTRO
// =========================================================
async function handleAuthSubmit(event) {
    event.preventDefault();
    const rawUser = document.getElementById('authUsername').value;
    const rawPass = document.getElementById('authPassword').value;
    const errorEl = document.getElementById('authErrorMsg');
    errorEl.style.display = 'none';

    if (authMode === 'login') {
        const lockedSecs = secondsLoginLocked();
        if (lockedSecs > 0) {
            errorEl.innerText = `Muitas tentativas falhas. Aguarda ${lockedSecs}s antes de tentar novamente.`;
            errorEl.style.display = 'block';
            return;
        }
    }

    const userCheck = validateUsername(rawUser);
    if (!userCheck.ok) { errorEl.innerText = userCheck.msg; errorEl.style.display = 'block'; return; }
    const formattedUser = userCheck.value;

    const passCheck = validatePassword(rawPass);
    if (!passCheck.ok) { errorEl.innerText = passCheck.msg; errorEl.style.display = 'block'; return; }

    const submitBtn = document.getElementById('authSubmitBtn');

    try {
        if (authMode === 'register') {
            const rawEmail = (document.getElementById('authEmail').value || '').trim();
            const confirmPass = document.getElementById('authConfirmPassword').value;
            const day = document.getElementById('authBirthDay').value;
            const month = document.getElementById('authBirthMonth').value;
            const year = document.getElementById('authBirthYear').value;
            const termsOk = document.getElementById('authTerms').checked;

            const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!rawEmail || !EMAIL_RE.test(rawEmail)) {
                errorEl.innerText = 'Informa um e-mail válido para vincular ao terminal.';
                errorEl.style.display = 'block';
                return;
            }
            if (rawPass !== confirmPass) {
                errorEl.innerText = 'As chaves (senha e confirmação) não coincidem.';
                errorEl.style.display = 'block';
                return;
            }
            if (!day || !month || !year) {
                errorEl.innerText = 'Selecione sua data de nascimento completa.';
                errorEl.style.display = 'block';
                return;
            }
            const age = calculateAge(parseInt(day, 10), parseInt(month, 10), parseInt(year, 10));
            if (age < 18) {
                showCyberAlert('// ACESSO_BLOQUEADO //', 'Drop Station é uma rede exclusiva para operadores +18. Este terminal não pode ser consolidado por menores de idade.', 'error');
                return;
            }
            if (!termsOk) {
                errorEl.innerText = 'Você precisa aceitar os Termos de Uso e a Política de Privacidade para continuar.';
                errorEl.style.display = 'block';
                return;
            }

            submitBtn.disabled = true;
            const { data, error } = await sb.auth.signUp({ email: rawEmail, password: rawPass });
            if (error) {
                errorEl.innerText = (error.message.includes('already registered') || error.message.includes('already been registered'))
                    ? "Esse e-mail já está registrado na rede."
                    : error.message;
                errorEl.style.display = 'block';
                return;
            }
            // Se confirmação de e-mail estiver desativada no painel, data.user já vem ativo
            if (data.user) {
                const profile = await createProfile(data.user.id, formattedUser, rawEmail);
                if (!profile) {
                    // ⚠️ signOut() encerra só a sessão local — NÃO apaga o usuário
                    // do auth.users (isso exigiria a service_role key, que nunca
                    // deve rodar no client). Ou seja: a conta de auth JÁ EXISTE
                    // com esse e-mail, mesmo a criação do profile tendo falhado.
                    // Por isso a mensagem não pode sugerir "tenta de novo do zero" —
                    // se a pessoa tentar sb.auth.signUp() de novo com o MESMO e-mail,
                    // vai cair em "already registered". O caminho certo daqui é
                    // LOGIN (a senha que ela acabou de definir já é válida) — o login
                    // vai falhar com "perfil não encontrado" (ver fetchProfile em
                    // handleAuthSubmit), e nesse ponto criamos o profile que faltou.
                    await sb.auth.signOut();
                    errorEl.innerHTML = "Falha ao salvar seu perfil (username pode já estar em uso). " +
                        "Sua conta de acesso já foi criada — tenta ENTRAR (não registrar de novo) " +
                        "com o mesmo e-mail e senha que você acabou de definir.";
                    errorEl.style.display = 'block';
                    return;
                }
            }

            showCyberAlert('// NÓ CONSOLIDADO //', 'Registo concluído. Realiza a conexão agora.', 'success');
            switchAuthMode('login');
            return;
        }

        // LOGIN — resolve o e-mail real a partir do @username/alias
        submitBtn.disabled = true;
        const loginEmail = await fetchEmailByUsername(formattedUser);
        if (!loginEmail) {
            registerFailedLogin();
            const remaining = MAX_LOGIN_ATTEMPTS - getLoginAttemptState().count;
            errorEl.innerText = remaining > 0
                ? `Nó de rede inexistente ou assinatura incorreta. (${remaining} tentativa(s) restante(s))`
                : `Muitas tentativas falhas. Aguarda ${secondsLoginLocked()}s.`;
            errorEl.style.display = 'block';
            return;
        }

        const { data, error } = await sb.auth.signInWithPassword({ email: loginEmail, password: rawPass });
        if (error) {
            registerFailedLogin();
            const remaining = MAX_LOGIN_ATTEMPTS - getLoginAttemptState().count;
            errorEl.innerText = remaining > 0
                ? `Nó de rede inexistente ou assinatura incorreta. (${remaining} tentativa(s) restante(s))`
                : `Muitas tentativas falhas. Aguarda ${secondsLoginLocked()}s.`;
            errorEl.style.display = 'block';
            return;
        }
        clearLoginAttempts();

        const profile = await fetchProfile(data.user.id);
        if (!profile) {
            // AUTO-CURA: a conta de Auth é válida (login passou), mas não tem
            // profile — provavelmente uma sessão anterior falhou no meio do
            // cadastro (ver nota em handleAuthSubmit/registro). Em vez de travar
            // a pessoa pra sempre atrás de "contate o suporte", tenta criar o
            // profile que faltou agora, usando o username que ela acabou de digitar.
            const healedProfile = await createProfile(data.user.id, formattedUser, data.user.email);
            if (!healedProfile) {
                // Só falha aqui se esse username específico já estiver em uso
                // por OUTRA conta — nesse caso realmente precisa de um alias novo.
                errorEl.innerText = "Sua conta existe, mas o username '" + formattedUser + "' já está em uso por outro perfil. Contate o suporte pra recuperar o acesso.";
                errorEl.style.display = 'block';
                return;
            }
            messageThreads = {};
            activeThreadUser = null;
            applyProfileToCurrentUser(healedProfile);
            savedAssets = [];
            currentUser.inventory = await loadInventoryFromSupabase(currentUser.id);
            playTerminalSound('login');
            navigateTo('engine');
            return;
        }

        messageThreads = {};
        activeThreadUser = null;
        const prevAssets = [...(savedAssets || [])];
        applyProfileToCurrentUser(profile);

        // Carrega cofre e inventário reais do Supabase (antes ficava vazio)
        savedAssets = await loadCardsFromSupabase(currentUser.id);
        currentUser.inventory = await loadInventoryFromSupabase(currentUser.id);
        checkIncomingGifts(prevAssets, savedAssets);

        playTerminalSound('login');
        resumePendingContracts();
        navigateTo('engine');

    } catch (e) {
        console.error(e);
        errorEl.innerText = "Falha de comunicação com a rede. Tenta novamente.";
        errorEl.style.display = 'block';
    } finally {
        submitBtn.disabled = false;
    }
}

// =========================================================
// LOGOUT
// =========================================================
async function logoutSession() {
    await sb.auth.signOut();
    resetCurrentUserToAnon();
    navigateTo('engine');
}

// =========================================================
// BOOT: ver onAuthStateChange (INITIAL_SESSION) acima — restoreCurrentSession()
// já é disparado de lá, só depois que a sessão do Supabase é confirmada.
// =========================================================

    // =========================================================
    // PERSISTÊNCIA DO MERCADO — Ponto 1
    // ⚠️ loadMarket/saveMarket (localStorage) foram REMOVIDOS.
    // O mercado agora é persistido na tabela `cards` (for_sale + is_listed)
    // via loadMarketFromSupabase / listCardOnMarket / unlistCardFromMarket /
    // buyCardFromMarket (ver Parte 5/4, mais abaixo no arquivo).
    // =========================================================
    const NOTIF_KEY   = 'dr0p_notifications';
    const LEDGER_KEY  = 'dr0p_ledger';

    // =========================================================
    // SISTEMA DE COTAÇÃO EM TEMPO REAL (MARKET QUOTES ENGINE)
    // =========================================================
    const QUOTES_KEY = 'dr0p_market_quotes';

    // Cotação base de cada raridade (preço de referência em B$)
    const BASE_QUOTES = {
        common:    { base: 10,   label: 'COMUM',     labelEN: 'COMMON'    },
        epic:      { base: 80,   label: 'ÉPICO',     labelEN: 'EPIC'      },
        legendary: { base: 300,  label: 'LENDÁRIO',  labelEN: 'LEGENDARY' },
        ancestral: { base: 2000, label: 'ANCESTRAL', labelEN: 'ANCESTRAL' }
    };

    // Limites de variação pra cotação não explodir nem zerar
    const QUOTE_FLOOR_MULT = 0.35; // nunca cai abaixo de 35% do valor base
    const QUOTE_CEIL_MULT  = 3.0;  // nunca sobe acima de 300% do valor base

    function loadMarketQuotes() {
        try {
            const saved = JSON.parse(localStorage.getItem(QUOTES_KEY));
            if (saved && saved.common && saved.epic && saved.legendary) return saved;
        } catch(e) {}
        // Estado inicial: todas no preço base, sem variação
        return {
            common:    { price: BASE_QUOTES.common.base,    change: 0, trend: 'up' },
            epic:      { price: BASE_QUOTES.epic.base,      change: 0, trend: 'up' },
            legendary: { price: BASE_QUOTES.legendary.base, change: 0, trend: 'up' },
            ancestral: { price: BASE_QUOTES.ancestral.base, change: 0, trend: 'up' }
        };
    }

    function saveMarketQuotes(quotes) {
        try { localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes)); } catch(e) {}
    }

    let currentLang = (localStorage.getItem('dr0p_lang') || 'PT');
    let audioCtx = null;
    let isBgmPlaying = false;
    let bgmInterval = null;

    let marketQuotes = loadMarketQuotes();

    /**
     * updateMarketQuotes(droppedRarity)
     * Disparada toda vez que um drop acontece na máquina.
     * Regra econômica:
     *  - Drop ÉPICO ou LENDÁRIO  -> cotação DAQUELA categoria CAI (inflação por excesso de oferta).
     *  - Drop COMUM              -> cotação das categorias mais altas (ÉPICO e LENDÁRIO) SOBE (escassez relativa).
     */
    function updateMarketQuotes(droppedRarity) {
        const q = marketQuotes;

        const rollPct = () => 0.02 + Math.random() * 0.07;

        function applyMove(key, direction) {
            if (!q[key]) return;
            const base = BASE_QUOTES[key].base;
            const pct = rollPct() * direction;
            let newPrice = q[key].price * (1 + pct);
            const floor = base * QUOTE_FLOOR_MULT;
            const ceil  = base * QUOTE_CEIL_MULT;
            newPrice = Math.max(floor, Math.min(ceil, newPrice));
            const changePct = ((newPrice - q[key].price) / q[key].price) * 100;
            q[key].change = changePct;
            q[key].trend  = newPrice >= q[key].price ? 'up' : 'down';
            q[key].price  = Math.round(newPrice * 100) / 100;
        }

        if (droppedRarity === 'ancestral') {
            applyMove('ancestral', -1);
            applyMove('legendary', 1);
            applyMove('epic', 1);
        } else if (droppedRarity === 'epic') {
            applyMove('epic', -1);
        } else if (droppedRarity === 'legendary') {
            applyMove('legendary', -1);
        } else {
            applyMove('epic', 1);
            applyMove('legendary', 1);
            applyMove('common', -1);
        }

        saveMarketQuotes(q);
        renderQuotesTicker();
        return q;
    }

    function renderQuotesTicker() {
        const tracks = [
            document.getElementById('tickerGlobalTrack')
        ].filter(Boolean);
        if (tracks.length === 0) return;

        const order = ['common', 'epic', 'legendary', 'ancestral'];
        const isPT = currentLang === 'PT';

        const itemsHtml = order.map(key => {
            if (!marketQuotes[key]) return '';
            const data  = marketQuotes[key];
            const meta  = BASE_QUOTES[key];
            const label = isPT ? meta.label : meta.labelEN;
            const cls   = `tk-${key}`;
            const dirCls = data.trend === 'up' ? 'up' : 'down';
            const arrow  = data.trend === 'up' ? '▲' : '▼';
            const changeAbs = Math.abs(data.change).toFixed(2);
            return `
                <div class="ticker-item">
                    <span class="ticker-label ${cls}">${label}</span>
                    <span class="ticker-price">${data.price.toFixed(2)} B$</span>
                    <span class="ticker-change ${dirCls}"><span class="ticker-arrow">${arrow}</span>${changeAbs}%</span>
                </div>`;
        }).join('');

        const fullHtml = itemsHtml + itemsHtml;
        tracks.forEach(track => track.innerHTML = fullHtml);
    }

    // =========================================================
    // LEDGER DE TRANSAÇÕES GLOBAIS (Ponto 4)
    // =========================================================
    function loadLedger() {
        try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) || []; } catch(e) { return []; }
    }
    function pushLedger(entry) {
        try {
            const ledger = loadLedger();
            ledger.unshift({ text: entry, ts: new Date().toLocaleTimeString('pt-PT') });
            if (ledger.length > 50) ledger.length = 50;
            localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
        } catch(e) {}
    }
    function renderMarketLedger() {
        const box  = document.getElementById('marketLedgerBox');
        const list = document.getElementById('marketLedgerList');
        if (!box || !list) return;
        const ledger = loadLedger();
        if (ledger.length === 0) { box.style.display = 'none'; return; }
        box.style.display = 'block';
        const last5 = ledger.slice(0, 5);
        list.innerHTML = last5.map((e, i) =>
            `<div class="ledger-entry" style="animation-delay:${i * 0.12}s; padding:3px 0; border-bottom:1px solid #111; color:#aaa;">
                <span style="color:#ffaa00;">[${e.ts}]</span> ${e.text}
             </div>`
        ).join('');
        startLedgerAutoScroll(list);
    }

    // Faz o feed "respirar": rola suavemente para o próximo item a cada
    // poucos segundos, dando sensação de movimento contínuo e dinâmico.
    let ledgerAutoScrollTimer = null;
    function startLedgerAutoScroll(list) {
        if (ledgerAutoScrollTimer) clearInterval(ledgerAutoScrollTimer);
        const entries = list.querySelectorAll('.ledger-entry');
        if (entries.length <= 1) return;
        let idx = 0;
        ledgerAutoScrollTimer = setInterval(() => {
            idx = (idx + 1) % entries.length;
            entries[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 2600);
    }

    // Notificações / histórico de transações — Ponto 2
    function loadNotifications(username) {
        try {
            const all = JSON.parse(localStorage.getItem(NOTIF_KEY)) || {};
            return all[username] || [];
        } catch(e) { return []; }
    }
    function pushNotification(username, text) {
        try {
            const all = JSON.parse(localStorage.getItem(NOTIF_KEY)) || {};
            if (!all[username]) all[username] = [];
            all[username].unshift({ text, date: new Date().toLocaleString('pt-PT') });
            if (all[username].length > 50) all[username].length = 50; // limite
            localStorage.setItem(NOTIF_KEY, JSON.stringify(all));
        } catch(e) {}
    }

    // Alerta cyberpunk — Ponto 2
    function showCyberAlert(title, msg, type) {
        // type: 'success' | 'error' | 'warn'
        const overlay = document.getElementById('cyberAlertOverlay');
        const box     = document.getElementById('cyberAlertBox');
        const tEl     = document.getElementById('cyberAlertTitle');
        const mEl     = document.getElementById('cyberAlertMsg');
        box.className = 'cyber-alert-box' + (type === 'error' ? ' alert-error' : type === 'warn' ? ' alert-warn' : '');
        tEl.innerText = title;
        mEl.innerHTML = msg;
        overlay.classList.add('visible');
    }
    function closeCyberAlert() {
        document.getElementById('cyberAlertOverlay').classList.remove('visible');
    }

    // =========================================================
    // ESTADO DE FILTROS E PAGINAÇÃO — Ponto 3
    // =========================================================
    const PAGE_SIZE = 9;
    let vaultFilter  = 'all'; let vaultPage  = 0;
    let marketFilter = 'all'; let marketPage = 0;

    function setVaultFilter(f) {
        vaultFilter = f; vaultPage = 0;
        document.querySelectorAll('#vaultFilterBar .filter-btn').forEach(b => {
            const isActive = b.dataset.filter === f;
            b.className = 'filter-btn' + (isActive
                ? (f==='epic'?' active-epic': f==='legendary'?' active-legendary': f==='ancestral'?' active-ancestral':' active')
                : '');
        });
        renderVaultGrid();
    }
    function setMarketFilter(f) {
        marketFilter = f; marketPage = 0;
        document.querySelectorAll('#marketFilterBar .filter-btn').forEach(b => {
            const isActive = b.dataset.filter === f;
            b.className = 'filter-btn' + (isActive
                ? (f==='epic'?' active-epic': f==='legendary'?' active-legendary': f==='ancestral'?' active-ancestral':' active')
                : '');
        });
        renderMarketGrid();
    }

    function renderPagination(containerId, totalItems, currentPage, onPageFn) {
        const bar = document.getElementById(containerId); if(!bar) return;
        bar.innerHTML = '';
        const totalPages = Math.ceil(totalItems / PAGE_SIZE);
        if (totalPages <= 1) return;
        for (let i = 0; i < totalPages; i++) {
            const btn = document.createElement('button');
            btn.className = 'page-btn' + (i === currentPage ? ' active-page' : '');
            btn.innerText = i + 1;
            btn.onclick = () => onPageFn(i);
            bar.appendChild(btn);
        }
        const info = document.createElement('span');
        info.className = 'page-info';
        info.innerText = `${currentPage+1} / ${totalPages}`;
        bar.appendChild(info);
    }

    // =========================================================
    // DADOS INICIAIS
    // =========================================================
    let selectedProfileUser = null;
    let savedAssets = [];
    let messageThreads = {};
    let activeThreadUser = null;

    const SEED_FEED = [
        { id: "#449201", rarityType: "legendary", rarityName: "LENDÁRIO", rarityNameEN: "LEGENDARY", styleName: "MATRIX GLITCH", styleNameEN: "MATRIX GLITCH", creator: "@cyber_k1ng", registered: true, exposed: true, forSale: true, price: 150, imgSrc: "https://i.ibb.co/m56c5F2Z/ced5acf2-417d-4669-b964-96437ab91fda.jpg" },
        { id: "#110293", rarityType: "epic",      rarityName: "ÉPICO",    rarityNameEN: "EPIC",      styleName: "ACID NEON",    styleNameEN: "ACID NEON",    creator: "@neon_samurai", registered: true, exposed: true, forSale: false, price: 0, imgSrc: "https://i.ibb.co/S7JbrXX2/fa809178-22dc-4ec1-8d84-2dcea9ab44b7.jpg" }
    ];

    // =========================================================
    // PERSISTÊNCIA DO FEED GLOBAL DE MUTAÇÕES/FUSÕES — Ponto 1
    // Sem isso, novos drops/fusões desapareciam da Home a cada F5.
    // =========================================================
    const GLOBAL_FEED_KEY = 'cyber_global_feed';

    function loadGlobalFeed() {
        try {
            const saved = JSON.parse(localStorage.getItem(GLOBAL_FEED_KEY));
            return Array.isArray(saved) ? saved : null;
        } catch(e) { return null; }
    }
    function saveGlobalFeed(arr) {
        try { localStorage.setItem(GLOBAL_FEED_KEY, JSON.stringify(arr)); } catch(e) {}
    }

    // Carrega o feed persistido; só usa o SEED_FEED na primeira vez (storage vazio)
    let globalFeed = loadGlobalFeed();
    if (globalFeed === null) {
        globalFeed = [...SEED_FEED];
        saveGlobalFeed(globalFeed);
    }

    // Mercado: array em memória que renderMarketGrid() lê/filtra/pagina.
    // Fonte de verdade real é a tabela `cards` no Supabase — este array é
    // só um CACHE preenchido por loadMarketFromSupabase() sempre que a
    // tela de mercado é aberta ou uma ação (listar/comprar/remover) muda
    // o estado. Começa vazio; renderMarketGrid() popula no primeiro render.
    let marketAssets = [];

    // Garante que o item de exemplo do SEED_FEED também aparece no globalFeed
    // (sem duplicar por ID). Isso é só o feed social/cosmético da Home —
    // não tem relação com o mercado real de venda (ver nota acima).
    if (!globalFeed.find(f => f.id === SEED_FEED[0].id)) globalFeed.unshift(SEED_FEED[0]);

    const canvas = document.getElementById('pfp-canvas'); 
    const ctx = canvas ? canvas.getContext('2d') : null;
    const targetContainer = document.getElementById('target-container');
    const downloadBtn = document.getElementById('download-btn');
    const stabilityWrapper = document.getElementById('stability-wrapper');
    const stabilityLabel = document.getElementById('stability-label');
    const stabilityBar = document.getElementById('stability-bar');
    const metaId = document.getElementById('meta-id'); 
    const metaRarity = document.getElementById('meta-rarity');
    const metaStyle = document.getElementById('meta-style'); 
    const metaOwner = document.getElementById('meta-owner');

    const animePool = [
        "https://i.ibb.co/m56c5F2Z/ced5acf2-417d-4669-b964-96437ab91fda.jpg",
        "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg",
        "https://i.ibb.co/S7JbrXX2/fa809178-22dc-4ec1-8d84-2dcea9ab44b7.jpg",
        "https://i.ibb.co/pBy1Rmyq/sylvanian-pfp.jpg",
        "https://i.ibb.co/9m50LNJT/db05209d-fd04-4353-a033-d21349f7d98c.jpg",
        "https://i.ibb.co/LdxbZdpR/91e7283f-2f12-4701-8de0-0798caa5e42e.jpg",
        "https://i.ibb.co/HfrS8TJh/Screenshot-20260616-213009-Chrome.jpg",
        "https://i.ibb.co/C3Hp4Cvs/image.jpg",
        "https://i.ibb.co/ycRhQk8v/image.jpg",
        "https://i.ibb.co/N28DPq35/Scearm.jpg",
        "https://i.ibb.co/rGr2fJnT/Pinterest.jpg"
    ];
    const preloadedCanvases = [];
    let lastMintedBuffer = null; let activeAssetData = null; let decayInterval = null; let isRolling = false;
    let isProcessingClaim = false; // Mutex global: impede duplicação e debito duplo de Bumps

    const dictionary = {
        PT: {
            'nav-market': 'MERCADO P2P', 'nav-inbox': 'INBOX SECRETO', 'nav-vault': 'MEU COFRE', 'nav-access': 'ACESSAR TERMINAL',
            'feed-title': 'MUTAÇÕES_REDE', 'lbl-rarity': 'RARIDADE', 'lbl-style': 'ESTILO VISUAL', 'lbl-creator': 'AUTOR DA MINTAGEM',
            'vault-title': 'MEU COFRE', 'market-title': 'MERCADO P2P DIRECT', 'messages-title': 'INBOX // DIALOGOS_CRIPTOGRAFADOS', 'profile-showcase': 'VITRINE EXPOSTA',
            'lbl-id': 'CÓDIGO ID CARD', 'free-sub': 'RISCO DE QUEBRA // FLUXO INESTÁVEL', 'premium-sub': '100% SEGURO // GARANTIA DE COMPILAÇÃO',
            'faq-title': '> TERMINAL_INFO // PERGUNTAS_FREQUENTES',
            'faq-q1': '[+] O que é o Drop Station?',
            'faq-a1': '▸ Plataforma P2P de cards digitais gerados por IA. Cada card é único, rastreado no registry e negociável em B$ (Bumps).',
            'faq-q2': '[+] O que são Bumps (B$)?',
            'faq-a2': '▸ Moeda interna da rede. Usada para resgatar cards épicos/lendários, comprar no mercado P2P e propor trocas. Carregue via PIX ou cripto.',
            'faq-q3': '[+] O que acontece se não resgatar a tempo?',
            'faq-a3': '▸ A mutação se autodestrói em 10 segundos por instabilidade de rede. O card é removido do feed global permanentemente.',
            'faq-q4': '[+] Como funciona a Alquimia?',
            'faq-a4': '▸ Funde 2 cards do seu cofre para criar um novo. Os originais são destruídos. Raridade resultante depende dos cards usados + roll de probabilidade.',
            'faq-q5': '[+] Quem pode ver meu perfil e cards?',
            'faq-a5': '▸ Perfis públicos são visíveis a todos. Cards expostos na vitrine aparecem no feed. O mercado é público mas compras exigem login.',
            'log-prefix': 'LOG // ', 'download-btn': 'RESGATAR ATIVO',
            'stability-label': 'TEMPO DE RESGATE: 10s',
            'market-landing-sub': 'VISUALIZAÇÃO PÚBLICA — LOGIN NECESSÁRIO PARA COMPRAR'
        },
        EN: {
            'nav-market': 'P2P MARKET', 'nav-inbox': 'SECRET INBOX', 'nav-vault': 'MY VAULT', 'nav-access': 'ACCESS TERMINAL',
            'feed-title': 'NETWORK_MUTATIONS', 'lbl-rarity': 'RARITY', 'lbl-style': 'VISUAL STYLE', 'lbl-creator': 'MINT AUTHOR',
            'vault-title': 'MY SECURE VAULT', 'market-title': 'P2P MARKET DIRECT', 'messages-title': 'INBOX // ENCRYPTED_CHATS', 'profile-showcase': 'EXPOSED SHOWCASE',
            'lbl-id': 'CARD ID CODE', 'free-sub': 'RISK OF SHATTER // UNSTABLE FLOW', 'premium-sub': '100% SECURE // COMPILATION WARRANTY',
            'faq-title': '> TERMINAL_INFO // FREQUENTLY ASKED',
            'faq-q1': '[+] What is Drop Station?',
            'faq-a1': '▸ P2P platform for AI-generated digital cards. Each card is unique, tracked in the registry and tradeable in B$ (Bumps).',
            'faq-q2': '[+] What are Bumps (B$)?',
            'faq-a2': '▸ Internal network currency. Used to claim epic/legendary cards, buy on P2P market and propose trades. Load via PIX or crypto.',
            'faq-q3': '[+] What happens if I don\'t claim in time?',
            'faq-a3': '▸ The mutation self-destructs in 10 seconds due to network instability. The card is permanently removed from the global feed.',
            'faq-q4': '[+] How does Alchemy work?',
            'faq-a4': '▸ Fuse 2 cards from your vault to create a new one. Originals are destroyed. Resulting rarity depends on input cards + probability roll.',
            'faq-q5': '[+] Who can see my profile and cards?',
            'faq-a5': '▸ Public profiles visible to all. Cards exposed in showcase appear in feed. Market is public but purchases require login.',
            'log-prefix': 'LOG // ', 'download-btn': 'CLAIM ASSET',
            'stability-label': 'CLAIM TIME LEFT: 10s',
            'market-landing-sub': 'PUBLIC VIEW — LOGIN REQUIRED TO PURCHASE'
        }
    };

    const CYBER_VOICES = {
        PT: [
            "Acesso concedido.", "Brecha de dados detectada.", "Drop Station online.", "Mutação instável.",
            "Ativo integrado ao cofre.", "Protocolo de fusão iniciado.", "Rede segura estabelecida.",
            "Identidade verificada.", "Transmissão criptografada.", "Alerta de rede ativado.",
            "Compra confirmada.", "Card lendário detectado.", "Terminal ativado. Bem-vindo, operador."
        ],
        EN: [
            "Access granted.", "Data breach detected.", "Drop Station online.", "Mutation unstable.",
            "Asset secured in vault.", "Fusion protocol initiated.", "Secure channel established.",
            "Identity verified.", "Encrypted transmission.", "Network alert activated.",
            "Purchase confirmed.", "Legendary card detected.", "Terminal activated. Welcome, operator."
        ]
    };

    function speakPhrase(phrasePT, phraseEN) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const text = currentLang === 'PT' ? phrasePT : phraseEN;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = currentLang === 'PT' ? 'pt-BR' : 'en-US';
        u.rate = 1.1; u.pitch = 0.8; u.volume = 0.9;
        window.speechSynthesis.speak(u);
    }

    function speakRandom() {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const pool = CYBER_VOICES[currentLang];
        const text = pool[Math.floor(Math.random() * pool.length)];
        const u = new SpeechSynthesisUtterance(text);
        u.lang = currentLang === 'PT' ? 'pt-BR' : 'en-US';
        u.rate = 1.0; u.pitch = 0.75; u.volume = 0.9;
        window.speechSynthesis.speak(u);
    }

    // =========================================================
    // SISTEMA CENTRAL DE ÁUDIO E VOZ SINTETIZADA (Ponto 3)
    // =========================================================
    // =========================================================
    // SFX — CHOQUE / CURTO-CIRCUITO ELÉTRICO (dispara junto do glitch
    // visual da Alquimia/Fusão — ver FASE 2 de fuseCards)
    // =========================================================
    function playFusionShockSound() {
        try {
            initAudio();
            const now = audioCtx.currentTime;

            // Buzz principal: dente-de-serra grave com frequência instável
            // (efeito de "curto" elétrico, tremendo)
            const buzz = audioCtx.createOscillator();
            const buzzGain = audioCtx.createGain();
            buzz.type = 'sawtooth';
            buzz.frequency.setValueAtTime(90, now);
            buzzGain.gain.setValueAtTime(0.001, now);
            buzzGain.gain.linearRampToValueAtTime(0.18, now + 0.02);
            for (let i = 0; i < 14; i++) {
                const t = now + i * 0.045;
                buzz.frequency.setValueAtTime(60 + Math.random() * 420, t);
            }
            buzzGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
            buzz.connect(buzzGain); buzzGain.connect(audioCtx.destination);
            buzz.start(now); buzz.stop(now + 0.65);

            // Crackle de alta frequência por cima, tipo faísca/arco voltaico
            for (let i = 0; i < 8; i++) {
                const t = now + Math.random() * 0.6;
                const spark = audioCtx.createOscillator();
                const sparkGain = audioCtx.createGain();
                spark.type = 'square';
                spark.frequency.setValueAtTime(1800 + Math.random() * 3200, t);
                sparkGain.gain.setValueAtTime(0.05, t);
                sparkGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
                spark.connect(sparkGain); sparkGain.connect(audioCtx.destination);
                spark.start(t); spark.stop(t + 0.04);
            }
        } catch (e) {}
    }

    function playTerminalSound(type) {
        // type: 'login' | 'error' | 'claim' | 'alchemy'
        try { initAudio(); } catch(e) {}

        const beep = (freq, oscType, dur, gain) => {
            try {
                initAudio();
                const osc = audioCtx.createOscillator();
                const g   = audioCtx.createGain();
                osc.type = oscType || 'square';
                osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
                g.gain.setValueAtTime(gain || 0.12, audioCtx.currentTime);
                g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
                osc.connect(g); g.connect(audioCtx.destination);
                osc.start(); osc.stop(audioCtx.currentTime + dur);
            } catch(e) {}
        };

        if (type === 'login') {
            beep(440, 'sine', 0.1, 0.12);
            setTimeout(() => beep(880, 'sine', 0.18, 0.1), 120);
            setTimeout(() => speakPhrase("Terminal ativado. Bem-vindo, operador.", "Terminal activated. Welcome, operator."), 300);

        } else if (type === 'error') {
            beep(300, 'sawtooth', 0.3, 0.2);
            setTimeout(() => beep(180, 'sawtooth', 0.3, 0.18), 180);
            setTimeout(() => speakPhrase("Acesso negado. Bumps insuficientes.", "Access denied. Insufficient Bumps."), 300);

        } else if (type === 'claim') {
            beep(523, 'triangle', 0.25, 0.15);
            setTimeout(() => beep(659, 'triangle', 0.25, 0.12), 100);
            setTimeout(() => beep(784, 'triangle', 0.35, 0.1), 200);
            setTimeout(() => speakPhrase("Ativo integrado ao cofre.", "Asset secured in vault."), 400);

        } else if (type === 'alchemy') {
            beep(200, 'sawtooth', 0.15, 0.15);
            setTimeout(() => beep(400, 'square', 0.15, 0.12), 150);
            setTimeout(() => beep(800, 'sine', 0.15, 0.1), 300);
            setTimeout(() => beep(1200, 'sine', 0.3, 0.12), 450);
            setTimeout(() => speakPhrase("Protocolo de fusão concluído. Nova entidade gerada.", "Fusion protocol complete. New entity generated."), 700);
        }
    }

    function toggleLanguage() {
        currentLang = currentLang === 'PT' ? 'EN' : 'PT';
        try { localStorage.setItem('dr0p_lang', currentLang); } catch(e) {}
        document.getElementById('langLabel').innerText = currentLang;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (dictionary[currentLang][key]) el.innerText = dictionary[currentLang][key];
        });
        if (!activeAssetData && !isRolling) {
            document.getElementById('status-text').innerText = currentLang === 'PT' ? 'AGUARDANDO_MUTACAO...' : 'AWAITING_MUTATION...';
        } else if (activeAssetData) {
            metaRarity.innerText = currentLang === 'PT' ? activeAssetData.rarityName : activeAssetData.rarityNameEN;
            metaStyle.innerText  = currentLang === 'PT' ? activeAssetData.styleName  : activeAssetData.styleNameEN;
            if (downloadBtn.style.display === "block") {
                downloadBtn.innerText = activeAssetData.costToClaim > 0 ?
                    (currentLang === 'PT' ? `RESGATAR (CUSTO: 50 B$)` : `CLAIM (COST: 50 B$)`) :
                    (currentLang === 'PT' ? "ENVIAR AO COFRE VIRTUAL" : "SEND TO SECURE VAULT");
            }
        }
        speakRandom();
        renderQuotesTicker();
    }

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playSynthSound(type) {
        try {
            initAudio();
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode); gainNode.connect(audioCtx.destination);

            if (type === 'click') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
                osc.start(); osc.stop(audioCtx.currentTime + 0.05);
            } else if (type === 'success') {
                let now = audioCtx.currentTime;
                osc.type = 'triangle'; osc.frequency.setValueAtTime(523.25, now);
                osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.15);
                gainNode.gain.setValueAtTime(0.15, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                osc.start(); osc.stop(now + 0.3);

                setTimeout(() => {
                    let osc2 = audioCtx.createOscillator(); let gain2 = audioCtx.createGain();
                    osc2.type = 'sine'; osc2.frequency.setValueAtTime(1318.51, audioCtx.currentTime);
                    osc2.connect(gain2); gain2.connect(audioCtx.destination);
                    gain2.gain.setValueAtTime(0.1, audioCtx.currentTime);
                    gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
                    osc2.start(); osc2.stop(audioCtx.currentTime + 0.2);
                }, 80);
            } else if (type === 'tick') {
                osc.type = 'square'; osc.frequency.setValueAtTime(1400, audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.04, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.02);
                osc.start(); osc.stop(audioCtx.currentTime + 0.02);
            } else if (type === 'shatter') {
                let now = audioCtx.currentTime;
                osc.type = 'sawtooth'; osc.frequency.setValueAtTime(280, now);
                osc.frequency.linearRampToValueAtTime(40, now + 0.4);
                gainNode.gain.setValueAtTime(0.25, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
                osc.start(); osc.stop(now + 0.45);
            } else if (type === 'roll') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(440, audioCtx.currentTime);
                osc.frequency.linearRampToValueAtTime(880, audioCtx.currentTime + 0.12);
                gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
                osc.start(); osc.stop(audioCtx.currentTime + 0.12);
            }
        } catch(e) {}
    }

    function toggleBackgroundAudio() {
        initAudio();
        const btn = document.getElementById('audioToggleBtn');
        if (isBgmPlaying) {
            clearInterval(bgmInterval); isBgmPlaying = false;
            btn.classList.remove('on');
        } else {
            isBgmPlaying = true;
            btn.classList.add('on');
            let beatIndex = 0;
            const bass = [55.00, 55.00, 48.99, 48.99, 65.41, 65.41, 58.27, 58.27];
            bgmInterval = setInterval(() => {
                try {
                    let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain();
                    let filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(300, audioCtx.currentTime);
                    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(bass[beatIndex % bass.length], audioCtx.currentTime);
                    osc.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
                    gain.gain.setValueAtTime(0.15, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.22);
                    osc.start(); osc.stop(audioCtx.currentTime + 0.25); beatIndex++;
                } catch(e) {}
            }, 250);
        }
    }

    animePool.forEach(url => {
        const img = new Image(); img.crossOrigin = "anonymous"; img.src = url;
        img.onload = () => {
            const off = document.createElement('canvas'); off.width = 600; off.height = 600;
            off.getContext('2d').drawImage(img, 0, 0, 600, 600); preloadedCanvases.push(off);
        };
    });

    function resizeCanvases() {
        if(!canvas) return;
        const size = targetContainer.getBoundingClientRect().width || 400;
        canvas.width = size; canvas.height = size;
    }
    window.addEventListener('resize', resizeCanvases); setTimeout(resizeCanvases, 150);

    function toggleFaq(el) {
        const ans = el.nextElementSibling;
        ans.style.display = (ans.style.display === 'block') ? 'none' : 'block';
    }

    function navigateTo(screenId) {
        playSynthSound('click');

        // Limpa estado anterior do drop ao sair do engine, evitando botão travado/duplicação
        if (screenId !== 'engine') {
            downloadBtn.disabled = false;
            // Não destruímos activeAssetData aqui para não perder o card no free roll
            // mas garantimos que o botão não fica disabled ao regressar
        } else {
            // Ao regressar ao engine, re-habilita o botão se houver card ativo
            downloadBtn.disabled = false;
        }

        document.querySelectorAll('.spa-screen').forEach(s => s.classList.remove('active'));
        const t = document.getElementById(`screen-${screenId}`);
        if(t) t.classList.add('active');
        if (screenId === 'engine') { setTimeout(resizeCanvases, 50); renderDailyDropButton(); renderDailyMissions(); }
        if (screenId === 'leaderboard') renderLeaderboard();
        if (screenId === 'vault') renderVaultGrid();
        if (screenId === 'market') { renderMarketGrid(); renderMarketLedger(); }
        if (screenId === 'messages') { renderChatThreads(); renderGlobalOffers('offersContainer'); }
        if (screenId === 'profile') viewTargetUserCollection(currentUser.username, currentUser.code, currentUser.bio, currentUser.avatar, currentUser.banner, true);
        if (screenId === 'contracts') renderContractsScreen();
    }

    function handleProfileNavClick() {
        if (!currentUser.loggedIn) {
            showCyberAlert('ACESSO_NEGADO:', 'Perfil bloqueado. Faça login para acessar seu terminal de operador.', 'error');
            setTimeout(() => { closeCyberAlert(); navigateTo('auth'); }, 1500);
            return;
        }
        navigateTo('profile');
    }

    function populateAgeSelectors() {
        const dayEl = document.getElementById('authBirthDay');
        const monthEl = document.getElementById('authBirthMonth');
        const yearEl = document.getElementById('authBirthYear');
        if (!dayEl || dayEl.options.length > 1) return; // já populado, evita duplicar

        for (let d = 1; d <= 31; d++) {
            const opt = document.createElement('option'); opt.value = d; opt.textContent = d; dayEl.appendChild(opt);
        }
        const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        MESES.forEach((m, i) => {
            const opt = document.createElement('option'); opt.value = i + 1; opt.textContent = m; monthEl.appendChild(opt);
        });
        const currentYear = new Date().getFullYear();
        for (let y = currentYear - 13; y >= currentYear - 100; y--) {
            const opt = document.createElement('option'); opt.value = y; opt.textContent = y; yearEl.appendChild(opt);
        }
    }

    function calculateAge(day, month, year) {
        const today = new Date();
        const birth = new Date(year, month - 1, day);
        let age = today.getFullYear() - birth.getFullYear();
        const beforeBirthdayThisYear = (today.getMonth() < birth.getMonth()) ||
            (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
        if (beforeBirthdayThisYear) age--;
        return age;
    }

    function switchAuthMode(mode) {
        authMode = mode;
        document.getElementById('authErrorMsg').style.display = 'none';
        const registerOnlyEls = document.querySelectorAll('.register-only');
        const emailInput = document.getElementById('authEmail');
        const confirmInput = document.getElementById('authConfirmPassword');
        const termsInput = document.getElementById('authTerms');
        if(mode === 'login') {
            document.getElementById('tab-login').classList.add('active'); document.getElementById('tab-register').classList.remove('active');
            document.getElementById('authTitle').innerText = "SINCRO_CONTA"; document.getElementById('authSubmitBtn').innerText = "Acessar Sistema";
            registerOnlyEls.forEach(el => el.style.display = 'none');
            if (emailInput) emailInput.required = false;
            if (confirmInput) confirmInput.required = false;
            if (termsInput) termsInput.required = false;
        } else {
            document.getElementById('tab-login').classList.remove('active'); document.getElementById('tab-register').classList.add('active');
            document.getElementById('authTitle').innerText = "REGISTRAR_NÓ"; document.getElementById('authSubmitBtn').innerText = "Consolidar Identidade";
            registerOnlyEls.forEach(el => el.style.display = '');
            populateAgeSelectors();
            if (emailInput) emailInput.required = true;
            if (confirmInput) confirmInput.required = true;
            if (termsInput) termsInput.required = true;
        }
    }

    // =========================================================
    // SEGURANÇA: SANITIZAÇÃO E VALIDAÇÃO DE INPUTS
    // =========================================================
    const RESERVED_USERNAMES = ['admin', 'administrator', 'root', 'system', 'bot', 'null', 'undefined', 'moderator', 'support'];

    function sanitizeInput(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/[<>"'`&;{}()\[\]\\\/]/g, '') // remove tags HTML e chars perigosos
            .replace(/javascript:/gi, '')
            .replace(/on\w+=/gi, '')
            .trim()
            .slice(0, 64); // limite máximo
    }

    function validateUsername(raw) {
        const clean = sanitizeInput(raw);
        if (!clean || clean.length < 2) return { ok: false, msg: 'Username deve ter pelo menos 2 caracteres.' };
        const lower = clean.toLowerCase().replace(/^@/, '');
        if (RESERVED_USERNAMES.includes(lower)) return { ok: false, msg: 'Username reservado. Escolhe outro alias.' };
        if (!/^@?[a-zA-Z0-9_\-\.]{2,30}$/.test(clean)) return { ok: false, msg: 'Username inválido. Use apenas letras, números, _ ou -' };
        return { ok: true, value: clean.startsWith('@') ? clean : '@' + clean };
    }

    function pauseMarquee() { document.getElementById('storiesContainer').classList.remove('animated'); }
    function resumeMarquee() { document.getElementById('storiesContainer').classList.add('animated'); }

    function masterRenderLoop() {
        if (ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (isRolling && preloadedCanvases.length > 0) {
                ctx.drawImage(preloadedCanvases[Math.floor(Math.random() * preloadedCanvases.length)], 0, 0, canvas.width, canvas.height);
            } else if (lastMintedBuffer) {
                ctx.drawImage(lastMintedBuffer, 0, 0, canvas.width, canvas.height);
            } else {
                ctx.fillStyle = "#06060c"; ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = "#00ff66"; ctx.font = "bold 14px 'Space Mono'"; ctx.textAlign = "center";
                ctx.fillText("[SISTEMA_PRONTO_PARA_MINTAR]", canvas.width/2, canvas.height/2);
            }
        }
        requestAnimationFrame(masterRenderLoop);
    }
    requestAnimationFrame(masterRenderLoop);

    // =========================================================
    // MISSÕES DIÁRIAS — Reset a cada 24h reais via timestamp
    // =========================================================
    const DAILY_MISSIONS_KEY = 'dr0p_daily_missions';

    const DAILY_MISSIONS_DB = [
        {
            id: 'MSN-01',
            name: 'Primeira Extração',
            desc: 'Resgate 1 card comum na máquina de drop.',
            reqRarity: 'common',
            reqCount: 1,
            reward: 20,
            rewardLabel: '20 B$'
        },
        {
            id: 'MSN-02',
            name: 'Caçador Épico',
            desc: 'Possua 1 card Épico no cofre.',
            reqRarity: 'epic',
            reqCount: 1,
            reward: 80,
            rewardLabel: '80 B$'
        },
        {
            id: 'MSN-03',
            name: 'Lendário da Rede',
            desc: 'Possua 1 card Lendário no cofre.',
            reqRarity: 'legendary',
            reqCount: 1,
            reward: 200,
            rewardLabel: '200 B$'
        },
        {
            id: 'MSN-04',
            name: 'ENTIDADE ANCESTRAL',
            desc: 'Possua 1 card ANCESTRAL no cofre. [MISSÃO RARA]',
            reqRarity: 'ancestral',
            reqCount: 1,
            reward: 500,
            rewardLabel: '500 B$'
        }
    ];

    function loadDailyMissions() {
        try {
            const all = JSON.parse(localStorage.getItem(DAILY_MISSIONS_KEY)) || {};
            return all[currentUser.username] || { lastReset: 0, completed: [] };
        } catch(e) { return { lastReset: 0, completed: [] }; }
    }

    function saveDailyMissions(data) {
        try {
            const all = JSON.parse(localStorage.getItem(DAILY_MISSIONS_KEY)) || {};
            all[currentUser.username] = data;
            localStorage.setItem(DAILY_MISSIONS_KEY, JSON.stringify(all));
        } catch(e) {}
    }

    function checkDailyMissionsReset() {
        const data = loadDailyMissions();
        const now = Date.now();
        if (now - data.lastReset >= 86400000) {
            // Reseta painel após 24h
            saveDailyMissions({ lastReset: now, completed: [] });
            return { lastReset: now, completed: [] };
        }
        return data;
    }

    async function claimDailyMission(missionId) {
        if (!currentUser.loggedIn) { navigateTo('auth'); return; }
        const mission = DAILY_MISSIONS_DB.find(m => m.id === missionId);
        if (!mission) return;

        const data = checkDailyMissionsReset();
        if (data.completed.includes(missionId)) return;

        // Verifica requisito: conta cards da raridade no cofre
        const count = savedAssets.filter(a => a.rarityType === mission.reqRarity).length;
        if (count < mission.reqCount) {
            showCyberAlert('MISSÃO NÃO CONCLUÍDA',
                `Requisito: <b>${mission.reqCount} card(s) ${mission.reqRarity.toUpperCase()}</b> no cofre.<br>Você tem: <b>${count}</b>.`, 'warn');
            return;
        }

        // Log de terminal antes de creditar
        const logLines = [
            `> INICIANDO PROCESSO DE VERIFICAÇÃO...`,
            `> MISSÃO [${missionId}]: ${mission.name.toUpperCase()}`,
            `> REQUISITO VALIDADO: ${count} CARD(S) ${mission.reqRarity.toUpperCase()} DETECTADO(S)`,
            `> CALCULANDO RECOMPENSA: ${mission.reward} B$`,
            `> CREDITANDO NO TERMINAL...`,
            `> OPERAÇÃO CONCLUÍDA. +${mission.reward} B$ ADICIONADOS.`
        ];

        // Credita recompensa
        currentUser.bumps += mission.reward;
        await updateProfileInSupabase(currentUser.id, { bumps: currentUser.bumps });

        // Marca missão como concluída
        data.completed.push(missionId);
        saveDailyMissions(data);

        // Atualiza badge de saldo
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;

        playSynthSound('success');
        if (mission.reqRarity === 'ancestral') triggerAncestralFlash('#ff007f');

        showCyberAlert(
            '// MISSÃO CONCLUÍDA //',
            `<div style="font-family:'Space Mono',monospace; font-size:0.6rem; color:#00ff6699; text-align:left; margin-bottom:12px; line-height:2;">${logLines.map(l => `<div>${l}</div>`).join('')}</div>` +
            `<b style="color:#ffaa00; font-size:0.9rem;">+${mission.reward} B$</b> creditados.<br>Saldo atual: <b>${currentUser.bumps} B$</b>`,
            'success'
        );

        renderDailyMissions();
    }

    function renderDailyMissions() {
        const container = document.getElementById('dailyMissionsContainer');
        if (!container) return;
        container.innerHTML = '';

        if (!currentUser.loggedIn) {
            container.innerHTML = '<div class="empty-vault-notice">Login necessário para ver missões diárias.</div>';
            return;
        }

        const data = checkDailyMissionsReset();
        const now = Date.now();
        const remaining = Math.max(0, 86400000 - (now - data.lastReset));
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);

        // Header com reset timer
        const header = document.createElement('div');
        header.style.cssText = 'font-size:0.55rem; color:#555566; letter-spacing:1px; margin-bottom:12px;';
        header.innerText = `> MISSÕES_DIÁRIAS // RESET EM ${String(h).padStart(2,'0')}h${String(m).padStart(2,'0')}m`;
        container.appendChild(header);

        DAILY_MISSIONS_DB.forEach(mission => {
            const isDone = data.completed.includes(mission.id);
            const isAncestral = mission.reqRarity === 'ancestral';

            // Missão concluída some da lista
            if (isDone) return;

            const card = document.createElement('div');
            card.style.cssText = `
                background: ${isAncestral ? '#120008' : '#07070f'};
                border: 1px solid ${isAncestral ? '#ff007f' : '#333344'};
                padding: 14px 16px; margin-bottom: 8px; position: relative; overflow: hidden;
                ${isAncestral ? 'box-shadow: 0 0 12px rgba(255,0,127,0.2);' : ''}
            `;

            const countOwned = savedAssets.filter(a => a.rarityType === mission.reqRarity).length;
            const canClaim = countOwned >= mission.reqCount;

            card.innerHTML = `
                <div style="font-size:0.5rem; color:${isAncestral ? '#ff007f' : '#666680'}; letter-spacing:2px; margin-bottom:4px;">${mission.id} ${isAncestral ? '// ⚠ MISSÃO RARA' : ''}</div>
                <div style="font-family:'Archivo Black',sans-serif; font-size:0.8rem; color:${isAncestral ? '#ff007f' : '#fff'}; margin-bottom:4px;">${mission.name}</div>
                <div style="font-size:0.58rem; color:#888899; margin-bottom:8px;">${mission.desc}</div>
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                    <span style="font-size:0.55rem; color:${isAncestral ? '#ff007f' : '#ffaa00'}; border:1px solid currentColor; padding:2px 7px;">💰 +${mission.rewardLabel}</span>
                    <span style="font-size:0.5rem; color:#666;">VOCÊ TEM: ${countOwned}/${mission.reqCount}</span>
                    <button class="btn-action" style="border-color:${canClaim ? (isAncestral ? '#ff007f' : '#00ff66') : '#333'}; color:${canClaim ? (isAncestral ? '#ff007f' : '#00ff66') : '#555'}; ${canClaim ? '' : 'cursor:not-allowed; opacity:0.5;'} padding:6px 14px; width:auto;" ${canClaim ? `onclick="claimDailyMission('${mission.id}')"` : 'disabled'}>
                        ${canClaim ? '▶ RESGATAR' : 'INCOMPLETA'}
                    </button>
                </div>
            `;
            container.appendChild(card);
        });

        // Se todas concluídas
        if (container.querySelectorAll('div[style]').length <= 1) {
            const done = document.createElement('div');
            done.className = 'empty-vault-notice';
            done.innerHTML = '✅ TODAS AS MISSÕES DO DIA CONCLUÍDAS.<br><small style="color:#444;font-size:0.55rem;">Volta amanhã para novas missões.</small>';
            container.appendChild(done);
        }
    }

    // =========================================================
    // PROVENIÊNCIA — ID Único, Hash Criptográfico e Timestamp
    // Sistema interno de prova de origem: todo card gerado no
    // Drop Station carrega uma assinatura imutável. Mesmo sem
    // blockchain, o registro no localStorage funciona como
    // "ata de nascimento" do ativo. Útil para detectar cópias
    // e como base para tokenização futura (Web3).
    // =========================================================

    /**
     * Hash leve e determinístico (DJB2) a partir dos dados do card.
     * Roda de forma síncrona e offline, sem depender de SubtleCrypto.
     * O resultado muda se qualquer campo-semente do card mudar.
     */
    function _djb2Hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h) ^ str.charCodeAt(i);
            h |= 0; // força inteiro 32 bits
        }
        return (h >>> 0).toString(16).padStart(8, '0').toUpperCase();
    }

    /**
     * Gera o objeto de proveniência para um card.
     * @param {object} cardData  Objeto parcial ou completo do card (precisa de id, rarityType, styleName, creator)
     * @returns {{ hash: string, timestamp: number, origin: string }}
     */
    function generateProvenance(cardData) {
        const ts   = Date.now();
        const seed = [cardData.id, cardData.rarityType, cardData.styleName, cardData.creator, ts].join('|');
        return {
            hash:      `DS-${_djb2Hash(seed)}`,   // ex: DS-4A2F9C1B
            timestamp: ts,
            origin:    'DROP_STATION_INTERNAL'
        };
    }

    /**
     * Injeta proveniência + flag Web3 no objeto do card SE ainda não tiver.
     * Cards do feed global legado ou demo ficam sem — comportamento esperado.
     * A partir desta versão, também inicializa o Survival Counter (fusion_count),
     * o histórico genético (genetic_history) e a assinatura visual do QR Code.
     * @param {object} cardObj  Objeto do card (mutado in-place e retornado)
     */
    function attachProvenance(cardObj) {
        if (cardObj.provenance) return cardObj; // já tem — nunca sobrescrever
        cardObj.provenance  = generateProvenance(cardObj);
        cardObj.isTokenized = false; // preparação para fluxo Web3

        // ── ALQUIMIA: contador de sobrevivência + linhagem genética ──
        if (typeof cardObj.fusion_count !== 'number') cardObj.fusion_count = 0;
        if (!Array.isArray(cardObj.genetic_history)) cardObj.genetic_history = [];
        cardObj.eliteEligible = cardObj.fusion_count >= 3;

        // ── Resoluções: UI leve (500px) sempre disponível; HD só sob demanda ──
        if (!cardObj.resolutions) {
            cardObj.resolutions = { ui: { w: 500, h: 500 }, hd: { w: 4000, h: 4000, src: null } };
        }

        regenerateQrSignature(cardObj);
        return cardObj;
    }

    /**
     * Regera a assinatura visual do QR Code de um card sempre que seu estado muda:
     * criação, transferência de propriedade ou sobrevivência a uma fusão.
     * O hash base (provenance.hash) nunca muda — só o sufixo de estado "-Fxx".
     */
    function regenerateQrSignature(cardObj) {
        const suffix = `F${cardObj.fusion_count || 0}`;
        cardObj.qr_code_hash   = `${cardObj.provenance.hash}-${suffix}`;
        cardObj.qr_payload_url = `https://dropstation.app/proveniencia/${cardObj.qr_code_hash}`;
        return cardObj;
    }

    /**
     * Desenha o QR Code dinâmico de um card num container do DOM.
     * Usa a lib QRCode (qrcodejs) carregada no <head> do index.html.
     * Sempre limpa o container antes de redesenhar (necessário pois o
     * QR muta a cada novo estado do card).
     */
    function renderQRCode(cardObj, containerId) {
        const el = document.getElementById(containerId);
        if (!el || typeof QRCode === 'undefined' || !cardObj.qr_payload_url) return;
        el.innerHTML = ''; // limpa render anterior — o QR é regenerado, não acumulado
        new QRCode(el, {
            text: cardObj.qr_payload_url,
            width: 120,
            height: 120,
            colorDark: '#00ffff',
            colorLight: '#020204',
            correctLevel: QRCode.CorrectLevel.M
        });
    }

    // ITEMS_DB, getUserInventory e consumeInventoryItem agora vêm da Parte 3 (Supabase), no final do arquivo.

    // DAILY DROPS — Recompensa diária (cooldown de 24h)
    const DAILY_DROP_REWARD_BUMPS = 15;

    function getDailyDropKey() {
        return `cyber_daily_drop_${currentUser.username}`;
    }

    async function claimDailyDrop() {
        if (!currentUser.loggedIn) { navigateTo('auth'); return; }
        const key = getDailyDropKey();
        const last = parseInt(localStorage.getItem(key) || '0', 10);
        const now = Date.now();
        if (now - last < 86400000) { renderDailyDropButton(); return; }

        currentUser.bumps += DAILY_DROP_REWARD_BUMPS;
        localStorage.setItem(key, String(now));
        await updateProfileInSupabase(currentUser.id, { bumps: currentUser.bumps });

        showCyberAlert('PROCESSO_CONCLUÍDO:', `Subsídio de rede coletado! +${DAILY_DROP_REWARD_BUMPS} B$ creditados na conta.`, 'success');
        playTerminalSound('claim');
        renderDailyDropButton();
    }

    function renderDailyDropButton() {
        const btn = document.getElementById('dailyDropBtn');
        if (!btn) return;
        if (!currentUser.loggedIn) { btn.innerText = '🛰️ LOGIN PARA COLHER SUBSÍDIO'; btn.disabled = true; return; }

        const last = parseInt(localStorage.getItem(getDailyDropKey()) || '0', 10);
        const remaining = 86400000 - (Date.now() - last);

        if (remaining <= 0) {
            btn.disabled = false;
            btn.innerText = `🛰️ COLHER SUBSÍDIO DA REDE (+${DAILY_DROP_REWARD_BUMPS} B$)`;
        } else {
            btn.disabled = true;
            const h = Math.floor(remaining / 3600000);
            const m = Math.floor((remaining % 3600000) / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            btn.innerText = `⏳ PRÓXIMO SUBSÍDIO EM ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }
    }
    setInterval(renderDailyDropButton, 1000);

    // =========================================================
    // LEADERBOARD — Placar Global de Operadores
    // =========================================================
    let leaderboardMode = 'bumps'; // 'bumps' | 'legendary'

    function setLeaderboardMode(mode) {
        leaderboardMode = mode;
        document.querySelectorAll('#leaderboardModeBar .filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
        renderLeaderboard();
    }

    async function renderLeaderboard() {
        const list = document.getElementById('leaderboardList');
        if (!list) return;

        // Busca todos os perfis (substitui loadRegistry()) + contagem de lendários por usuário
        const { data: profilesData, error: profErr } = await sb.from('profiles').select('id, username, bumps, fusion_count');
        if (profErr) { console.error('renderLeaderboard (profiles):', profErr.message); list.innerHTML = '<div class="empty-vault-notice">FALHA AO CARREGAR PLACAR.</div>'; return; }

        const { data: legendaryRows, error: cardsErr } = await sb.from('cards').select('id_usuario').eq('rarity_type', 'legendary');
        if (cardsErr) console.error('renderLeaderboard (cards):', cardsErr.message);
        const legendaryCounts = {};
        (legendaryRows || []).forEach(r => { legendaryCounts[r.id_usuario] = (legendaryCounts[r.id_usuario] || 0) + 1; });

        const rows = (profilesData || []).map(u => ({
            username: u.username, bumps: u.bumps || 0, legendaryCount: legendaryCounts[u.id] || 0
        }));

        rows.sort((a, b) => leaderboardMode === 'bumps' ? (b.bumps - a.bumps) : (b.legendaryCount - a.legendaryCount));
        const top5 = rows.slice(0, 5);

        if (top5.length === 0) {
            list.innerHTML = '<div class="empty-vault-notice">NENHUM OPERADOR REGISTRADO NA REDE.</div>';
            return;
        }

        list.innerHTML = top5.map((r, i) => {
            const medal = ['🥇','🥈','🥉','🎖️','🎖️'][i] || '▫️';
            const value = leaderboardMode === 'bumps' ? `${r.bumps} B$` : `${r.legendaryCount} LENDÁRIOS`;
            const isMe = r.username === currentUser.username ? ' style="color:#00ffff;"' : '';
            return `<div class="leaderboard-row"${isMe}><span>${medal} #${i+1}</span><span>${r.username}</span><span>${value}</span></div>`;
        }).join('');
    }

    // =========================================================
    // BADGES DE CONQUISTA
    // =========================================================
    function computeBadges(userData) {
        const badges = [];
        const fusionCount = (userData && userData.fusionCount) || 0;
        const bumps = (userData && userData.bumps) || 0;
        if (fusionCount >= 10) badges.push({ icon: '⚗️', label: 'MESTRE ALQUIMISTA' });
        if (bumps >= 1000) badges.push({ icon: '🐋', label: 'BALEIA DA REDE' });
        const legendaryCount = ((userData && userData.savedAssets) || []).filter(a => a.rarityType === 'legendary').length;
        if (legendaryCount >= 3) badges.push({ icon: '💎', label: 'CAÇADOR DE LENDAS' });
        return badges;
    }

    async function renderProfileBadges(username) {
        const zone = document.getElementById('profBadgesZone');
        if (!zone) return;
        const profile = await fetchProfileByUsername(username);
        if (!profile) { zone.innerHTML = '<span class="badge-tag badge-empty">SEM INSÍGNIAS REGISTRADAS</span>'; return; }
        const { data: legendaryRows } = await sb.from('cards').select('id').eq('id_usuario', profile.id).eq('rarity_type', 'legendary');
        const userData = {
            fusionCount: profile.fusion_count || 0,
            bumps: profile.bumps || 0,
            savedAssets: (legendaryRows || []).map(() => ({ rarityType: 'legendary' }))
        };
        const badges = computeBadges(userData);
        zone.innerHTML = badges.length === 0
            ? '<span class="badge-tag badge-empty">SEM INSÍGNIAS REGISTRADAS</span>'
            : badges.map(b => `<span class="badge-tag">${b.icon} ${b.label}</span>`).join('');
    }

    async function registerFusionForBadges() {
        if (!currentUser.id) return;
        const newCount = (currentUser.fusionCount || 0) + 1;
        currentUser.fusionCount = newCount;
        await updateProfileInSupabase(currentUser.id, { fusion_count: newCount });
    }

    // =========================================================
    // EVENTO DE SISTEMA — SOBRECARGA NA REDE (boost temporário de Épicos)
    // =========================================================
    let networkOverloadActive = false;
    const NETWORK_OVERLOAD_EPIC_MULTIPLIER = 2.5;
    const NETWORK_OVERLOAD_DURATION_MS = 5 * 60 * 1000;
    const NETWORK_OVERLOAD_CHECK_INTERVAL_MS = 90 * 1000; // checa a cada 90s
    const NETWORK_OVERLOAD_CHANCE_PER_CHECK = 0.12; // 12% de chance por checagem

    function triggerNetworkOverload() {
        if (networkOverloadActive) return;
        networkOverloadActive = true;
        const indicator = document.getElementById('overloadIndicator');
        if (indicator) indicator.style.display = 'inline-flex';

        showCyberAlert(
            '⚠️ ALERTA_DE_REDE:',
            'Sobrecarga na rede! Chance de dropar cards ÉPICOS aumentada por 5 minutos!',
            'warn'
        );
        playTerminalSound('alchemy');

        setTimeout(() => {
            networkOverloadActive = false;
            if (indicator) indicator.style.display = 'none';
            showCyberAlert('LOG_ERRO:', 'Sobrecarga de rede estabilizada. Probabilidades normalizadas.', 'warn');
        }, NETWORK_OVERLOAD_DURATION_MS);
    }

    function startNetworkOverloadLoop() {
        setInterval(() => {
            if (networkOverloadActive) return;
            if (Math.random() < NETWORK_OVERLOAD_CHANCE_PER_CHECK) triggerNetworkOverload();
        }, NETWORK_OVERLOAD_CHECK_INTERVAL_MS);
    }
    startNetworkOverloadLoop();

    // =========================================================
    // FX — CURTO-CIRCUITO NA LOGO + ESTALO ELÉTRICO SINTETIZADO
    // =========================================================
    function playElectricZap() {
        try {
            initAudio();
            const bufferSize = audioCtx.sampleRate * 0.18;
            const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);

            const noise = audioCtx.createBufferSource();
            noise.buffer = noiseBuffer;
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'highpass'; filter.frequency.setValueAtTime(1800, audioCtx.currentTime);
            const gain = audioCtx.createGain();
            gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);

            noise.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
            noise.start();

            const osc = audioCtx.createOscillator();
            osc.type = 'square'; osc.frequency.setValueAtTime(90, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.12);
            const oGain = audioCtx.createGain();
            oGain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            oGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.14);
            osc.connect(oGain); oGain.connect(audioCtx.destination);
            osc.start(); osc.stop(audioCtx.currentTime + 0.14);
        } catch(e) {}
    }

    // =========================================================
    // FX — FLASH DE TELA ANCESTRAL (rosa se sucesso, vermelho se quebrar)
    // =========================================================
    function triggerAncestralFlash(color) {
        const flash = document.createElement('div');
        flash.style.cssText = `
            position:fixed; inset:0; z-index:99999;
            background:${color};
            opacity:0; pointer-events:none;
            transition: opacity 0.08s ease;
        `;
        document.body.appendChild(flash);
        // Pulsa 3 vezes
        let count = 0;
        const pulse = () => {
            flash.style.opacity = '0.35';
            setTimeout(() => {
                flash.style.opacity = '0';
                count++;
                if (count < 3) setTimeout(pulse, 160);
                else setTimeout(() => flash.remove(), 200);
            }, 100);
        };
        setTimeout(pulse, 20);
    }

    // =========================================================
    // WEB3 — Modal Simulado de Tokenização (Pré-Mint)
    // Nenhuma transação real acontece aqui. O objetivo é mostrar
    // ao usuário o fluxo e educá-lo sobre custos de gas, mantendo
    // controle e custo do lado dele. O card já tem isTokenized:false
    // como placeholder para integração futura com MetaMask/ERC-721.
    // =========================================================
    function showTokenizeModal(cardId) {
        closeInspectModal();
        const card = savedAssets.find(a => a.id === cardId);
        if (!card) return;

        const prov = card.provenance;
        const rarityColor = card.rarityType === 'ancestral' ? '#ff007f'
            : card.rarityType === 'legendary' ? '#00ffff'
            : card.rarityType === 'epic'      ? '#ffaa00'
            : '#aaaaaa';

        // Injeta modal de tokenização como overlay temporário
        const overlay = document.createElement('div');
        overlay.id = 'tokenizeOverlay';
        overlay.style.cssText = `
            position:fixed; inset:0; z-index:10000;
            background:rgba(2,2,8,0.97);
            display:flex; align-items:center; justify-content:center;
            padding:20px;
        `;
        overlay.innerHTML = `
            <div style="max-width:480px; width:100%; background:#070712; border:1px solid #9933ff;
                        padding:28px; font-family:'Space Mono',monospace; position:relative;">
                <!-- Header -->
                <div style="color:#9933ff; font-size:0.65rem; letter-spacing:3px; margin-bottom:4px;">⬡ TOKENIZAÇÃO WEB3 // SIMULAÇÃO</div>
                <div style="color:#fff; font-family:'Archivo Black',sans-serif; font-size:1rem; margin-bottom:16px;">
                    Transformar em NFT
                </div>

                <!-- Info do card -->
                <div style="background:#0d0020; border:1px solid #9933ff33; padding:12px; margin-bottom:16px; font-size:0.52rem; line-height:2; color:#aaaacc;">
                    <div>CARD &nbsp;&nbsp;&nbsp;: <span style="color:${rarityColor};">${card.id}</span></div>
                    <div>RARIDADE: <span style="color:${rarityColor};">${card.rarityNameEN}</span></div>
                    ${prov ? `<div>HASH &nbsp;&nbsp;&nbsp;: <span style="color:#fff;">${prov.hash}</span></div>
                    <div>EMITIDO : <span style="color:#fff;">${new Date(prov.timestamp).toLocaleString('pt-BR')}</span></div>` : ''}
                </div>

                <!-- Explicação do fluxo -->
                <div style="font-size:0.53rem; color:#888899; line-height:1.8; margin-bottom:18px;">
                    <p style="margin:0 0 8px;">Para transformar este card num <b style="color:#9933ff;">NFT ERC-721</b> na blockchain, você precisará:</p>
                    <div style="padding-left:8px; border-left:2px solid #9933ff44;">
                        <div>① Conectar sua carteira (ex: <b style="color:#fff;">MetaMask</b>)</div>
                        <div>② Aprovar o contrato do Drop Station</div>
                        <div>③ Pagar o <b style="color:#ffaa00;">gas fee</b> em ETH (custo variável da rede)</div>
                        <div>④ Aguardar a confirmação on-chain (~30s)</div>
                    </div>
                    <p style="margin:10px 0 0; color:#555566; font-size:0.48rem;">O controle e o custo são <b style="color:#fff;">inteiramente seus</b>. O Drop Station nunca cobra taxas de mint — apenas o gás da rede Ethereum.</p>
                </div>

                <!-- Aviso de simulação -->
                <div style="background:#1a0033; border:1px dashed #9933ff55; padding:8px 12px; margin-bottom:18px; font-size:0.48rem; color:#9933ff88; text-align:center;">
                    ⚠ MODO SIMULAÇÃO — Nenhuma transação real será executada.
                    <br>A integração com MetaMask será ativada em breve.
                </div>

                <!-- Botões -->
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button class="btn-action" style="border-color:#9933ff; color:#9933ff; flex:1;"
                        onclick="simulateMintAttempt('${cardId}')">
                        🦊 SIMULAR MINT COM METAMASK
                    </button>
                    <button class="btn-action" style="border-color:#333344; color:#555566;"
                        onclick="document.getElementById('tokenizeOverlay').remove()">
                        CANCELAR
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    /** Simula o fluxo de mint — não faz nenhuma transação real. */
    function simulateMintAttempt(cardId) {
        const overlay = document.getElementById('tokenizeOverlay');
        if (overlay) overlay.remove();

        // Abre o modal de inspect novamente com confirmação simulada
        showCyberAlert(
            '⬡ METAMASK // SIMULAÇÃO',
            `<div style="font-family:'Space Mono',monospace; font-size:0.55rem; line-height:2; text-align:left;">
                <div style="color:#9933ff; margin-bottom:8px;">> CONECTANDO CARTEIRA...</div>
                <div>> CARTEIRA: 0x71C7...4F3a <span style="color:#00ff66;">✓ CONECTADA</span></div>
                <div>> REDE: Ethereum Mainnet</div>
                <div>> GAS ESTIMADO: ~0.0018 ETH (~$4.20)</div>
                <div style="color:#ffaa00; margin-top:8px;">> AGUARDANDO ASSINATURA...</div>
                <div style="color:#555566; font-size:0.45rem; margin-top:10px;">
                    [ Integração real será ativada na próxima fase do projeto. ]<br>
                    Teu card <b>${cardId}</b> já tem hash e timestamp registrados e estará pronto para mint quando o contrato for implantado.
                </div>
            </div>`,
            'success'
        );
    }

    function triggerLogoGlitch() {
        const logo = document.getElementById('appLogo');
        if (!logo) return;
        logo.classList.add('logo-shortcircuit');
        playElectricZap();
        setTimeout(() => logo.classList.remove('logo-shortcircuit'), 450);
    }

    function startLogoGlitchLoop() {
        setInterval(() => {
            // dispara aleatoriamente, em média a cada ~20-40s
            if (Math.random() < 0.35) triggerLogoGlitch();
        }, 12000);
    }
    startLogoGlitchLoop();

    function executeHardwareRoll(isPremium) {
        if (isRolling) return;
        // PREMIUM_DROP_PASS: bloqueia imediatamente se deslogado
        if (isPremium && !currentUser.loggedIn) {
            showCyberAlert('ACESSO_NEGADO:', currentLang === 'PT'
                ? 'O PREMIUM_DROP_PASS requer autenticação de rede. Faça login para continuar.'
                : 'PREMIUM_DROP_PASS requires network authentication. Login to proceed.', 'error');
            return;
        }
        if (isPremium && currentUser.bumps < 50) { openDepositModal(); return; }
        if (isPremium) currentUser.bumps -= 50;

        isRolling = true; 
        activeAssetData = null;
        downloadBtn.style.display = "none"; 
        clearInterval(decayInterval);
        
        document.getElementById('status-text').innerText = currentLang === 'PT' ? "MINTANDO_DADOS..." : "MINTING_DATA...";
        targetContainer.className = "target-box rolling"; 
        stabilityWrapper.style.display = "block";

        document.getElementById('btnFree').classList.add('disabled');
        document.getElementById('btnPremium').classList.add('disabled');

        const generatedId = "#" + Math.floor(100000 + Math.random() * 900000);
        metaId.innerText = generatedId;

        let tickTimes = 0;
        let tickInterval = setInterval(() => { 
            if(tickTimes < 10) { 
                playSynthSound('roll'); 
                tickTimes++; 
            } 
        }, 100);

        setTimeout(() => {
            clearInterval(tickInterval);
            targetContainer.classList.remove("rolling");
            document.getElementById('btnFree').classList.remove('disabled');
            document.getElementById('btnPremium').classList.remove('disabled');

            if (preloadedCanvases.length === 0) { isRolling = false; return; }
            const sourceBuffer = preloadedCanvases[Math.floor(Math.random() * preloadedCanvases.length)];
            const bakedBuffer = document.createElement('canvas'); bakedBuffer.width = 600; bakedBuffer.height = 600;
            const bCtx = bakedBuffer.getContext('2d');

            let watermarkColor = "#ffffff"; 
            let rarityKey = "common"; 
            let rarityName = "COMUM"; 
            let rarityNameEN = "COMMON";
            let claimCost = 0;
            let filterStyle = "none"; 
            let styleName = "CYBER PUNK";
            let styleNameEN = "CYBER PUNK";

            let randRarity = Math.random();
            if (!isPremium && randRarity < 0.15) { shatterAsset(); isRolling = false; return; }

            const visualStylesPT = ["CHROME DECAY", "GOTHIC APOCALYPSE", "VIRTUAL OVERDRIVE", "ROSE PHANTOM", "RETRO GLITCH", "BINARY DEEP"];
            const visualStylesEN = ["CHROME DECAY", "GOTHIC APOCALYPSE", "VIRTUAL OVERDRIVE", "ROSE PHANTOM", "RETRO GLITCH", "BINARY DEEP"];
            const visualFilters = [
                "contrast(180%) saturate(30%) invert(10%)",
                "grayscale(100%) brightness(120%) contrast(200%)",
                "sepia(80%) hue-rotate(320deg) saturate(300%)",
                "hue-rotate(60deg) saturate(180%) invert(5%)",
                "invert(100%) hue-rotate(180deg)",
                "saturate(400%) contrast(150%)"
            ];
            let styleIndex = Math.floor(Math.random() * visualStylesPT.length);

            // TAXAS EXACTAS: 1% ANCESTRAL, 1% LEGENDARY, 14% EPIC, 84% COMMON
            let rarityRoll = Math.random();
            const epicThreshold = networkOverloadActive
                ? Math.min(0.02 + 0.14 * NETWORK_OVERLOAD_EPIC_MULTIPLIER, 0.6)
                : 0.16;
            if (rarityRoll < 0.01) {
                rarityKey = "ancestral";
            } else if (rarityRoll < 0.02) {
                rarityKey = "legendary";
            } else if (rarityRoll < epicThreshold) {
                rarityKey = "epic";
            } else {
                rarityKey = "common";
            }

            rarityName   = rarityKey === "ancestral" ? "ANCESTRAL" : rarityKey === "legendary" ? "LENDÁRIO" : rarityKey === "epic" ? "ÉPICO" : "COMUM";
            rarityNameEN = rarityKey === "ancestral" ? "ANCESTRAL" : rarityKey === "legendary" ? "LEGENDARY" : rarityKey === "epic" ? "EPIC" : "COMMON";
            watermarkColor = rarityKey === "ancestral" ? "#ff007f" : rarityKey === "legendary" ? "#00ffff" : rarityKey === "epic" ? "#ffaa00" : "#ffffff";

            // Flash de tela Ancestral: rosa se sucesso
            if (rarityKey === "ancestral") {
                triggerAncestralFlash('#ff007f');
            }

            // Atualiza a cotação global do mercado em tempo real a cada drop
            updateMarketQuotes(rarityKey);

            if (rarityKey === "ancestral") {
                filterStyle = "hue-rotate(300deg) saturate(400%) contrast(130%) brightness(90%)";
                styleName   = "ROSA PHANTASMA";
                styleNameEN = "ROSE PHANTASMA";
                if(!isPremium) claimCost = 50;
            } else if (rarityKey !== "common") {
                filterStyle = rarityKey === "legendary" ? "hue-rotate(210deg) saturate(250%) contrast(120%)" : "hue-rotate(140deg) saturate(200%) brightness(90%)";
                styleName = rarityKey === "legendary" ? "NEON GHOST" : "ACID GLITCH";
                styleNameEN = rarityKey === "legendary" ? "NEON GHOST" : "ACID GLITCH";
                if(!isPremium) claimCost = 50;
            } else {
                filterStyle = visualFilters[styleIndex];
                styleName = visualStylesPT[styleIndex];
                styleNameEN = visualStylesEN[styleIndex];
            }

            targetContainer.className = "target-box";
            targetContainer.classList.add(`card-${rarityKey}`);

            metaRarity.innerText = currentLang === 'PT' ? rarityName : rarityNameEN; 
            metaRarity.style.color = watermarkColor;
            metaStyle.innerText = currentLang === 'PT' ? styleName : styleNameEN; 
            metaOwner.innerText = currentUser.loggedIn ? currentUser.username : "RECRUTA";

            bCtx.filter = filterStyle; bCtx.drawImage(sourceBuffer, 0, 0, 600, 600); bCtx.filter = "none";
            bCtx.fillStyle = "rgba(0, 0, 0, 0.75)"; bCtx.fillRect(20, bakedBuffer.height - 52, 160, 36);
            bCtx.fillStyle = watermarkColor; bCtx.font = "bold 24px 'Space Mono'"; bCtx.fillText(generatedId, 30, bakedBuffer.height - 26);

            lastMintedBuffer = bakedBuffer;
            activeAssetData = { 
                id: generatedId, rarityType: rarityKey, rarityName: rarityName, rarityNameEN: rarityNameEN,
                styleName: styleName, styleNameEN: styleNameEN, creator: currentUser.loggedIn ? currentUser.username : "OG DROP", 
                registered: currentUser.loggedIn, exposed: false, forSale: false, price: 0, imgSrc: bakedBuffer.toDataURL(), costToClaim: claimCost 
            };

            globalFeed.unshift({...activeAssetData});
            saveGlobalFeed(globalFeed);
            buildStoriesMarquee();

            downloadBtn.style.display = "block";
            downloadBtn.innerText = claimCost > 0 ? 
                (currentLang === 'PT' ? `RESGATAR (CUSTO: 50 B$)` : `CLAIM (COST: 50 B$)`) : 
                (currentLang === 'PT' ? "ENVIAR AO COFRE VIRTUAL" : "SEND TO SECURE VAULT");
            
            document.getElementById('status-text').innerText = currentLang === 'PT' ? "MUTAÇÃO_ESTÁVEL" : "MUTATION_STABLE";
            
            playSynthSound('success'); 
            speakPhrase("Mutação bem sucedida! Resgate o ativo.", "Mutation successful! Claim the asset.");
            startStabilityDecay(); 
            isRolling = false;
        }, 1200);
    }

    function startStabilityDecay() {
        let timeLeft = 10.0; clearInterval(decayInterval);
        decayInterval = setInterval(() => {
            timeLeft -= 0.1;
            if (timeLeft <= 0) { 
                clearInterval(decayInterval); 
                shatterAsset(); 
                return;
            }
            stabilityBar.style.width = `${(timeLeft / 10) * 100}%`;
            stabilityLabel.innerText = currentLang === 'PT' ? 
                `EXPIRA EM: ${timeLeft.toFixed(1)}s [CONSOLIDE ANTES DO COLLAPSE]` : 
                `EXPIRES IN: ${timeLeft.toFixed(1)}s [CONSOLIDATE BEFORE COLLAPSE]`;
        }, 100);
    }

    function shatterAsset() {
        playSynthSound('shatter');
        speakPhrase("Mutação destruída.", "Mutation destroyed.");
        if(activeAssetData) { globalFeed = globalFeed.filter(a => a.id !== activeAssetData.id); saveGlobalFeed(globalFeed); buildStoriesMarquee(); }
        
        downloadBtn.style.display = "none";
        targetContainer.className = "target-box shattering";
        
        stabilityLabel.innerText = currentLang === 'PT' ? "MUTAÇÃO CORROMPIDA // COLLAPSE" : "MUTATION CORRUPTED // COLLAPSE"; 
        document.getElementById('status-text').innerText = currentLang === 'PT' ? "SISTEMA_AUTODESTRUIDO" : "SYSTEM_SELF_DESTRUCTED";
        
        lastMintedBuffer = null; 
        activeAssetData = null;
        setTimeout(() => { targetContainer.classList.remove("shattering"); }, 800);
    }

    // claimAssetLogic agora vem da Parte 2 (Supabase), no final do arquivo.

    function buildStoriesMarquee() {
        const container = document.getElementById('storiesContainer'); 
        if(!container) return;
        container.innerHTML = '';
        if(globalFeed.length === 0) return;
        
        const displayItems = globalFeed.length > 4 ? [...globalFeed, ...globalFeed] : globalFeed;

        displayItems.forEach((a) => {
            const node = document.createElement('div');
            node.className = 'story-node';
            node.addEventListener('click', () => openInspectModal(a));
            node.innerHTML = `
                <div class="story-avatar-wrapper rare-${a.rarityType}"><img src="${a.imgSrc}"></div>
                <div class="story-meta">${a.creator}<br><b>${a.id}</b></div>
            `;
            container.appendChild(node);
        });
    }

    function renderVaultGrid() {
        const grid = document.getElementById('albumGrid'); if(!grid) return;
        const freshGrid = grid.cloneNode(false);
        grid.parentNode.replaceChild(freshGrid, grid);
        const g = document.getElementById('albumGrid');

        document.getElementById('vault-count-badge').innerText = `${savedAssets.length} ATIVOS`;

        const filtered = vaultFilter === 'all' ? savedAssets : savedAssets.filter(a => a.rarityType === vaultFilter);
        const pageItems = filtered.slice(vaultPage * PAGE_SIZE, (vaultPage + 1) * PAGE_SIZE);

        if(filtered.length === 0) { g.innerHTML = '<div class="empty-vault-notice">NENHUM ATIVO NESTA CATEGORIA.</div>'; renderPagination('vaultPagination',0,0,()=>{}); return; }

        pageItems.forEach((a) => {
            const index = savedAssets.indexOf(a);
            const card = document.createElement('div');
            card.className = `album-card rare-${a.rarityType}`;
            card.dataset.vaultIndex = index;
            const custodyBadge = a.isListed ? `<div style="position:absolute;top:-5px;left:-5px;background:#ff0044;color:#fff;font-size:0.5rem;padding:2px 6px;font-weight:bold;z-index:5;box-shadow:0 0 8px #ff0044;">🔒 EM CUSTÓDIA</div>` : '';

            // Badge Web3: indicador discreto se card tem proveniência
            const prov = a.provenance;
            const web3Badge = prov && !a.isTokenized
                ? `<div class="card-provenance-strip" title="Hash: ${prov.hash} | ${new Date(prov.timestamp).toLocaleString('pt-BR')}">
                       <span class="provenance-hash">${prov.hash}</span>
                       <span class="provenance-dot">⬡</span>
                   </div>`
                : prov && a.isTokenized
                ? `<div class="card-provenance-strip tokenized-strip" title="NFT Tokenizado">
                       <span class="provenance-hash">${prov.hash}</span>
                       <span class="provenance-dot" style="color:#00ff66;">✓ NFT</span>
                   </div>`
                : '';
            card.innerHTML = `
                ${custodyBadge}
                <div class="album-preview-wrapper"><img src="${a.imgSrc}" draggable="false"></div>
                ${a.forSale ? `<div class="market-badge">${a.price} B$</div>` : ''}
                <div class="album-meta">
                    <div class="album-id">${a.id}</div>
                    <div class="album-rarity" style="color:${a.rarityType==='ancestral'?'#ff007f':a.rarityType==='legendary'?'#00ffff':a.rarityType==='epic'?'#ffaa00':'#aaaaaa'}">${currentLang === 'PT' ? a.rarityName : a.rarityNameEN}</div>
                </div>
                ${web3Badge}
                <div class="card-actions">
                    <button class="btn-action btn-expose" data-action="expose" data-idx="${index}">${a.exposed ? '⭐ Sair da Vitrine' : '📁 Expor na Vitrine'}</button>
                    <button class="btn-action btn-sell"   data-action="sell"   data-idx="${index}" style="border-color:#ffaa00;">${a.forSale ? '⚡ Alterar Preço P2P' : '💵 Vender / Anunciar'}</button>
                    <button class="btn-action btn-gift"   data-action="gift"   data-idx="${index}" style="border-color:#ff00ff;">🎁 Presentear Card</button>
                    <button class="btn-action btn-dl"     data-action="download" data-idx="${index}" style="border-color:#00ffff; color:#00ffff;">⬇ DOWNLOAD ASSET</button>
                </div>
            `;
            card.querySelector('.album-preview-wrapper').addEventListener('click', () => {
                openInspectModal(savedAssets[parseInt(card.dataset.vaultIndex, 10)]);
            });
            card.querySelector('.card-actions').addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                const idx = parseInt(btn.dataset.idx, 10);
                const action = btn.dataset.action;
                if (action === 'expose')    toggleExposeAsset(idx);
                else if (action === 'sell') marketListPrompt(idx);
                else if (action === 'gift') giftAssetPrompt(idx);
                else if (action === 'download') downloadVaultAsset(idx);
            });
            g.appendChild(card);
        });

        renderPagination('vaultPagination', filtered.length, vaultPage, (p) => { vaultPage = p; renderVaultGrid(); });
    }

    // toggleExposeAsset agora vem da Parte 2 (Supabase), no final do arquivo.

    async function marketListPrompt(index) {
        if (savedAssets[index].isListed) {
            playSynthSound('shatter');
            showCyberAlert('🔒 ATIVO BLOQUEADO EM CUSTÓDIA NO MERCADO', 'Este card já está em custódia no mercado. Remove o anúncio primeiro.', 'error');
            return;
        }
        const price = prompt("Insira o valor de venda em Bumps (B$):", savedAssets[index].price || 100);
        if (price === null) return; const parsed = parseInt(price);
        if (isNaN(parsed) || parsed <= 0) { showCyberAlert('ERRO DE INPUT', 'Valor de venda inválido. Insere um número positivo.', 'error'); return; }

        // listCardOnMarket persiste no Supabase (cards.for_sale / is_listed / price)
        // e já atualiza savedAssets[index] em memória (mesma referência de objeto).
        const ok = await listCardOnMarket(savedAssets[index], parsed);
        if (!ok) {
            showCyberAlert('ERRO_DE_REDE', 'Falha ao listar o card no mercado. Tenta novamente.', 'error');
            return;
        }

        // Ledger (Ponto 4)
        pushLedger(`${currentUser.username} listou o card ${savedAssets[index].id} [${savedAssets[index].rarityNameEN}] por ${parsed} B$`);

        renderVaultGrid();
    }

    async function giftAssetPrompt(index) {
        const targetUser = prompt("Digite o @username exato do destinatário da rede (Ex: @cyber_k1ng):");
        if (!targetUser) return;
        if (!targetUser.startsWith('@')) { showCyberAlert('FORMATO INVÁLIDO', 'O username deve iniciar com @', 'error'); return; }

        const targetProfile = await fetchProfileByUsername(targetUser);
        if (!targetProfile) {
            showCyberAlert('ERRO_REDE', 'Esse nó de usuário não existe ou está desconectado.', 'error'); return;
        }

        const giftedCard = savedAssets[index];
        let targetObject = { ...giftedCard };
        delete targetObject._dbId; // será uma linha nova no Supabase, dono diferente
        targetObject.creator = targetUser;
        targetObject.exposed = false;
        targetObject.forSale = false;

        // ── SUPABASE: cria a cópia na conta do destinatário, depois apaga a original ──
        const inserted = await insertCardToSupabase(targetObject, targetProfile.id);
        if (!inserted) {
            showCyberAlert('ERRO_DE_REDE', 'Falha ao transferir o card. Tenta novamente.', 'error');
            return;
        }
        if (giftedCard._dbId) await deleteCardFromSupabase(giftedCard._dbId);

        savedAssets.splice(index, 1);

        // Efeito sonoro de presente
        playSynthSound('success');
        setTimeout(() => playSynthSound('success'), 200);

        // TTS — aviso de presente enviado
        speakPhrase("Presente enviado com sucesso. Lootbox entregue.", "New Lootbox Detected. Gift delivered successfully.");

        // Alerta cyber customizado
        showCyberAlert(
            '🎁 LOOTBOX ENTREGUE',
            `Card <b>${giftedCard.id}</b> [${giftedCard.rarityNameEN}] foi transferido para <b>${targetUser}</b>.<br><small style="color:#666;">O destinatário receberá o alerta ao abrir o cofre.</small>`,
            'success'
        );

        pushLedger(`${currentUser.username} presenteou ${targetUser} com o card ${giftedCard.id} [${giftedCard.rarityNameEN}]`);
        renderVaultGrid();
    }

    // Dispara alerta + TTS quando um presente é detectado no cofre ao login
    function checkIncomingGifts(prevAssets, newAssets) {
        if (!prevAssets || !newAssets) return;
        // Segunda camada de proteção: se não havia estado anterior nesta
        // sessão (cofre vazio antes do login), não há base de comparação
        // confiável — evita interpretar o cofre inicial do usuário como "presente".
        if (prevAssets.length === 0) return;
        const prevIds = new Set(prevAssets.map(a => a.id));
        const incoming = newAssets.filter(a => !prevIds.has(a.id));
        if (incoming.length === 0) return;
        incoming.forEach(gift => {
            setTimeout(() => {
                playSynthSound('success');
                speakPhrase("Presente Recebido. Novo Lootbox detectado.", "New Lootbox Detected. Gift received.");
                showCyberAlert(
                    '🎁 NEW LOOTBOX DETECTED',
                    `Um presente chegou ao teu cofre!<br>Card <b>${gift.id}</b> — <span style="color:${gift.rarityType==='legendary'?'#00ffff':gift.rarityType==='epic'?'#ffaa00':'#aaa'}">${gift.rarityNameEN}</span>`,
                    'success'
                );
            }, 800);
        });
    }

    async function renderMarketGrid() {
        const grid = document.getElementById('marketGrid'); if(!grid) return;
        grid.innerHTML = '<div class="empty-vault-notice">CARREGANDO MERCADO...</div>';

        // Fonte de verdade real: tabela `cards` (for_sale + is_listed = true).
        marketAssets = await loadMarketFromSupabase();

        document.getElementById('market-count-badge').innerText = `${marketAssets.length} CARDS`;

        const filtered = marketFilter === 'all' ? marketAssets : marketAssets.filter(a => a.rarityType === marketFilter);
        const pageItems = filtered.slice(marketPage * PAGE_SIZE, (marketPage + 1) * PAGE_SIZE);

        grid.innerHTML = '';
        if(filtered.length === 0) { grid.innerHTML = '<div class="empty-vault-notice">NENHUM ATIVO NESTA CATEGORIA.</div>'; renderPagination('marketPagination',0,0,()=>{}); return; }

        pageItems.forEach((a) => {
            const card = document.createElement('div');
            card.className = `album-card rare-${a.rarityType}`;
            card.innerHTML = `
                <div class="album-preview-wrapper"><img src="${a.imgSrc}"></div>
                <div class="album-meta">
                    <div class="album-id">${a.id} <span style="font-size:0.6rem; color:#00ff66; cursor:pointer;" class="ext-profile">by ${a.creator}</span></div>
                    <div class="album-price">${a.price} B$</div>
                </div>
                <div class="card-actions"></div>
            `;
            card.querySelector('.album-preview-wrapper').addEventListener('click', () => {
                openInspectModal(marketAssets.find(m => m.id === a.id));
            });
            card.querySelector('.ext-profile').addEventListener('click', () => viewExternalProfile(a.creator));

            const actionsZone = card.querySelector('.card-actions');
            if (!currentUser.loggedIn) {
                const loginBtn = document.createElement('button');
                loginBtn.className = 'btn-action'; loginBtn.style.cssText = "border-color:#00ff66;";
                loginBtn.innerText = "LOGIN PARA INTERAGIR";
                loginBtn.addEventListener('click', () => navigateTo('auth'));
                actionsZone.appendChild(loginBtn);
            } else if (a.creator !== currentUser.username) {
                const buyBtn = document.createElement('button');
                buyBtn.className = 'btn-action'; buyBtn.style.cssText = "background:#ffaa00; color:#000;";
                buyBtn.innerText = "COMPRAR DIRETO";
                buyBtn.addEventListener('click', () => buyMarketAsset(a));

                const tradeBtn = document.createElement('button');
                tradeBtn.className = 'btn-action'; tradeBtn.style.borderColor = '#ff00ff';
                tradeBtn.innerText = "PROPOR TROCA / CHAT";
                tradeBtn.addEventListener('click', () => initiateTradeContact(a.creator, a.id));

                actionsZone.appendChild(buyBtn);
                actionsZone.appendChild(tradeBtn);
            } else {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'btn-action'; removeBtn.style.borderColor = '#ff0044';
                removeBtn.innerText = "REMOVER ANÚNCIO";
                removeBtn.addEventListener('click', () => removeAssetFromMarket(a));
                actionsZone.appendChild(removeBtn);
            }
            grid.appendChild(card);
        });

        renderPagination('marketPagination', filtered.length, marketPage, (p) => { marketPage = p; renderMarketGrid(); });
    }

    // `asset` aqui é um objeto vindo de marketAssets (já tem _dbId, pois veio
    // de rowToCard via loadMarketFromSupabase).
    async function buyMarketAsset(asset) {
        if (!asset) return;
        if (!currentUser.loggedIn) { navigateTo('auth'); return; }

        if (currentUser.bumps < asset.price) {
            playTerminalSound('error');
            showCyberAlert('FUNDOS INSUFICIENTES', `Saldo actual: <b>${currentUser.bumps} B$</b><br>Custo do ativo: <b>${asset.price} B$</b><br><br>Carregue o saldo no teu perfil.`, 'warn');
            return;
        }

        const sellerName = asset.creator;

        // buyCardFromMarket faz a transação inteira de forma atômica no banco
        // (débito do comprador, crédito do vendedor, transferência da linha
        // do card) via a function security definer buy_market_card — não dá
        // pra fazer isso com updates diretos porque a RLS de `cards` só
        // libera update para o dono da linha.
        const result = await buyCardFromMarket(asset._dbId);
        if (!result.ok) return; // buyCardFromMarket já mostra o alerta de erro

        // Reflete o card recém-adquirido no cofre local (currentUser já é o dono na linha do banco)
        savedAssets.push(result.card);

        // Ledger (Ponto 4)
        pushLedger(`${currentUser.username} comprou o card ${asset.id} de ${sellerName} por ${asset.price} B$`);

        // Regista notificação para comprador e vendedor
        const dateStr = new Date().toLocaleString('pt-PT');
        pushNotification(currentUser.username, `Comprou ${asset.id} por ${asset.price} B$ de ${sellerName} — ${dateStr}`);
        pushNotification(sellerName, `Vendeu ${asset.id} por ${asset.price} B$ para ${currentUser.username} — ${dateStr}`);

        // Alerta cyberpunk de sucesso
        playSynthSound('success');
        showCyberAlert(
            '// TRANSFERÊNCIA DE ATIVOS CONCLUÍDA //',
            `Card <b>${asset.id}</b> adicionado ao teu cofre.<br>
             Débito: <b>-${asset.price} B$</b> &nbsp;|&nbsp; Saldo actual: <b>${currentUser.bumps} B$</b><br>
             Vendedor <b>${sellerName}</b> recebeu <b>+${asset.price} B$</b>.`,
            'success'
        );

        renderMarketGrid();
    }

    // `asset` aqui é um objeto vindo de marketAssets (já tem _dbId).
    async function removeAssetFromMarket(asset) {
        if (!asset) return;
        const ok = await unlistCardFromMarket(asset);
        if (!ok) {
            showCyberAlert('ERRO_DE_REDE', 'Falha ao remover o anúncio. Tenta novamente.', 'error');
            return;
        }
        // Espelha a mudança no objeto correspondente em savedAssets (cofre local),
        // caso seja o mesmo card que o usuário tem carregado em memória.
        const vaultItem = savedAssets.find(m => m.id === asset.id);
        if (vaultItem) { vaultItem.forSale = false; vaultItem.exposed = false; vaultItem.isListed = false; }
        renderMarketGrid();
    }

    function openInspectModal(cardAsset) {
        if(!cardAsset) return;
        const ownerName = cardAsset.creator || cardAsset.owner;

        document.getElementById('inspectImg').src = cardAsset.imgSrc;
        document.getElementById('inspectTitle').innerText = `INSPECT // ${cardAsset.id}`;

        // CRT glow baseado na raridade
        const rarityColors = {
            legendary: '#00ffff',
            epic:      '#ffaa00',
            ancestral: '#ff007f',
            common:    '#aaaaaa'
        };
        const rarityColor = rarityColors[cardAsset.rarityType] || '#aaaaaa';

        const glow = document.getElementById('holoGlow');
        glow.style.display = 'block';
        glow.style.background = `radial-gradient(circle, ${rarityColor}55 0%, transparent 70%)`;

        // Aplica borda/glow CRT ao modal conforme raridade
        const modalCard = document.querySelector('.modal-card');
        if (modalCard) {
            modalCard.style.borderColor = rarityColor;
            modalCard.style.boxShadow = `0 0 30px ${rarityColor}55, inset 0 0 20px ${rarityColor}11, 0 0 2px ${rarityColor}`;
        }

        // Linhas decorativas CRT injetadas acima dos metadados
        const crtLines = [
            `> SYS // INTEGRIDADE: OPERACIONAL`,
            `> NET // AUTENTICIDADE: VERIFICADA`,
            `> ID  // CHAIN: CRIPTOGRAFADO`,
            `> RNG // SEED: ${cardAsset.id}`,
        ];

        let ownerItems = globalFeed.filter(f => f.creator === ownerName);
        let score = ownerItems.length * 5;

        const metaBox = document.getElementById('inspectMetaBox');
        metaBox.innerHTML = `
            <div class="inspect-crt-lines" style="
                font-size:0.5rem; color:${rarityColor}88; margin-bottom:10px;
                border:1px solid ${rarityColor}33; padding:6px 10px;
                background: rgba(0,0,0,0.6);
                font-family:'Space Mono',monospace; letter-spacing:1px;
                line-height:1.8;
            ">${crtLines.map(l => `<div>${l}</div>`).join('')}</div>
            <b>CÓDIGO IDENTIFICADOR:</b> ${cardAsset.id}<br>
            <b>ESTILO VISUAL:</b> ${currentLang === 'PT' ? cardAsset.styleName : (cardAsset.styleNameEN || cardAsset.styleName)}<br>
            <b>RARIDADE DO ATIVO:</b> <span style="color:${rarityColor}">${(currentLang === 'PT' ? cardAsset.rarityName : cardAsset.rarityNameEN).toUpperCase()}</span><br>
            <b>NÍVEL DE COLECIONADOR DO PROPRIETÁRIO:</b> LVL ${score || 1}<br>
            <b>DONO DA ASSINATURA:</b> <span style="color:#00ff66; text-decoration:underline; cursor:pointer;" class="inspect-author">${ownerName}</span> (CLIQUE PARA VER PERFIL)<br>
            <b>ESTADO NA REDE:</b> ${cardAsset.registered ? 'CRIPTOGRAFADO EM WALLET' : 'FLUXO VOLÁTIL'}
        `;

        metaBox.querySelector('.inspect-author').addEventListener('click', () => viewExternalProfile(ownerName));

        const zone = document.getElementById('inspectActionZone'); zone.innerHTML = '';
        if (cardAsset.registered && ownerName !== currentUser.username) {
            const btn = document.createElement('button'); btn.className = 'btn-action'; btn.style.borderColor = '#ff00ff';
            btn.innerText = `💬 ABRIR NEGOCIAÇÃO COM ${ownerName}`;
            btn.onclick = () => { closeInspectModal(); initiateTradeContact(ownerName, cardAsset.id); };
            zone.appendChild(btn);
        }

        // ── PROVENIÊNCIA: exibe hash, timestamp e botão Web3 ──────────
        const prov = cardAsset.provenance;
        const provHtml = prov
            ? `<div class="inspect-provenance-box" style="
                    margin-top:12px; padding:8px 10px; border:1px solid ${rarityColor}33;
                    background:rgba(0,0,0,0.5); font-family:'Space Mono',monospace;
                    font-size:0.48rem; letter-spacing:1px; line-height:1.9; color:#666688;">
                    <div style="color:${rarityColor}; margin-bottom:4px; font-size:0.5rem; font-weight:bold;">// PROVENIÊNCIA INTERNA</div>
                    <div>HASH &nbsp;&nbsp;: <span style="color:#fff;">${prov.hash}</span></div>
                    <div>EMITIDO: <span style="color:#fff;">${new Date(prov.timestamp).toLocaleString('pt-BR')}</span></div>
                    <div>ORIGEM &nbsp;: <span style="color:#fff;">${prov.origin}</span></div>
                    ${prov.parentIds ? `<div>LINHAGEM: <span style="color:#ffaa00;">${prov.parentIds.join(' + ')}</span></div>` : ''}
                    ${cardAsset.isTokenized
                        ? `<div style="color:#00ff66; margin-top:4px;">✓ TOKENIZADO EM NFT</div>`
                        : `<button class="btn-action inspect-web3-btn" style="margin-top:8px; border-color:#9933ff; color:#9933ff; font-size:0.5rem; padding:5px 12px; width:auto;"
                            onclick="showTokenizeModal(${JSON.stringify(cardAsset.id).replace(/"/g,'&quot;')})">
                            ⬡ TOKENIZAR CARD (Web3)
                           </button>`
                    }
               </div>`
            : `<div style="font-size:0.45rem; color:#333344; margin-top:10px; font-family:'Space Mono',monospace;">
                    // sem proveniência registrada (card legado)
               </div>`;

        // Appenda a caixa de proveniência ao metaBox
        const provDiv = document.createElement('div');
        provDiv.innerHTML = provHtml;
        metaBox.appendChild(provDiv);

        // ── QR CODE DINÂMICO: regenera o canvas a cada abertura, refletindo
        // o estado atual (fusion_count / qr_code_hash) do card ──
        if (prov) renderQRCode(cardAsset, 'inspectQrCanvas');
        const qrBox = document.getElementById('inspectQrBox');
        if (qrBox) qrBox.style.display = prov ? 'flex' : 'none';

        document.getElementById('inspectModal').style.display = 'flex';
    }

    function closeInspectModal() {
        // Reseta borda do modal ao fechar
        const modalCard = document.querySelector('.modal-card');
        if (modalCard) {
            modalCard.style.borderColor = '';
            modalCard.style.boxShadow = '';
        }
        document.getElementById('inspectModal').style.display = 'none';
    }

    function rotateCard(e) {
        const card = document.getElementById('card3D'); const box = card.getBoundingClientRect();
        const x = e.clientX - box.left - (box.width/2); const y = e.clientY - box.top - (box.height/2);
        card.style.transform = `rotateY(${x / 5}deg) rotateX(${-y / 5}deg) scale(1.08)`;
    }
    function resetCardRotation() { document.getElementById('card3D').style.transform = `rotateY(0deg) rotateX(0deg) scale(1)`; }

    /* LÓGICA DE NEGOCIAÇÃO INTEGRADA, SISTEMA DE PROPOSTAS E EXIBIÇÃO DE AVATARES */
    function getTradeKey(partnerUsername) {
        // Chave única por par: garante isolamento entre conversas diferentes
        return `trade_${currentUser.username}_${partnerUsername}`;
    }

    function saveThreadToStorage(partnerUsername) {
        try {
            const key = getTradeKey(partnerUsername);
            localStorage.setItem(key, JSON.stringify(messageThreads[partnerUsername]));
        } catch(e) {}
    }

    function loadThreadFromStorage(partnerUsername) {
        try {
            const key = getTradeKey(partnerUsername);
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch(e) { return null; }
    }

    // =========================================================
    // PROPOSTAS GLOBAIS — owner/receiver explícitos (cyber_global_offers)
    // =========================================================
    const GLOBAL_OFFERS_KEY = 'cyber_global_offers';

    function loadGlobalOffers() {
        try { return JSON.parse(localStorage.getItem(GLOBAL_OFFERS_KEY)) || []; } catch(e) { return []; }
    }
    function saveGlobalOffers(offers) {
        try { localStorage.setItem(GLOBAL_OFFERS_KEY, JSON.stringify(offers)); } catch(e) {}
    }

    // owner = quem envia a proposta | receiver = quem deve aceitar/recusar
    function createOffer({ owner, receiver, assetId, bumpsOffered }) {
        if (!owner || !receiver) return null;
        const offers = loadGlobalOffers();
        const offer = {
            id: `offer_${Date.now()}_${Math.floor(Math.random()*9999)}`,
            owner, receiver, assetId, bumpsOffered,
            status: 'pending', // pending | accepted | rejected
            createdAt: Date.now()
        };
        offers.push(offer);
        saveGlobalOffers(offers);
        return offer;
    }

    function renderGlobalOffers(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        if (!currentUser.loggedIn) return;

        const offers = loadGlobalOffers();
        const me = currentUser.username;

        offers.forEach(offer => {
            const isReceiver = offer.receiver === me;
            const isOwner = offer.owner === me;

            // Se não for owner nem receiver, o card NÃO é gerado
            if (!isReceiver && !isOwner) return;

            const card = document.createElement('div');
            card.className = 'offer-card';

            if (isReceiver) {
                card.innerHTML = `
                    <span>Proposta de <b>${offer.owner}</b> — ${offer.bumpsOffered} B$ pelo ativo ${offer.assetId}</span>
                    <span>
                        <button class="btn-action accept-offer">Aceitar</button>
                        <button class="btn-action decline-offer">Recusar</button>
                    </span>
                `;
                card.querySelector('.accept-offer').addEventListener('click', () => updateOfferStatus(offer.id, 'accepted'));
                card.querySelector('.decline-offer').addEventListener('click', () => updateOfferStatus(offer.id, 'rejected'));
            } else {
                const statusLabel = offer.status === 'pending' ? 'Pendente' : (offer.status === 'accepted' ? 'Aceita' : 'Recusada');
                card.innerHTML = `<span>Proposta enviada a <b>${offer.receiver}</b> — ${offer.bumpsOffered} B$ pelo ativo ${offer.assetId} — <b>${statusLabel}</b></span>`;
            }

            container.appendChild(card);
        });
    }

    function updateOfferStatus(offerId, status) {
        const offers = loadGlobalOffers();
        const idx = offers.findIndex(o => o.id === offerId);
        if (idx === -1) return;
        offers[idx].status = status;
        saveGlobalOffers(offers);
        renderGlobalOffers('offersContainer');
    }

    function initiateTradeContact(seller, assetId) {
        if (!currentUser.loggedIn) { navigateTo('auth'); return; }
        
        let assetData = marketAssets.find(m => m.id === assetId) || globalFeed.find(g => g.id === assetId);

        if (!messageThreads[seller]) {
            // Tenta restaurar thread guardada anteriormente para este par
            const savedThread = loadThreadFromStorage(seller);
            if (savedThread) {
                messageThreads[seller] = savedThread;
            } else {
                messageThreads[seller] = {
                    targetAsset: assetData || null,
                    activeProposal: {
                        offeredBumps: 0,
                        offeredAsset: null,
                        proposer: currentUser.username,
                        status: "PENDING"
                    },
                    messages: []
                };
                messageThreads[seller].messages.push({ 
                    sender: 'system', 
                    text: `🔒 Linha segura estabelecida com ${seller} a respeito do Ativo ${assetId}. Use o terminal abaixo para estruturar sua proposta.` 
                });
                saveThreadToStorage(seller);
            }
        }
        
        activeThreadUser = seller; 
        navigateTo('messages');
    }

    function renderChatThreads() {
        const sidebar = document.getElementById('chatSidebarThreads'); if(!sidebar) return;
        sidebar.innerHTML = '';
        const keys = Object.keys(messageThreads);
        document.getElementById('msg-count-badge').innerText = `${keys.length} CONVERSAS`;

        if(keys.length === 0) { sidebar.innerHTML = '<div style="color:#445; font-size:0.6rem; padding:10px;">INBOX VAZIO</div>'; return; }
        
        keys.forEach(k => {
            let thread = messageThreads[k];
            let partnerAvatar = "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg";
            let storedUser = localStorage.getItem(`user_${k}`);
            if(storedUser) partnerAvatar = JSON.parse(storedUser).avatar;

            const div = document.createElement('div'); 
            div.className = `chat-thread-node ${activeThreadUser === k ? 'active' : ''}`;
            div.onclick = () => { 
                // Limpa a proposal box antes de trocar de chat para evitar estado cruzado
                const proposalBox = document.getElementById('dealProposalBox');
                if(proposalBox) { proposalBox.style.display = "none"; }
                const assetBanner = document.getElementById('dealAssetBanner');
                if(assetBanner) { assetBanner.style.display = "none"; }
                
                activeThreadUser = k; 
                renderChatThreads(); 
            }; 
            
            div.innerHTML = `
                <img src="${partnerAvatar}" class="chat-thread-avatar">
                <div class="chat-thread-info">
                    <span class="chat-thread-name">${k}</span>
                    <span style="color:#667; font-size:0.5rem; text-transform:uppercase;">Ativo: ${thread.targetAsset ? thread.targetAsset.id : 'Nenhum'}</span>
                </div>
            `;
            sidebar.appendChild(div);
        });
        
        renderChatWindow();
    }

    function renderChatWindow() {
        const box = document.getElementById('chatMessagesBox'); if(!box) return;
        // Limpa tudo antes de renderizar para evitar qualquer vazamento entre chats
        box.innerHTML = '';

        const assetBanner = document.getElementById('dealAssetBanner');
        const proposalBox = document.getElementById('dealProposalBox');
        const counterPanel = document.getElementById('counterPanelZone');

        // Reset completo dos painéis (isolamento ao trocar de chat)
        if (proposalBox) { proposalBox.style.display = "none"; proposalBox.querySelector && (document.getElementById('dealProposalDetails').innerHTML = ''); }
        if (assetBanner) assetBanner.style.display = "none";
        if (counterPanel) counterPanel.style.display = "none";

        if (!activeThreadUser) {
            box.innerHTML = '<div style="color:#445; font-size:0.7rem; text-align:center; margin-top:50px;">SELECIONE UM CANAL DO TERMINAL CRIPTOGRÁFICO</div>';
            return;
        }

        // Lê sempre do localStorage com chave composta (fonte de verdade isolada por par)
        const freshThread = loadThreadFromStorage(activeThreadUser);
        if (freshThread) {
            messageThreads[activeThreadUser] = freshThread;
        }

        if (!messageThreads[activeThreadUser]) {
            box.innerHTML = '<div style="color:#445; font-size:0.7rem; text-align:center; margin-top:50px;">SELECIONE UM CANAL DO TERMINAL CRIPTOGRÁFICO</div>';
            return;
        }

        let thread = messageThreads[activeThreadUser];

        // 1. Renderiza Informações do Item Sendo Negociado (Topo)
        if(thread.targetAsset) {
            assetBanner.style.display = "flex";
            document.getElementById('dealAssetImg').src = thread.targetAsset.imgSrc;
            document.getElementById('dealAssetTitle').innerText = `${thread.targetAsset.id} (${thread.targetAsset.styleName})`;
            document.getElementById('dealAssetOwner').innerText = `Proprietário: ${thread.targetAsset.creator}`;
            document.getElementById('dealAssetPrice').innerText = `Preço de tabela: ${thread.targetAsset.price} B$`;
        } else {
            assetBanner.style.display = "none";
        }

        // 2. Renderiza o Estado da Proposta Ativa (lido exclusivamente do thread deste par)
        let prop = thread.activeProposal;
        if(prop && prop.status === "PENDING" && (prop.offeredBumps > 0 || prop.offeredAsset)) {
            proposalBox.style.display = "flex";
            let desc = `Ofertado por ${prop.proposer}: **${prop.offeredBumps} B$**`;
            if(prop.offeredAsset) {
                desc += ` + Figurinha [${prop.offeredAsset.id} - ${prop.offeredAsset.rarityName}]`;
            }
            document.getElementById('dealProposalDetails').innerText = desc;

            const buttonsZone = document.getElementById('proposalActionButtonsZone');
            if(prop.proposer === currentUser.username) {
                buttonsZone.innerHTML = `<span style="color:#ffaa00; font-style:italic;">Sua oferta foi enviada. Aguardando decisão do operador oposto...</span>`;
            } else {
                buttonsZone.innerHTML = `
                    <button class="btn-action" style="border-color:#00ff66; background:#04140a;" onclick="acceptCurrentProposal()">ACEITAR OFERTA</button>
                    <button class="btn-action" style="border-color:#ff0044; background:#14040a;" onclick="rejectCurrentProposal()">RECUSAR OFERTA</button>
                `;
            }
        } else if(prop && prop.status === "ACCEPTED") {
            proposalBox.style.display = "flex";
            document.getElementById('dealProposalDetails').innerHTML = `<span style="color:#00ff66; font-weight:bold;">✓ OPERAÇÃO CONCLUÍDA: A PROPOSTA FOI ACEITA E O ATIVO ENVIADO AO RESPECTIVO COFRE!</span>`;
            document.getElementById('proposalActionButtonsZone').innerHTML = '';
        } else if(prop && prop.status === "REJECTED") {
            proposalBox.style.display = "flex";
            document.getElementById('dealProposalDetails').innerHTML = `<span style="color:#ff0044; font-weight:bold;">✕ PROPOSTA RECUSADA. Monte uma contraproposta utilizando o painel inferior.</span>`;
            document.getElementById('proposalActionButtonsZone').innerHTML = '';
        } else {
            proposalBox.style.display = "none";
        }

        // 3. Painel de Contrapropostas
        if(prop && prop.status !== "ACCEPTED") {
            counterPanel.style.display = "flex";
            const selectElement = document.getElementById('counterAssetSelect');
            selectElement.innerHTML = '<option value="">-- NENHUMA FIGURINHA SELECIONADA --</option>';
            savedAssets.forEach((a) => {
                if(thread.targetAsset && a.id === thread.targetAsset.id) return;
                const opt = document.createElement('option');
                opt.value = a.id;
                opt.innerText = `${a.id} - Rarity: ${a.rarityName} (${a.styleName})`;
                selectElement.appendChild(opt);
            });
        } else {
            counterPanel.style.display = "none";
        }

        // 4. Histórico de Mensagens
        thread.messages.forEach(m => {
            const div = document.createElement('div');
            div.className = `msg-bubble ${m.sender === currentUser.username ? 'sent' : 'received'}`;
            div.innerText = m.text;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    }

    function sendChatMessage() {
        const input = document.getElementById('inputChatMsg'); const text = input.value.trim();
        if(!text || !activeThreadUser) return;
        messageThreads[activeThreadUser].messages.push({ sender: currentUser.username, text: text });
        input.value = '';
        saveThreadToStorage(activeThreadUser);
        renderChatWindow();
    }

    /* SISTEMA COMPLETO DE CONTRA-PROPOSTAS E MERCADO P2P DIRECT */
    function submitCounterProposal() {
        if(!activeThreadUser || !messageThreads[activeThreadUser]) return;
        let thread = messageThreads[activeThreadUser];

        if(thread.activeProposal && thread.activeProposal.status === "ACCEPTED") {
            showCyberAlert('LOG_ERRO:', 'Este canal de negociação já foi finalizado com sucesso.', 'error'); return;
        }

        const bumpsOffered = parseInt(document.getElementById('counterBumpsInput').value) || 0;
        const selectedAssetId = document.getElementById('counterAssetSelect').value;

        if(bumpsOffered < 0) { showCyberAlert('LOG_ERRO:', 'Valor inválido de Bumps.', 'error'); return; }
        if(bumpsOffered > currentUser.bumps) { showCyberAlert('ACESSO_NEGADO:', 'Você não possui saldo de Bumps suficiente em conta para cobrir esta proposta.', 'error'); return; }

        let assetObject = null;
        if(selectedAssetId) {
            assetObject = savedAssets.find(a => a.id === selectedAssetId);
        }

        // Sobrescreve proposta ativa com a contraproposta
        thread.activeProposal = {
            offeredBumps: bumpsOffered,
            offeredAsset: assetObject ? {...assetObject} : null,
            proposer: currentUser.username,
            status: "PENDING"
        };

        // PROPOSTA GLOBAL: owner = quem envia, receiver = quem deve aceitar/recusar
        const offerRecord = createOffer({
            owner: currentUser.username,
            receiver: activeThreadUser,
            assetId: assetObject ? assetObject.id : null,
            bumpsOffered
        });
        thread.activeProposal.globalOfferId = offerRecord ? offerRecord.id : null;

        // Adiciona registro estruturado na caixa de mensagens
        let logMsg = `⚙️ CONTRAPROPOSTA ENVIADA POR ${currentUser.username}: Ofertou ${bumpsOffered} B$`;
        if(assetObject) logMsg += ` + Figurinha [${assetObject.id}]`;
        thread.messages.push({ sender: currentUser.username, text: logMsg });

        // Ledger global (Ponto 4)
        pushLedger(`${currentUser.username} enviou proposta a ${activeThreadUser}: ${bumpsOffered} B$${assetObject ? ' + ' + assetObject.id : ''}`);

        document.getElementById('counterBumpsInput').value = '';
        playSynthSound('success');
        saveThreadToStorage(activeThreadUser);
        renderChatWindow();
    }

    function acceptCurrentProposal() {
        if(!activeThreadUser || !messageThreads[activeThreadUser]) return;
        let thread = messageThreads[activeThreadUser];
        let prop = thread.activeProposal;

        if(!thread.targetAsset) return;

        let buyerName = prop.proposer;
        let sellerName = thread.targetAsset.creator;

        // Se o atual usuário logado é quem vai receber os Bumps e figurinhas (Dono do Card Alvo)
        if(currentUser.username === sellerName) {
            // Verifica se o comprador fictício tem fundos no ambiente simulado
            let storedBuyer = localStorage.getItem(`user_${buyerName}`);
            let buyerData = storedBuyer ? JSON.parse(storedBuyer) : null;

            if(buyerData && buyerData.bumps < prop.offeredBumps) {
                showCyberAlert('ERRO_REDE:', `O comprador ${buyerName} não possui fundos suficientes no momento.`, 'error'); return;
            }

            // Transfere o Card Alvo para o Comprador
            let assetToTransfer = savedAssets.find(s => s.id === thread.targetAsset.id);
            if(!assetToTransfer) { showCyberAlert('LOG_ERRO:', 'Você já não possui mais este ativo no cofre.', 'error'); return; }

            // Executa Trocas Financeiras
            currentUser.bumps += prop.offeredBumps;
            if(buyerData) buyerData.bumps -= prop.offeredBumps;

            // Remove o Card Alvo do vendedor
            savedAssets = savedAssets.filter(s => s.id !== assetToTransfer.id);
            marketAssets = marketAssets.filter(m => m.id !== assetToTransfer.id);

            // Adiciona o Card Alvo ao comprador
            assetToTransfer.creator = buyerName;
            assetToTransfer.forSale = false;
            assetToTransfer.exposed = false;
            if(buyerData) {
                if(!buyerData.savedAssets) buyerData.savedAssets = [];
                buyerData.savedAssets.push(assetToTransfer);
            }

            // Se houve Figurinha envolvida na troca, remove do comprador e passa para o vendedor atual
            if(prop.offeredAsset) {
                if(buyerData && buyerData.savedAssets) {
                    buyerData.savedAssets = buyerData.savedAssets.filter(b => b.id !== prop.offeredAsset.id);
                }
                let extraAsset = prop.offeredAsset;
                extraAsset.creator = currentUser.username;
                extraAsset.forSale = false;
                extraAsset.exposed = false;
                savedAssets.push(extraAsset);
            }

            // Atualiza bases de dados do LocalStorage
            const myKey = `user_${currentUser.username}`;
            const myData = JSON.parse(localStorage.getItem(myKey));
            if(myData) { myData.savedAssets = savedAssets; myData.bumps = currentUser.bumps; localStorage.setItem(myKey, JSON.stringify(myData)); }
            if(buyerData) localStorage.setItem(`user_${buyerName}`, JSON.stringify(buyerData));

        } else {
            // Caso o Usuário Atual seja o COMPRADOR aceitando uma oferta/contraproposta vinda do Dono do Card
            if(currentUser.bumps < prop.offeredBumps) { showCyberAlert('ACESSO_NEGADO:', 'Seu saldo de Bumps é insuficiente.', 'error'); return; }
            
            let storedSeller = localStorage.getItem(`user_${sellerName}`);
            let sellerData = storedSeller ? JSON.parse(storedSeller) : null;

            if(sellerData) {
                let sellerAsset = sellerData.savedAssets.find(s => s.id === thread.targetAsset.id);
                if(!sellerAsset) { showCyberAlert('LOG_ERRO:', 'O vendedor não possui mais este ativo no cofre.', 'error'); return; }

                // Deduz recursos do comprador atual
                currentUser.bumps -= prop.offeredBumps;
                sellerData.bumps += prop.offeredBumps;

                // Transfere Card Alvo para o Comprador atual
                sellerData.savedAssets = sellerData.savedAssets.filter(s => s.id !== thread.targetAsset.id);
                marketAssets = marketAssets.filter(m => m.id !== thread.targetAsset.id);
                
                let assetToGet = {...sellerAsset};
                assetToGet.creator = currentUser.username;
                assetToGet.forSale = false;
                assetToGet.exposed = false;
                savedAssets.push(assetToGet);

                // Se houver figurinha de troca do comprador atual saindo
                if(prop.offeredAsset) {
                    savedAssets = savedAssets.filter(s => s.id !== prop.offeredAsset.id);
                    let giftAsset = prop.offeredAsset;
                    giftAsset.creator = sellerName;
                    giftAsset.forSale = false;
                    giftAsset.exposed = false;
                    sellerData.savedAssets.push(giftAsset);
                }

                // Salva estados permanentes
                const myKey = `user_${currentUser.username}`;
                const myData = JSON.parse(localStorage.getItem(myKey));
                if(myData) { myData.savedAssets = savedAssets; myData.bumps = currentUser.bumps; localStorage.setItem(myKey, JSON.stringify(myData)); }
                localStorage.setItem(`user_${sellerName}`, JSON.stringify(sellerData));
            }
        }

        prop.status = "ACCEPTED";
        if (prop.globalOfferId) updateOfferStatus(prop.globalOfferId, 'accepted');
        thread.messages.push({ sender: 'system', text: `✓ ACORDO COMINADO. Transações de rede liquidadas e registradas.` });
        playSynthSound('success');
        saveThreadToStorage(activeThreadUser);
        renderChatWindow();
    }

    function rejectCurrentProposal() {
        if(!activeThreadUser || !messageThreads[activeThreadUser]) return;
        let thread = messageThreads[activeThreadUser];
        thread.activeProposal.status = "REJECTED";
        if (thread.activeProposal.globalOfferId) updateOfferStatus(thread.activeProposal.globalOfferId, 'rejected');
        thread.messages.push({ sender: currentUser.username, text: `✕ A proposta ativa na mesa de negociação foi rejeitada.` });
        playSynthSound('shatter');
        saveThreadToStorage(activeThreadUser);
        renderChatWindow();
    }

    // =========================================================
    // DOWNLOAD DO ASSET (Ponto 6)
    // =========================================================
    function downloadVaultAsset(index) {
        const asset = savedAssets[index];
        if (!asset) return;
        // Só o dono real pode fazer download
        if (asset.creator !== currentUser.username) {
            showCyberAlert('ACESSO NEGADO', 'Apenas o dono original pode descarregar este ativo.', 'error');
            return;
        }
        // Abre a imagem numa nova aba (dispara download se for data URI ou link)
        const a = document.createElement('a');
        a.href = asset.imgSrc;
        // Se for data URI (card gerado), dispara download direto
        if (asset.imgSrc.startsWith('data:')) {
            a.download = `dr0p_${asset.id.replace('#','')}_${asset.rarityType}.png`;
            a.click();
        } else {
            // URL externa: abre em nova aba
            window.open(asset.imgSrc, '_blank');
        }
    }

    // =========================================================
    // ALQUIMIA — FUSÃO DE 2 CARDS COM PROBABILIDADE (VAULT ONLY)
    // =========================================================

    // Estado de seleção da galeria de alquimia
    let _alchSelected = { alpha: null, beta: null }; // { id, asset }

    function toggleAlchemyPanel() {
        const panel = document.getElementById('alchemyPanel'); if (!panel) return;
        if (panel.style.display === 'none' || !panel.style.display) {
            if (!currentUser.loggedIn) { showCyberAlert('ACESSO NEGADO', currentLang === 'PT' ? 'Precisas de estar logado para aceder ao laboratório de Alquimia.' : 'Login required to access the Alchemy Lab.', 'error'); return; }
            _alchSelected = { alpha: null, beta: null };
            panel.style.display = 'block';
            openAlchemyPanel();
        } else {
            panel.style.display = 'none';
        }
    }

    function openAlchemyPanel() {
        // Sincroniza os <select> ocultos (mantidos para compatibilidade com fuseCards())
        ['fuseCard1','fuseCard2'].forEach((sid, si) => {
            const sel = document.getElementById(sid); if (!sel) return;
            sel.innerHTML = `<option value="">-- CARD ${si+1} --</option>`;
            savedAssets.forEach(a => {
                if (a.isListed) return;
                const opt = document.createElement('option');
                opt.value = a.id;
                opt.innerText = `${a.id} [${a.rarityNameEN}] ${a.styleName}`;
                sel.appendChild(opt);
            });
        });

        _renderAlchGallery();
        _updateAlchPreviews();
        previewAlchemy();
    }

    /** Cor neon por raridade */
    function _rarityColor(rt) {
        return rt === 'ancestral' ? '#ff007f' : rt === 'legendary' ? '#00ffff' : rt === 'epic' ? '#ffaa00' : '#aaaaaa';
    }

    /** Renderiza a galeria de miniaturas no painel de alquimia */
    function _renderAlchGallery() {
        const grid = document.getElementById('alchGalleryGrid');
        if (!grid) return;
        grid.innerHTML = '';

        const eligible = savedAssets.filter(a => !a.isListed);
        if (eligible.length === 0) {
            grid.innerHTML = '<div style="color:#ff00ff44; font-size:0.55rem; padding:8px; grid-column:1/-1;">Nenhum card disponível para fusão.</div>';
            return;
        }

        eligible.forEach(card => {
            const thumb = document.createElement('div');
            thumb.className = 'alch-thumb';
            thumb.dataset.id = card.id;
            if (card.isLocked) thumb.classList.add('locked-in-contract');

            // Bordas de seleção ativas
            if (_alchSelected.alpha && _alchSelected.alpha.id === card.id) thumb.classList.add('selected-alpha');
            if (_alchSelected.beta  && _alchSelected.beta.id  === card.id) thumb.classList.add('selected-beta');

            const rarColor = _rarityColor(card.rarityType);
            thumb.innerHTML = `
                <img src="${card.imgSrc}" alt="${card.id}">
                <div class="alch-thumb-rarity" style="color:${rarColor};">${(card.rarityNameEN || 'CMN').slice(0,3)}</div>
            `;

            thumb.addEventListener('click', () => _alchThumbClick(card));
            grid.appendChild(thumb);
        });
    }

    /**
     * Lógica de seleção ao clicar num thumb:
     * - Primeiro clique livre → ALPHA (rosa)
     * - Segundo clique (card diferente) → BETA (ciano)
     * - Clicar no mesmo card que já está selecionado → deseleciona esse slot
     * - Se ambos estão cheios e clica num novo → substitui ALPHA e move ALPHA atual para BETA
     */
    function _alchThumbClick(card) {
        if (_alchSelected.alpha && _alchSelected.alpha.id === card.id) {
            // Deseleciona alpha
            _alchSelected.alpha = null;
        } else if (_alchSelected.beta && _alchSelected.beta.id === card.id) {
            // Deseleciona beta
            _alchSelected.beta = null;
        } else if (!_alchSelected.alpha) {
            _alchSelected.alpha = card;
        } else if (!_alchSelected.beta) {
            if (_alchSelected.alpha.id === card.id) return; // mesmo card, ignora
            _alchSelected.beta = card;
        } else {
            // Ambos cheios: substitui alpha, mantém beta
            _alchSelected.alpha = card;
            if (_alchSelected.beta && _alchSelected.beta.id === card.id) _alchSelected.beta = null;
        }

        // Sincroniza <select> ocultos
        const s1 = document.getElementById('fuseCard1');
        const s2 = document.getElementById('fuseCard2');
        if (s1) s1.value = _alchSelected.alpha ? _alchSelected.alpha.id : '';
        if (s2) s2.value = _alchSelected.beta  ? _alchSelected.beta.id  : '';

        _renderAlchGallery();
        _updateAlchPreviews();
        previewAlchemy();
    }

    /** Atualiza os slots de preview (imagem + nome) */
    function _updateAlchPreviews() {
        const p1 = document.getElementById('previewSlot1');
        const p2 = document.getElementById('previewSlot2');
        const n1 = document.getElementById('alchSlotName1');
        const n2 = document.getElementById('alchSlotName2');

        if (p1) {
            if (_alchSelected.alpha) {
                const c = _alchSelected.alpha;
                const rc = _rarityColor(c.rarityType);
                p1.innerHTML = `<img src="${c.imgSrc}" style="border:2px solid ${rc};">`;
                if (n1) n1.innerText = `${c.id} [${c.rarityNameEN}]`;
                if (n1) n1.style.color = rc;
            } else {
                p1.innerHTML = '<div class="alch-empty-slot">⚗<span>ALPHA VAZIO</span></div>';
                if (n1) { n1.innerText = '—'; n1.style.color = '#ff00ff44'; }
            }
        }
        if (p2) {
            if (_alchSelected.beta) {
                const c = _alchSelected.beta;
                const rc = _rarityColor(c.rarityType);
                p2.innerHTML = `<img src="${c.imgSrc}" style="border:2px solid ${rc};">`;
                if (n2) n2.innerText = `${c.id} [${c.rarityNameEN}]`;
                if (n2) n2.style.color = rc;
            } else {
                p2.innerHTML = '<div class="alch-empty-slot">⚗<span>BETA VAZIO</span></div>';
                if (n2) { n2.innerText = '—'; n2.style.color = '#ff00ff44'; }
            }
        }
    }

    function previewAlchemy() {
        const id1 = _alchSelected.alpha ? _alchSelected.alpha.id : '';
        const id2 = _alchSelected.beta  ? _alchSelected.beta.id  : '';
        const probBox = document.getElementById('alchProbBox');

        const c1 = _alchSelected.alpha;
        const c2 = _alchSelected.beta;

        if (!c1 || !c2 || id1 === id2) { if (probBox) probBox.style.display = 'none'; return; }

        const score = (c) => c.rarityType === 'ancestral' ? 4 : c.rarityType === 'legendary' ? 3 : c.rarityType === 'epic' ? 2 : 1;
        const total = score(c1) + score(c2);
        let ps, pb, pc;
        if (total >= 7)      { ps = 80; pb = 8;  pc = 12; }
        else if (total >= 6) { ps = 70; pb = 10; pc = 20; }
        else if (total >= 4) { ps = 45; pb = 15; pc = 40; }
        else if (total >= 3) { ps = 25; pb = 20; pc = 55; }
        else                 { ps = 10; pb = 25; pc = 65; }

        if (probBox) probBox.style.display = 'block';
        document.getElementById('probSuccess').innerText = `${ps}%`;
        document.getElementById('probBreak').innerText   = `${pb}%`;
        document.getElementById('probCommon').innerText  = `${pc}%`;
    }

    // =========================================================
    // EFEITO VISUAL DINÂMICO DE FUSÃO (ALQUIMIA) — Ponto 4
    // Gera um filtro CSS aleatório + distorção/pixelado/ruído únicos
    // a cada fusão, sempre a partir da imagem-base do card resultante.
    // =========================================================
    function buildRandomFusionFilter(forcedPalette) {
        // Direcionador de Mutação ativo (ex: Essência de Neon Amarelo) força a faixa de matiz
        const PALETTE_HUE_RANGES = { gold: [40, 55], cyan: [180, 200], magenta: [300, 330] };
        const range = forcedPalette && PALETTE_HUE_RANGES[forcedPalette];
        const hue = range ? (range[0] + Math.floor(Math.random() * (range[1] - range[0]))) : Math.floor(Math.random() * 360);
        const sat = 120 + Math.floor(Math.random() * 220);     // 120% - 340%
        const con = 100 + Math.floor(Math.random() * 140);     // 100% - 240%
        const bri = 70 + Math.floor(Math.random() * 60);       // 70%  - 130%
        const doInvert = !forcedPalette && Math.random() < 0.35; // catalisador desativa inversão p/ preservar a cor alvo
        const invertPct = doInvert ? Math.floor(Math.random() * 100) : 0;
        const doGray = !forcedPalette && Math.random() < 0.2;

        let parts = [
            `hue-rotate(${hue}deg)`,
            `saturate(${sat}%)`,
            `contrast(${con}%)`,
            `brightness(${bri}%)`
        ];
        if (doInvert) parts.push(`invert(${invertPct}%)`);
        if (doGray) parts.push(`grayscale(${20 + Math.floor(Math.random() * 50)}%)`);

        return parts.join(' ');
    }

    /**
     * Renderiza a imagem-base do card fundido com filtro CSS aleatório
     * e, por cima, aplica uma das distorções de pixel (pixelado, ruído
     * estático, "derretido"/stretch) escolhida aleatoriamente, de modo
     * que o resultado visual nunca se repita entre fusões.
     * Retorna uma Promise<string> com o dataURL final (PNG).
     */
    function renderFusedCardVisual(baseImgSrc, forcedPalette) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const SIZE = 600;
                const canvas = document.createElement('canvas');
                canvas.width = SIZE; canvas.height = SIZE;
                const ctx = canvas.getContext('2d');

                // 1) Desenha a imagem-base já com o filtro CSS aleatório aplicado
                const filterStr = buildRandomFusionFilter(forcedPalette);
                ctx.filter = filterStr;
                ctx.drawImage(img, 0, 0, SIZE, SIZE);
                ctx.filter = "none";

                // 2) Escolhe aleatoriamente UMA distorção adicional pra aplicar
                const distortion = ["pixelado", "ruido", "derretido", "nenhuma"][Math.floor(Math.random() * 4)];

                if (distortion === "pixelado") {
                    const blockSize = 6 + Math.floor(Math.random() * 14); // 6-20px
                    const tiny = document.createElement('canvas');
                    const tinyW = Math.max(1, Math.floor(SIZE / blockSize));
                    tiny.width = tinyW; tiny.height = tinyW;
                    const tCtx = tiny.getContext('2d');
                    tCtx.drawImage(canvas, 0, 0, tinyW, tinyW);
                    ctx.imageSmoothingEnabled = false;
                    ctx.clearRect(0, 0, SIZE, SIZE);
                    ctx.drawImage(tiny, 0, 0, tinyW, tinyW, 0, 0, SIZE, SIZE);
                    ctx.imageSmoothingEnabled = true;

                } else if (distortion === "ruido") {
                    // Sobrepõe ruído estático em pequenos blocos translúcidos
                    const noiseCount = 800 + Math.floor(Math.random() * 1200);
                    for (let i = 0; i < noiseCount; i++) {
                        const nx = Math.random() * SIZE;
                        const ny = Math.random() * SIZE;
                        const ns = 1 + Math.random() * 2.5;
                        const shade = Math.floor(Math.random() * 255);
                        ctx.fillStyle = `rgba(${shade},${shade},${shade},${(Math.random() * 0.35).toFixed(2)})`;
                        ctx.fillRect(nx, ny, ns, ns);
                    }
                    // Linhas de scanline aleatórias, estilo TV com defeito
                    const scanlines = 4 + Math.floor(Math.random() * 8);
                    for (let i = 0; i < scanlines; i++) {
                        const ly = Math.random() * SIZE;
                        ctx.fillStyle = `rgba(0,0,0,${(0.1 + Math.random() * 0.25).toFixed(2)})`;
                        ctx.fillRect(0, ly, SIZE, 1 + Math.random() * 3);
                    }

                } else if (distortion === "derretido") {
                    // Efeito "derretido": redesenha em faixas horizontais com
                    // deslocamento horizontal e estiramento vertical aleatório,
                    // crescente em direção à base da imagem.
                    const snapshot = ctx.getImageData(0, 0, SIZE, SIZE);
                    const tmp = document.createElement('canvas');
                    tmp.width = SIZE; tmp.height = SIZE;
                    tmp.getContext('2d').putImageData(snapshot, 0, 0);

                    ctx.clearRect(0, 0, SIZE, SIZE);
                    const strips = 30 + Math.floor(Math.random() * 30);
                    const stripH = SIZE / strips;
                    const maxDrip = 18 + Math.random() * 40;
                    for (let i = 0; i < strips; i++) {
                        const progress = i / strips; // 0 no topo, 1 na base
                        const xOffset = (Math.random() - 0.5) * (8 + progress * 26);
                        const dripStretch = 1 + (progress * progress) * (maxDrip / stripH) * 0.15 * Math.random();
                        const sy = i * stripH;
                        ctx.drawImage(
                            tmp,
                            0, sy, SIZE, stripH,
                            xOffset, sy, SIZE, stripH * dripStretch
                        );
                    }
                }
                // "nenhuma" → mantém só o filtro de cor, sem distorção extra

                // 3) Marca d'água sutil indicando que é resultado de fusão
                ctx.fillStyle = "rgba(0,0,0,0.55)";
                ctx.fillRect(16, SIZE - 40, 150, 28);
                ctx.fillStyle = "#ff00ff";
                ctx.font = "bold 13px 'Space Mono'";
                ctx.fillText("FUSION_OUTPUT", 24, SIZE - 21);

                resolve(canvas.toDataURL());
            };
            img.onerror = () => resolve(baseImgSrc); // fallback: usa imagem original sem efeito
            img.src = baseImgSrc;
        });
    }

    /**
     * Núcleo de regras da Alquimia Avançada: calcula probabilidades ponderadas
     * por itens modificadores e aplica os efeitos de sobrevivência/mutação
     * sobre o card principal (que permanece vivo, acumulando fusion_count).
     * NÃO mexe em savedAssets/DOM — isso fica a cargo de fuseCards(), que
     * orquestra a animação e persiste o resultado.
     *
     * @param {object} cardPrincipal    card que sobrevive e evolui
     * @param {object} cardSacrificado  card consumido na fusão
     * @param {object[]} modificadores  itens do inventário usados (templateId)
     * @returns {{resultado:string, ...}}
     */
    async function forjarFusao(cardPrincipal, cardSacrificado, modificadores = []) {
        const score = c => c.rarityType === 'legendary' ? 3 : c.rarityType === 'epic' ? 2 : 1;
        const total = score(cardPrincipal) + score(cardSacrificado);
    
        let ps, pb;
        if (total >= 6)      { ps = 0.70; pb = 0.10; }
        else if (total >= 4) { ps = 0.45; pb = 0.15; }
        else if (total >= 3) { ps = 0.25; pb = 0.20; }
        else                  { ps = 0.10; pb = 0.25; }
    
        let nucleoBackupAtivo = false;
        let forcedPalette = null;
        let fusionCountBonus = 0;
    
        modificadores.forEach(m => {
            const tpl = ITEMS_DB[m.templateId];
            if (!tpl) return;
            if (tpl.effect.type === 'SURVIVAL_BONUS')  ps = Math.min(0.95, ps + tpl.effect.value);
            if (tpl.effect.type === 'INSURANCE_BREAK')  nucleoBackupAtivo = true;
            if (tpl.effect.type === 'FORCE_PALETTE')    forcedPalette = tpl.effect.value;
            if (tpl.effect.type === 'OVERCLOCK') {
                pb = Math.min(0.95, pb + tpl.effect.riskDelta);
                fusionCountBonus += tpl.effect.fusionCountBonus;
            }
        });
        pb = Math.max(0, Math.min(1 - ps, pb)); // normaliza, nunca deixa ps+pb > 1
    
        const roll = Math.random();
        const fusionId = `FUS-${(cardPrincipal.fusion_count || 0).toString().padStart(4, '0')}`;
    
        // Consome itens-moeda e modificadores usados (independente do resultado)
        // ⚠️ agora aguarda cada consumo terminar no Supabase antes de seguir
        for (const m of modificadores) { await consumeInventoryItem(m.itemId); }
    
        if (roll < pb) {
            if (nucleoBackupAtivo) {
                return { resultado: 'seguro_ativado', cardPrincipal, roll, ps, pb,
                    mensagem: 'Núcleo de Backup absorveu a falha — card principal preservado.' };
            }
            // destruição total: nenhum dos dois sobrevive
            if (cardPrincipal._dbId) await deleteCardFromSupabase(cardPrincipal._dbId);
            if (cardSacrificado._dbId) await deleteCardFromSupabase(cardSacrificado._dbId);
            return { resultado: 'destruicao_total', cardsPerdidos: [cardPrincipal.id, cardSacrificado.id], roll, ps, pb };
        }
    
        // SUCESSO: card principal sobrevive e evolui
        cardPrincipal.fusion_count = (cardPrincipal.fusion_count || 0) + 1 + fusionCountBonus;
        cardPrincipal.genetic_history = cardPrincipal.genetic_history || [];
        cardPrincipal.genetic_history.push({
            fusionId, ts: Date.now(),
            sacrificedCardId: cardSacrificado.id,
            sacrificedSnapshot: { rarityType: cardSacrificado.rarityType, styleName: cardSacrificado.styleName },
            itemsConsumidos: modificadores.map(m => m.itemId),
            survivalRollResult: roll,
            mutation: forcedPalette ? { huePalette: forcedPalette } : null
        });
        cardPrincipal.eliteEligible = cardPrincipal.fusion_count >= 3;
        regenerateQrSignature(cardPrincipal); // estado mudou → QR muta
    
        // ── persiste a evolução do card principal no Supabase ──
        await updateCardInSupabase(cardPrincipal, {
            fusion_count: cardPrincipal.fusion_count,
            eliteEligible: cardPrincipal.eliteEligible,
            genetic_history: cardPrincipal.genetic_history,
            qr_code_hash: cardPrincipal.qr_code_hash,
            qr_payload_url: cardPrincipal.qr_payload_url
        });
        // ── apaga o card sacrificado, que deixou de existir ──
        if (cardSacrificado._dbId) await deleteCardFromSupabase(cardSacrificado._dbId);
    
        return { resultado: 'sucesso', cardPrincipal, fusionId, roll, ps, pb, forcedPalette };
    }
    
    async function fuseCards(id1, id2, modificadores = []) {
        if (!id1 || !id2) { showCyberAlert('ERRO DE ALQUIMIA', currentLang === 'PT' ? 'Seleciona 2 cards diferentes.' : 'Select 2 different cards.', 'error'); return; }
        if (id1 === id2) { showCyberAlert('ERRO DE ALQUIMIA', currentLang === 'PT' ? 'Os 2 cards devem ser diferentes.' : 'Both cards must be different.', 'error'); return; }
    
        const c1 = savedAssets.find(a => a.id === id1);
        const c2 = savedAssets.find(a => a.id === id2);
        if (!c1 || !c2) { showCyberAlert('ERRO DE ALQUIMIA', currentLang === 'PT' ? 'Card não encontrado no cofre.' : 'Card not found in vault.', 'error'); return; }
        if (c1.isListed || c2.isListed) { showCyberAlert('🔒 CUSTÓDIA ATIVA', currentLang === 'PT' ? 'Cards em custódia no mercado não podem ser fundidos.' : 'Cards listed on market cannot be fused.', 'error'); return; }
    
        // Snapshot antes de qualquer alteração
        const snap1 = {...c1}; const snap2 = {...c2};
    
        const score = (c) => c.rarityType === 'legendary' ? 3 : c.rarityType === 'epic' ? 2 : 1;
        const total = score(c1) + score(c2);
    
        let ps, pb;
        if (total >= 6)      { ps = 0.70; pb = 0.10; }
        else if (total >= 4) { ps = 0.45; pb = 0.15; }
        else if (total >= 3) { ps = 0.25; pb = 0.20; }
        else                 { ps = 0.10; pb = 0.25; }
    
        // ── ALQUIMIA AVANÇADA: aplica efeito dos itens modificadores selecionados ──
        let nucleoBackupAtivo = false;
        let forcedPalette = null;
        let fusionCountBonus = 0;
        modificadores.forEach(m => {
            const tpl = ITEMS_DB[m.templateId];
            if (!tpl) return;
            if (tpl.effect.type === 'SURVIVAL_BONUS') ps = Math.min(0.95, ps + tpl.effect.value);
            if (tpl.effect.type === 'INSURANCE_BREAK') nucleoBackupAtivo = true;
            if (tpl.effect.type === 'FORCE_PALETTE') forcedPalette = tpl.effect.value;
            if (tpl.effect.type === 'OVERCLOCK') {
                pb = Math.min(0.95, pb + tpl.effect.riskDelta);
                fusionCountBonus += tpl.effect.fusionCountBonus;
            }
        });
        pb = Math.max(0, Math.min(1 - ps, pb)); // normaliza, nunca deixa ps+pb > 1
    
        // consome itens já na entrada da fusão — agora aguarda cada baixa no Supabase
        for (const m of modificadores) { await consumeInventoryItem(m.itemId); }
    
        const roll = Math.random();
    
        // ── FASE 1: animação visual do painel de alquimia ──────────────
        const alchPanel = document.getElementById('alchemyPanel');
        alchPanel.classList.add('alchemy-fusing');
        playSynthSound('click');
        speakPhrase("Iniciando fusão. Aguarde a estabilização.", "Initiating fusion sequence. Stand by.");
    
        setTimeout(() => {
            alchPanel.classList.remove('alchemy-fusing');
    
            // ── FASE 2: overlay de glitch por 1500ms ───────────────────────
            const glitchOverlay = document.createElement('div');
            glitchOverlay.id = 'fusionGlitchOverlay';
            glitchOverlay.className = 'fusion-glitch-active';
            Object.assign(glitchOverlay.style, {
                position:       'fixed',
                inset:          '0',
                zIndex:         '9999',
                background:     'rgba(5, 5, 7, 0.92)',
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                justifyContent: 'center',
                gap:            '18px',
                pointerEvents:  'all',
            });
    
            // Camada de flash de luz, dispara em pulsos aleatórios durante o overlay
            const flashLayer = document.createElement('div');
            flashLayer.className = 'fusion-flash-layer';
            glitchOverlay.appendChild(flashLayer);
    
            // Trepidação de tela (shake) no body inteiro durante a fusão
            document.body.classList.add('fusion-screen-shake');
    
            // Som de "máquina" em loop curto enquanto o overlay está ativo
            playTerminalSound('alchemy');
            playFusionShockSound();
            const glitchSoundTimer = setInterval(() => playSynthSound('click'), 350);
            // Flashes de luz em instantes aleatórios dentro da janela de 1500ms
            const flashTimers = [300, 650, 1000, 1250].map(delay =>
                setTimeout(() => {
                    flashLayer.classList.add('flash-pulse');
                    setTimeout(() => flashLayer.classList.remove('flash-pulse'), 90);
                    playSynthSound('click');
                }, delay)
            );
    
            // Texto principal com efeito glitch
            const glitchLabel = document.createElement('div');
            glitchLabel.className = 'loading-glitch loading-glitch-cursor';
            glitchLabel.setAttribute('data-text', currentLang === 'PT' ? 'EXECUTANDO_FUSÃO...' : 'EXECUTING_FUSION...');
            glitchLabel.textContent = currentLang === 'PT' ? 'EXECUTANDO_FUSÃO...' : 'EXECUTING_FUSION...';
            Object.assign(glitchLabel.style, { fontSize: '1.4rem', letterSpacing: '4px' });
    
            // Linha de status secundária
            const glitchSub = document.createElement('div');
            glitchSub.style.cssText = 'font-family:"Space Mono",monospace; font-size:0.6rem; color:#444466; letter-spacing:2px;';
            const subMessages = [
                'QUEBRANDO VÍNCULOS MOLECULARES...',
                'RECOMBINANDO SEQUÊNCIA DE DNA DIGITAL...',
                'INSTABILIDADE DE REDE DETECTADA...',
                'SINCRONIZANDO MATRIZ DE RARIDADE...',
            ];
            glitchSub.textContent = subMessages[Math.floor(Math.random() * subMessages.length)];
    
            // Barra de progresso de terminal
            const glitchBar = document.createElement('span');
            glitchBar.className = 'loading-glitch-bar';
            Object.assign(glitchBar.style, { width: '260px', display: 'block' });
    
            // Scanline sobreposta
            const scanline = document.createElement('div');
            scanline.className = 'loading-glitch-scanline';
    
            glitchOverlay.appendChild(scanline);
            glitchOverlay.appendChild(glitchLabel);
            glitchOverlay.appendChild(glitchSub);
            glitchOverlay.appendChild(glitchBar);
            document.body.appendChild(glitchOverlay);
    
            // ── FASE 3: após 1500ms, remove glitch e processa resultado ───
            setTimeout(async () => {
                clearInterval(glitchSoundTimer);
                document.body.classList.remove('fusion-screen-shake');
                glitchOverlay.remove();
    
                // Remove cartas originais ANTES de qualquer resultado
                // (Núcleo de Backup: se a fusão falhar, o card principal (c1) é preservado)
                const insuranceWillSave = nucleoBackupAtivo && roll < pb;
                savedAssets = savedAssets.filter(a => a.id !== id1 && a.id !== id2);
                // Nota: cards em custódia no mercado (isListed) não podem ser fundidos
                // (validado antes, no início de fuseCards), então não há necessidade
                // de tocar em marketAssets/Supabase aqui.
                if (insuranceWillSave) savedAssets.push(snap1); // c2 é consumido pelo seguro; c1 retorna ao cofre
    
                // ── SUPABASE: apaga do banco os cards realmente consumidos ──
                // Se o seguro salvou c1, só c2 sai do banco; senão, os dois saem.
                if (insuranceWillSave) {
                    if (snap2._dbId) await deleteCardFromSupabase(snap2._dbId);
                } else {
                    if (snap1._dbId) await deleteCardFromSupabase(snap1._dbId);
                    if (snap2._dbId) await deleteCardFromSupabase(snap2._dbId);
                }
    
                let result, fusedCard, alertTitle, alertMsg, alertType;
    
                if (roll < pb) {
                    if (insuranceWillSave) {
                        // SEGURO ATIVADO: Núcleo de Backup absorve a falha — c1 sobrevive intacto
                        result = 'seguro_ativado';
                        alertTitle = currentLang === 'PT' ? '🛡️ SEGURO ATIVADO' : '🛡️ INSURANCE TRIGGERED';
                        alertMsg   = currentLang === 'PT'
                            ? `O <b>Núcleo de Backup</b> quebrou no lugar do card principal.<br><b>${id1}</b> foi preservado intacto. <b>${id2}</b> foi perdido.`
                            : `The <b>Backup Core</b> shattered in place of the main card.<br><b>${id1}</b> survived intact. <b>${id2}</b> was lost.`;
                        alertType = 'warn';
                        playSynthSound('success');
                        speakPhrase("Seguro de alquimia ativado. Card principal preservado.", "Alchemy insurance triggered. Main card preserved.");
                    } else {
                        // FALHA: cartas quebram — sem novo card
                        result = 'break';
                        alertTitle = currentLang === 'PT' ? '💀 FUSÃO DESTRUÍDA' : '💀 FUSION DESTROYED';
                        alertMsg   = currentLang === 'PT'
                            ? `Cards <b>${id1}</b> e <b>${id2}</b> foram destruídos na fusão instável. Nenhum ativo gerado.`
                            : `Cards <b>${id1}</b> and <b>${id2}</b> were destroyed in the unstable fusion. No asset generated.`;
                        alertType = 'error';
                        triggerAncestralFlash('#ff0044'); // flash vermelho na quebra
                        playSynthSound('shatter');
                        speakPhrase("Fusão destruída. Perda total.", "Fusion destroyed. Total loss.");
                    }
    
                } else if (roll < pb + (1 - ps - pb)) {
                    // ITEM COMUM
                    result = 'common';
                    const newId = "#" + Math.floor(100000 + Math.random() * 900000);
                    const fusedVisual = await renderFusedCardVisual(snap1.imgSrc);
                    fusedCard = {
                        id: newId, rarityType: 'common', rarityName: 'COMUM', rarityNameEN: 'COMMON',
                        styleName: 'RESÍDUO [FUSED]', styleNameEN: 'RESIDUE [FUSED]',
                        creator: currentUser.username, registered: true, exposed: false,
                        forSale: false, isListed: false, price: 0,
                        imgSrc: fusedVisual, isFused: true, tags: ['fused'],
                        fusion_count: 0, genetic_history: [] // resíduo instável — linhagem não sobrevive
                    };
                    // ── PROVENIÊNCIA: novo hash exclusivo do card fundido ──
                    attachProvenance(fusedCard);
                    savedAssets.push(fusedCard);
                    // ── SUPABASE: grava o novo card resultante da fusão ──
                    const insertedCommon = await insertCardToSupabase(fusedCard, currentUser.id);
                    if (!insertedCommon) console.error('fuseCards: falha ao gravar card comum no Supabase.');
                    alertTitle = currentLang === 'PT' ? '◆ FUSÃO PARCIAL' : '◆ PARTIAL FUSION';
                    alertMsg   = currentLang === 'PT'
                        ? `Fusão instável resultou num card comum.<br><b>${newId}</b> — <span style="color:#aaa">COMUM</span>`
                        : `Unstable fusion resulted in a common card.<br><b>${newId}</b> — <span style="color:#aaa">COMMON</span>`;
                    alertType = 'warn';
                    playSynthSound('success');
                    speakPhrase("Fusão parcial. Item comum gerado.", "Partial fusion. Common item generated.");
    
                } else {
                    // SUCESSO — rarity baseada nos inputs + 1% Ancestral
                    result = 'success';
                    const rarityRoll = Math.random();
                    let newRarity;
                    if (rarityRoll < 0.01) {
                        newRarity = 'ancestral';
                    } else if (total >= 6)      newRarity = rarityRoll < 0.75 ? 'legendary' : 'epic';
                    else if (total >= 4) newRarity = rarityRoll < 0.35 ? 'legendary' : 'epic';
                    else if (total >= 3) newRarity = rarityRoll < 0.08 ? 'legendary' : 'epic';
                    else                 newRarity = rarityRoll < 0.03 ? 'legendary' : 'epic';
    
                    const rarityColors = {
                        ancestral: '#ff007f',
                        legendary: '#00ffff',
                        epic:      '#ffaa00'
                    };
                    const rN   = newRarity === 'ancestral' ? 'ANCESTRAL' : newRarity === 'legendary' ? 'LENDÁRIO' : 'ÉPICO';
                    const rNEN = newRarity === 'ancestral' ? 'ANCESTRAL' : newRarity === 'legendary' ? 'LEGENDARY' : 'EPIC';
                    const wc   = rarityColors[newRarity] || '#aaaaaa';
                    const nameParts = [snap1.styleName.split(' ')[0], snap2.styleName.split(' ')[0]];
                    const fusedStyle = nameParts.join('×') + ' [FUSED]';
                    const newId = "#" + Math.floor(100000 + Math.random() * 900000);
                    const baseVisualSrc = Math.random() > 0.5 ? snap1.imgSrc : snap2.imgSrc;
                    const fusedVisual = await renderFusedCardVisual(baseVisualSrc, forcedPalette);
    
                    // Flash ancestral (rosa) se for ancestral
                    if (newRarity === 'ancestral') triggerAncestralFlash('#ff007f');
    
                    // ── SURVIVAL COUNTER: o card resultante herda o maior fusion_count
                    // entre os dois cards de origem + 1 (esta fusão) + bônus de Overclock ──
                    const inheritedFusionCount = Math.max(snap1.fusion_count || 0, snap2.fusion_count || 0) + 1 + fusionCountBonus;
                    const inheritedHistory = [
                        ...(snap1.genetic_history || []), ...(snap2.genetic_history || []),
                        {
                            fusionId: `FUS-${inheritedFusionCount.toString().padStart(4, '0')}`,
                            ts: Date.now(),
                            sacrificedCardId: id1 === snap1.id ? id2 : id1,
                            itemsConsumidos: modificadores.map(m => m.itemId),
                            survivalRollResult: roll,
                            mutation: forcedPalette ? { huePalette: forcedPalette } : null
                        }
                    ];
    
                    fusedCard = {
                        id: newId, rarityType: newRarity, rarityName: rN, rarityNameEN: rNEN,
                        styleName: fusedStyle, styleNameEN: fusedStyle,
                        creator: currentUser.username, registered: true, exposed: false,
                        forSale: false, isListed: false, price: 0,
                        imgSrc: fusedVisual,
                        isFused: true, tags: ['fused', 'evento'],
                        fusion_count: inheritedFusionCount,
                        genetic_history: inheritedHistory,
                        eliteEligible: inheritedFusionCount >= 3
                    };
                    // ── PROVENIÊNCIA: hash exclusivo + herança de linhagem (já regenera o QR) ──
                    attachProvenance(fusedCard);
                    fusedCard.provenance.parentIds = [id1, id2]; // rastreabilidade de linhagem
                    savedAssets.push(fusedCard);
                    // ── SUPABASE: grava o novo card resultante da fusão ──
                    const insertedSuccess = await insertCardToSupabase(fusedCard, currentUser.id);
                    if (!insertedSuccess) console.error('fuseCards: falha ao gravar card fundido no Supabase.');
                    alertTitle = currentLang === 'PT' ? '⚗️ FUSÃO CONCLUÍDA' : '⚗️ FUSION COMPLETE';
                    alertMsg   = currentLang === 'PT'
                        ? `Novo ativo gerado com sucesso!<br><b>${newId}</b> — <span style="color:${wc}">${rNEN}</span><br>Estilo: <b>${fusedStyle}</b><br><small style="color:#666">Este card tem tag [EVENTO] e pode ser usado como banner.</small>`
                        : `New asset successfully generated!<br><b>${newId}</b> — <span style="color:${wc}">${rNEN}</span><br>Style: <b>${fusedStyle}</b><br><small style="color:#666">This card has [EVENT] tag and can be used as banner.</small>`;
                    alertType = 'success';
                    playTerminalSound('alchemy');
                }
    
                // Já não há registry local para persistir — cada mudança (cards
                // apagados/criados, itens de inventário consumidos) já foi
                // gravada direto no Supabase nos pontos acima.
                if (result === 'success' || result === 'common') registerFusionForBadges();
                // Fusões bem-sucedidas (comum ou épico/lendário) entram no feed global,
                // para que apareçam na Home e sobrevivam ao F5 — não só no cofre do usuário.
                if (result === 'success' || result === 'common') {
                    globalFeed.unshift({...fusedCard});
                    saveGlobalFeed(globalFeed);
                    buildStoriesMarquee();
                }
                if (result === 'success' || result === 'common') pushLedger(`${currentUser.username} fundiu ${id1}+${id2} → ${fusedCard.id} [${fusedCard.rarityNameEN}]`);
                else if (result === 'seguro_ativado') pushLedger(`${currentUser.username} ativou Núcleo de Backup em ${id1}+${id2} — ${id1} preservado`);
                else pushLedger(`${currentUser.username} tentou fundir ${id1}+${id2} — FALHA TOTAL`);
    
                document.getElementById('alchemyPanel').style.display = 'none';
                _alchSelected = { alpha: null, beta: null };
                renderVaultGrid();
                showCyberAlert(alertTitle, alertMsg, alertType);
    
            }, 1500); // ← 1500ms de glitch antes do pop-up
        }, 1200);
    }

    async function viewTargetUserCollection(username, code, bio, avatar, banner, isOwner) {
        selectedProfileUser = username;

        // Identidade
        document.getElementById('profUsername').innerText = username;
        document.getElementById('profCode').innerText = code || '#0000';
        document.getElementById('profBioView').innerText = bio || '';

        // Avatar do usuário logado/visitado (BUGFIX: avatar sumido da tela de perfil)
        const avatarImg = document.getElementById('profAvatarImg');
        if (avatarImg) avatarImg.src = avatar || 'https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg';

        // Banner
        const bannerEl = document.getElementById('profBannerView');
        if (bannerEl) {
            bannerEl.style.backgroundImage = banner ? `url(${banner})` : '';
        }

        // Saldo (somente para o próprio usuário)
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = isOwner ? `${currentUser.bumps} B$` : '--- B$';

        // Zona de edição só aparece para o próprio perfil
        const editZone = document.getElementById('profileEditZone');
        if (editZone) editZone.style.display = isOwner ? 'block' : 'none';
        const inputBio = document.getElementById('inputBio');
        if (inputBio) inputBio.value = isOwner ? (bio || '') : '';

        // Vitrine: assets expostos do usuário-alvo
        // (também usado pra obter o id real do usuário-alvo, necessário pro follow)
        let sourceAssets = savedAssets;
        let targetUserId = isOwner ? currentUser.id : null;
        if (!isOwner) {
            const targetProfile = await fetchProfileByUsername(username);
            targetUserId = targetProfile ? targetProfile.id : null;
            sourceAssets = targetProfile ? await loadCardsFromSupabase(targetProfile.id) : [];
        }
        const exposedAssets = sourceAssets.filter(a => a.exposed);
        const showcaseGrid = document.getElementById('showcaseGrid');
        if (showcaseGrid) {
            showcaseGrid.innerHTML = '';
            if (exposedAssets.length === 0) {
                showcaseGrid.innerHTML = '<div class="empty-vault-notice" style="grid-column:1/-1;">Nenhum ativo exposto na vitrine.</div>';
            } else {
                exposedAssets.forEach((a) => {
                    const card = document.createElement('div');
                    card.className = `album-card rare-${a.rarityType}`;
                    card.innerHTML = `
                        <div class="album-preview-wrapper"><img src="${a.imgSrc}" draggable="false"></div>
                        <div class="album-meta">
                            <div class="album-id">${a.id}</div>
                            <div class="album-rarity" style="color:${a.rarityType==='ancestral'?'#ff007f':a.rarityType==='legendary'?'#00ffff':a.rarityType==='epic'?'#ffaa00':'#aaaaaa'}">${currentLang === 'PT' ? a.rarityName : a.rarityNameEN}</div>
                        </div>
                    `;
                    card.querySelector('.album-preview-wrapper').addEventListener('click', () => openInspectModal(a));
                    showcaseGrid.appendChild(card);
                });
            }
        }

        const showcaseRankArea = document.getElementById('showcaseRankArea');
        if (showcaseRankArea) computeCollectionLevel(sourceAssets, showcaseRankArea);

        // ── FOLLOW: contadores reais (tabela public.followers) + botão seguir ──
        // (ver Parte 5/4: fetchFollowState / followUser / unfollowUser)
        const followersLbl = document.getElementById('lbl-followers');
        const followingLbl = document.getElementById('lbl-following');
        const socialActionZone = document.getElementById('socialActionZone');
        if (targetUserId) {
            const followState = await fetchFollowState(targetUserId);
            if (followersLbl) followersLbl.innerText = followState.followers;
            if (followingLbl) followingLbl.innerText = followState.following;

            if (socialActionZone) {
                socialActionZone.innerHTML = '';
                if (!isOwner && currentUser.loggedIn) {
                    const followBtn = document.createElement('button');
                    followBtn.className = 'btn-action follow-toggle-btn';
                    followBtn.innerText = followState.followedByMe ? 'SEGUINDO' : 'SEGUIR';
                    followBtn.classList.toggle('following-active', followState.followedByMe);
                    followBtn.addEventListener('click', () => toggleFollowTarget(targetUserId, followBtn));
                    socialActionZone.appendChild(followBtn);
                }
            }
        } else {
            if (followersLbl) followersLbl.innerText = '0';
            if (followingLbl) followingLbl.innerText = '0';
            if (socialActionZone) socialActionZone.innerHTML = '';
        }

        renderProfileBadges(username);
    }

    function computeCollectionLevel(items, areaElement) {
        if(!areaElement) return;
        let score = 0;
        items.forEach(i => {
            if (i.rarityType === 'legendary') score += 12;
            else if (i.rarityType === 'epic') score += 6;
            else score += 2;
        });

        if (score >= 24) {
            areaElement.innerHTML = `<div class="showcase-rank-badge rank-godlike">⚡ STATUS: MUTANTE ANCESTRAL // COLECIONADOR SUPERIOR (LVL ${score}) ⚡</div>`;
        } else if (score >= 10) {
            areaElement.innerHTML = `<div class="showcase-rank-badge rank-hype">🔥 STATUS: HYPE HUSTLER // ENGRAZADO DA REDE (LVL ${score})</div>`;
        } else {
            areaElement.innerHTML = `<div class="showcase-rank-badge rank-basic">⚙️ STATUS: RECRUTA DA RECEPTAÇÃO (LVL ${score || 1})</div>`;
        }
    }

    function openAvatarSelector() {
        if(selectedProfileUser !== currentUser.username) return;
        document.getElementById('avatarSelectorModal').style.display = 'flex';
        const grid = document.getElementById('avatarSelectorGrid'); grid.innerHTML = '';

        // Apenas avatares no cofre que NÃO estão em custódia/listados no mercado
        const availableAssets = savedAssets.filter(a => a.isListed === false && a.forSale === false);

        if(availableAssets.length === 0) {
            grid.innerHTML = '<div class="empty-vault-notice" style="grid-column:1/-1;">Cofre sem dados sincronizados.</div>'; return;
        }
        availableAssets.forEach((a) => {
            const div = document.createElement('div'); div.className = 'album-card'; div.style.padding = '5px';
            div.onclick = async () => {
                currentUser.avatar = a.imgSrc;
                document.getElementById('profAvatarImg').src = a.imgSrc;
                await updateProfileInSupabase(currentUser.id, { avatar: a.imgSrc });
                closeAvatarSelector();
            };
            div.innerHTML = `<div class="album-preview-wrapper"><img src="${a.imgSrc}"></div>`;
            grid.appendChild(div);
        });
    }
    function closeAvatarSelector() { document.getElementById('avatarSelectorModal').style.display = 'none'; }

    const DEFAULT_BANNERS = [
        { id: 'default-neon',   label: 'NEON GRID',     css: 'linear-gradient(135deg, #000510 0%, #001a33 40%, #003366 60%, #000510 100%)' },
        { id: 'default-cyber',  label: 'CYBER CRIMSON', css: 'linear-gradient(135deg, #0d0005 0%, #330011 40%, #660022 60%, #0d0005 100%)' },
        { id: 'default-matrix', label: 'MATRIX PULSE',  css: 'linear-gradient(135deg, #000d00 0%, #001a00 40%, #003300 60%, #000d00 100%)' }
    ];

    function openBannerSelector() {
        document.getElementById('bannerSelectorModal').style.display = 'flex';
        const grid = document.getElementById('bannerSelectorGrid'); grid.innerHTML = '';

        // Default banners (always available)
        const defaultSection = document.createElement('div');
        defaultSection.innerHTML = '<div style="font-size:0.55rem; color:#888899; letter-spacing:2px; margin-bottom:8px;">BANNERS PADRÃO CYBERPUNK</div>';
        const defaultGrid = document.createElement('div');
        defaultGrid.className = 'default-banner-grid';
        DEFAULT_BANNERS.forEach(b => {
            const card = document.createElement('div');
            card.className = 'default-banner-card';
            card.style.background = b.css;
            card.innerHTML = `<span>${b.label}</span>`;
            card.onclick = async () => {
                currentUser.banner = b.css;
                const bv = document.getElementById('profBannerView');
                bv.style.backgroundImage = 'none';
                bv.style.background = b.css;
                document.getElementById('bannerLockStatus').innerText = b.label;
                document.getElementById('bannerLockStatus').style.color = '#00ffff';
                await updateProfileInSupabase(currentUser.id, { banner: b.css });
                closeBannerSelector();
            };
            defaultGrid.appendChild(card);
        });
        defaultSection.appendChild(defaultGrid);
        grid.appendChild(defaultSection);

        // Event-tagged cards only
        const eventItems = savedAssets.filter(i => i.tags && i.tags.includes('evento') || i.isFused);
        const legacyLegendary = savedAssets.filter(i => i.rarityType === 'legendary' && !(i.tags && i.tags.includes('evento')) && !i.isFused);

        const eventSection = document.createElement('div');
        eventSection.innerHTML = '<div style="font-size:0.55rem; color:#ff00ff; letter-spacing:2px; margin:12px 0 8px;">BANNERS DE EVENTO (CARDS TAG: EVENTO)</div>';

        const allEventCards = [...eventItems, ...legacyLegendary];
        if (allEventCards.length === 0) {
            eventSection.innerHTML += '<div style="color:#666; font-size:0.6rem; padding:8px;">Nenhum card de evento no cofre. Cards [LENDÁRIO] ou com tag Evento desbloqueiam banners personalizados.</div>';
        } else {
            allEventCards.forEach(item => {
                const row = document.createElement('div');
                if (item.isListed) {
                    row.style.cssText = "background:#111; border:1px solid #ff0044; padding:10px; display:flex; justify-content:space-between; align-items:center; opacity:0.5; cursor:not-allowed; margin-bottom:6px;";
                    row.innerHTML = `<span style="font-size:0.65rem; color:#ff0044;">🔒 CUSTÓDIA: ${item.id}</span>`;
                } else {
                    row.style.cssText = "background:#111; border:1px solid #ff00ff; padding:10px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; margin-bottom:6px;";
                    row.innerHTML = `<img src="${item.imgSrc}" style="width:40px;height:40px;object-fit:cover;border:1px solid #ff00ff;margin-right:10px;"><span style="font-size:0.65rem; color:#fff; flex:1;">${item.id} [${item.rarityNameEN}]</span>`;
                    row.onclick = async () => {
                        currentUser.banner = item.imgSrc;
                        document.getElementById('profBannerView').style.backgroundImage = `url(${item.imgSrc})`;
                        document.getElementById('bannerLockStatus').innerText = `BANNER: ${item.id}`;
                        document.getElementById('bannerLockStatus').style.color = '#00ffff';
                        await updateProfileInSupabase(currentUser.id, { banner: item.imgSrc });
                        closeBannerSelector();
                    };
                }
                eventSection.appendChild(row);
            });
        }
        grid.appendChild(eventSection);
    }
    function closeBannerSelector() { document.getElementById('bannerSelectorModal').style.display = 'none'; }

    async function viewExternalProfile(username) {
        closeInspectModal();
        const p = await fetchProfileByUsername(username);
        if(p) {
            await viewTargetUserCollection(p.username, p.code, p.bio, p.avatar, p.banner, p.username === currentUser.username);
        } else {
            await viewTargetUserCollection(username, "#9999", "Membro estável.", "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", "", false);
        }
        navigateTo('profile');
    }

    async function saveProfileCustoms() {
        const bioVal = document.getElementById('inputBio').value;
        currentUser.bio = bioVal;
        const bioView = document.getElementById('profBioView');
        if (bioView) bioView.innerText = bioVal;
        await updateProfileInSupabase(currentUser.id, { bio: bioVal });
    }

    function openDepositModal() { document.getElementById('depositModal').style.display = 'flex'; }
    function closeDepositModal() { document.getElementById('depositModal').style.display = 'none'; }

    async function simularDeposito(amount) {
        currentUser.bumps += amount;
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
        await updateProfileInSupabase(currentUser.id, { bumps: currentUser.bumps });
        playSynthSound('success');
        closeDepositModal();
        showCyberAlert('// INJEÇÃO DE CARGA CONCLUÍDA //', `+<b>${amount} B$</b> adicionados ao teu terminal.<br>Saldo actual: <b>${currentUser.bumps} B$</b>`, 'success');
    }

    async function setUserStatus(status) {
        currentUser.status = status;
        const dot = document.getElementById('userStatusDot');
        const sc = status === 'away' ? 'status-away' : status === 'busy' ? 'status-busy' : 'status-online';
        if (dot) dot.className = `user-status-dot ${sc}`;
        document.querySelectorAll('#statusSelectorZone .status-btn').forEach(b => {
            b.className = 'status-btn' + (b.dataset.s === status ? ` active-${status === 'online' ? 'online' : status === 'away' ? 'away' : 'busy'}` : '');
        });
        await updateProfileInSupabase(currentUser.id, { status });
    }

    buildStoriesMarquee();
    renderQuotesTicker();


    // =========================================================
    // SISTEMA DE CONTRATOS / MISSÕES DE INVASÃO (Idle Staking)
    // =========================================================

    const CONTRACTS_DB = [
        {
            id: 'CTR-01',
            name: 'Infiltrar Data Center',
            desc: 'Acesse o núcleo de dados corporativo e exfiltre arquivos sensíveis antes que o firewall reative.',
            durationMs: 60 * 1000,
            durationLabel: '1 MIN',
            reqCount: 1,
            reqRarity: 'common',
            reqLabel: '1 Card Comum',
            reward: 5
        },
        {
            id: 'CTR-02',
            name: 'Drenar Banco de Neom',
            desc: 'Infiltra o sistema bancário de Neom e redireciona créditos para a carteira fantasma da rede.',
            durationMs: 5 * 60 * 1000,
            durationLabel: '5 MIN',
            reqCount: 2,
            reqRarity: 'epic',
            reqLabel: '2 Cards Épicos',
            reward: 30
        },
        {
            id: 'CTR-03',
            name: 'Hackear Satélite Militar',
            desc: 'Operação de alto risco. Intercepta o sinal de controle do satélite orbital e redireciona o feed.',
            durationMs: 15 * 60 * 1000,
            durationLabel: '15 MIN',
            reqCount: 1,
            reqRarity: 'legendary',
            reqLabel: '1 Card Lendário',
            reward: 100
        }
    ];

    const ACTIVE_CONTRACTS_KEY = 'dr0p_active_contracts';
    let _contractTimers = {}; // intervalId por contractId
    let _pendingContractId = null;
    let _selectedContractCards = [];

    function loadActiveContracts() {
        if (!currentUser.loggedIn) return {};
        try {
            const all = JSON.parse(localStorage.getItem(ACTIVE_CONTRACTS_KEY)) || {};
            return all[currentUser.username] || {};
        } catch(e) { return {}; }
    }

    function saveActiveContracts(obj) {
        try {
            const all = JSON.parse(localStorage.getItem(ACTIVE_CONTRACTS_KEY)) || {};
            all[currentUser.username] = obj;
            localStorage.setItem(ACTIVE_CONTRACTS_KEY, JSON.stringify(all));
        } catch(e) {}
    }

    function startContractTimer(contractId, endTs, cardIds) {
        if (_contractTimers[contractId]) clearInterval(_contractTimers[contractId]);

        _contractTimers[contractId] = setInterval(() => {
            const now = Date.now();
            const remaining = endTs - now;

            // Atualiza barra e label se a tela estiver visível
            const fill = document.getElementById(`ctimer-fill-${contractId}`);
            const label = document.getElementById(`ctimer-label-${contractId}`);
            const contract = CONTRACTS_DB.find(c => c.id === contractId);
            if (fill && label && contract) {
                const pct = Math.max(0, (remaining / contract.durationMs) * 100);
                fill.style.width = pct + '%';
                if (remaining > 0) {
                    label.innerText = `⏱ ${formatContractTime(remaining)} RESTANTES`;
                }
            }

            if (remaining <= 0) {
                clearInterval(_contractTimers[contractId]);
                delete _contractTimers[contractId];
                concludeContract(contractId, cardIds);
            }
        }, 1000);
    }

    function formatContractTime(ms) {
        const totalSec = Math.ceil(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return m > 0 ? `${m}m ${s.toString().padStart(2,'0')}s` : `${s}s`;
    }

    async function concludeContract(contractId, cardIds) {
        const contract = CONTRACTS_DB.find(c => c.id === contractId);
        if (!contract) return;

        // Desbloqueia cards
        cardIds.forEach(cid => {
            const card = savedAssets.find(a => a.id === cid);
            if (card) card.isLocked = false;
        });

        // Adiciona recompensa
        currentUser.bumps += contract.reward;
        await updateProfileInSupabase(currentUser.id, { bumps: currentUser.bumps });

        // Remove contrato ativo
        const active = loadActiveContracts();
        delete active[contractId];
        saveActiveContracts(active);

        // Atualiza badge de saldo se visível
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;

        playSynthSound('success');
        showCyberAlert(
            'CONTRATO_CONCLUÍDO',
            `<b style="color:#ff6600;">${contract.name}</b><br>Dados extraídos com sucesso. Créditos transferidos.<br><br>+<b style="color:#ffaa00;">${contract.reward} B$</b> adicionados ao seu terminal.<br>Saldo atual: <b>${currentUser.bumps} B$</b>`,
            'success'
        );

        // Re-renderiza tela se estiver aberta
        const screen = document.getElementById('screen-contracts');
        if (screen && screen.classList.contains('active')) renderContractsScreen();
    }

    // Reativa timers de contratos que ainda estão rodando (persistência F5)
    function resumePendingContracts() {
        if (!currentUser.loggedIn) return;
        const active = loadActiveContracts();
        Object.entries(active).forEach(([cid, state]) => {
            if (Date.now() < state.endTs) {
                startContractTimer(cid, state.endTs, state.cardIds);
            } else {
                // Já expirou enquanto estava fora — conclui imediatamente
                concludeContract(cid, state.cardIds);
            }
        });
    }

    function renderContractsScreen() {
        if (!currentUser.loggedIn) {
            document.getElementById('contractsGrid').innerHTML =
                '<div class="empty-vault-notice" style="grid-column:1/-1;">Login necessário para acessar contratos.</div>';
            document.getElementById('activeContractsZone').innerHTML = '';
            return;
        }

        const active = loadActiveContracts();
        const activeZone = document.getElementById('activeContractsZone');
        const grid = document.getElementById('contractsGrid');
        activeZone.innerHTML = '';
        grid.innerHTML = '';

        // Seção de missões ativas
        const activeList = Object.entries(active);
        if (activeList.length > 0) {
            const header = document.createElement('div');
            header.style.cssText = 'color:#ffaa00; font-size:0.6rem; font-weight:bold; letter-spacing:2px; margin-bottom:10px;';
            header.innerText = '> MISSÕES_ATIVAS // EM EXECUÇÃO';
            activeZone.appendChild(header);

            activeList.forEach(([cid, state]) => {
                const contract = CONTRACTS_DB.find(c => c.id === cid);
                if (!contract) return;
                const remaining = Math.max(0, state.endTs - Date.now());
                const pct = Math.max(0, (remaining / contract.durationMs) * 100);
                const lockedImgs = state.cardIds.map(id => {
                    const card = savedAssets.find(a => a.id === id);
                    return card ? `<img class="contract-locked-thumb" src="${card.imgSrc}" title="${card.id}">` : '';
                }).join('');

                const div = document.createElement('div');
                div.className = 'contract-card running';
                div.style.marginBottom = '10px';
                div.innerHTML = `
                    <div class="contract-tag">${contract.id} // EM EXECUÇÃO</div>
                    <div class="contract-name">${contract.name}</div>
                    <div class="contract-meta-row">
                        <span class="contract-meta-pill pill-reward">+${contract.reward} B$</span>
                        <span class="contract-meta-pill pill-req">${contract.reqLabel}</span>
                    </div>
                    <div class="contract-locked-cards">${lockedImgs}</div>
                    <div class="contract-timer-bar-wrap">
                        <div class="contract-timer-bar-fill" id="ctimer-fill-${cid}" style="width:${pct}%;"></div>
                    </div>
                    <div class="contract-timer-label" id="ctimer-label-${cid}">⏱ ${formatContractTime(remaining)} RESTANTES</div>
                `;
                activeZone.appendChild(div);

                // Garante que o timer está rodando
                if (!_contractTimers[cid]) {
                    startContractTimer(cid, state.endTs, state.cardIds);
                }
            });
        }

        // Seção de contratos disponíveis
        CONTRACTS_DB.forEach(contract => {
            const isRunning = !!active[contract.id];
            const div = document.createElement('div');
            div.className = 'contract-card';
            div.innerHTML = `
                <div class="contract-tag">${contract.id}</div>
                <div class="contract-name">${contract.name}</div>
                <p style="font-size:0.6rem; color:#888899; margin-bottom:10px;">${contract.desc}</p>
                <div class="contract-meta-row">
                    <span class="contract-meta-pill pill-duration">⏱ ${contract.durationLabel}</span>
                    <span class="contract-meta-pill pill-req">🃏 ${contract.reqLabel}</span>
                    <span class="contract-meta-pill pill-reward">💰 +${contract.reward} B$</span>
                </div>
                ${isRunning
                    ? `<button class="btn-action" style="width:100%; border-color:#555; color:#555; cursor:not-allowed;" disabled>EM EXECUÇÃO...</button>`
                    : `<button class="btn-action" style="width:100%; border-color:#ff6600; color:#ff6600;" onclick="openContractCardModal('${contract.id}')">▶ ACEITAR CONTRATO</button>`
                }
            `;
            grid.appendChild(div);
        });
    }

    // Abre modal de seleção de cards
    function openContractCardModal(contractId) {
        if (!currentUser.loggedIn) { showCyberAlert('ACESSO_NEGADO', 'Login necessário.', 'error'); return; }
        const contract = CONTRACTS_DB.find(c => c.id === contractId);
        if (!contract) return;

        _pendingContractId = contractId;
        _selectedContractCards = [];

        document.getElementById('contractModalTitle').innerText = contract.name;
        document.getElementById('contractModalDesc').innerText = contract.desc;
        document.getElementById('contractModalReq').innerText = `REQUISITO: ${contract.reqLabel}`;
        document.getElementById('contractSelectedCount').innerText = '0';

        // Cards elegíveis: mesma raridade, não listados, não bloqueados
        const eligible = savedAssets.filter(a =>
            a.rarityType === contract.reqRarity &&
            !a.isListed && !a.forSale && !a.isLocked
        );

        const grid = document.getElementById('contractCardSelectGrid');
        grid.innerHTML = '';

        if (eligible.length === 0) {
            grid.innerHTML = `<div style="grid-column:1/-1; color:#ff0044; font-size:0.65rem; padding:10px;">Nenhum card elegível. Requisito: ${contract.reqLabel} disponível no cofre.</div>`;
        } else {
            eligible.forEach(card => {
                const div = document.createElement('div');
                div.style.cssText = 'border:1px solid #333; padding:6px; cursor:pointer; transition:border-color 0.15s;';
                div.dataset.cardId = card.id;
                div.innerHTML = `<img src="${card.imgSrc}" style="width:100%;aspect-ratio:1;object-fit:cover;margin-bottom:4px;"><div style="font-size:0.5rem;color:#888;">${card.id}</div>`;
                div.onclick = () => toggleContractCardSelection(div, card.id, contract.reqCount);
                grid.appendChild(div);
            });
        }

        document.getElementById('contractCardModal').style.display = 'flex';
    }

    function toggleContractCardSelection(el, cardId, maxCount) {
        const idx = _selectedContractCards.indexOf(cardId);
        if (idx > -1) {
            _selectedContractCards.splice(idx, 1);
            el.style.borderColor = '#333';
            el.style.boxShadow = '';
        } else {
            if (_selectedContractCards.length >= maxCount) {
                // Deseleciona o mais antigo se já atingiu o máximo
                const oldId = _selectedContractCards.shift();
                const oldEl = document.querySelector(`[data-card-id="${oldId}"]`);
                if (oldEl) { oldEl.style.borderColor = '#333'; oldEl.style.boxShadow = ''; }
            }
            _selectedContractCards.push(cardId);
            el.style.borderColor = '#ff6600';
            el.style.boxShadow = '0 0 8px rgba(255,102,0,0.5)';
        }
        document.getElementById('contractSelectedCount').innerText = _selectedContractCards.length;
    }

    function closeContractCardModal() {
        document.getElementById('contractCardModal').style.display = 'none';
        _pendingContractId = null;
        _selectedContractCards = [];
    }

    function confirmContractStart() {
        const contract = CONTRACTS_DB.find(c => c.id === _pendingContractId);
        if (!contract) return;

        if (_selectedContractCards.length < contract.reqCount) {
            showCyberAlert('ERRO_PROTOCOLO', `Selecione exatamente <b>${contract.reqCount}</b> card(s) para iniciar.`, 'error');
            return;
        }

        // Bloqueia cards
        _selectedContractCards.forEach(cid => {
            const card = savedAssets.find(a => a.id === cid);
            if (card) card.isLocked = true;
        });

        // Persiste contrato ativo
        const endTs = Date.now() + contract.durationMs;
        const active = loadActiveContracts();
        active[contract.id] = { endTs, cardIds: [..._selectedContractCards] };
        saveActiveContracts(active);

        // Estado de "em contrato" já persiste via saveActiveContracts() acima
        // (isLocked é só um flag de UI local, reconstruído a partir de active[] no boot).

        closeContractCardModal();
        startContractTimer(contract.id, endTs, active[contract.id].cardIds);
        renderContractsScreen();

        showCyberAlert(
            'CONTRATO_ACEITO',
            `<b style="color:#ff6600;">${contract.name}</b><br>Cards alocados. Operação em andamento.<br>Recompensa: <b style="color:#ffaa00;">+${contract.reward} B$</b> em <b>${contract.durationLabel}</b>.`,
            'warn'
        );
    }

    // Ativa botão de contratos e retoma timers após login/restore
    const _origRestoreSession = restoreCurrentSession;
    // Hook: após login bem-sucedido, mostrar botão e retomar timers
    // (chamado no handleAuthSubmit e no restore inicial)
    function showContractsBtnAndResume() {
        const btn = document.getElementById('navContractsBtn');
        if (btn) btn.style.display = 'flex';
        resumePendingContracts();
    }

    // Retoma contratos: ver renderBootScreen() / restoreCurrentSession(),
    // chamado lá no momento certo (depois da sessão confirmada), não aqui.
// =========================================================
// DROP STATION — PARTE 2/4: CARDS / COFRE (SUPABASE)
// SUBSTITUI no script.js original:
//   - função claimAssetLogic
//   - função toggleExposeAsset
// ADICIONA (novo, não existia antes):
//   - rowToCard / cardToInsertRow  (conversão DB <-> objeto em memória)
//   - loadCardsFromSupabase
//   - insertCardToSupabase / updateCardInSupabase / deleteCardFromSupabase
//
// INTEGRAÇÃO COM A PARTE 1 (auth-supabase-part.js):
//   No arquivo da Parte 1, dentro de `restoreCurrentSession()` e dentro do
//   bloco de LOGIN em `handleAuthSubmit`, troque a linha:
//       savedAssets = [];
//   por:
//       savedAssets = await loadCardsFromSupabase(currentUser.id);
//
// IMPORTANTE: o `id` usado em todo o resto do app (ex: "#449201") continua
// sendo o campo visual. O uuid real da linha no Supabase fica guardado em
// `_dbId` em cada card, usado só internamente pra update/delete.
// =========================================================

// =========================================================
// MAPEAMENTO DB (snake_case) <-> OBJETO EM MEMÓRIA (shape original do app)
// =========================================================
function rowToCard(row) {
    return {
        _dbId: row.id,
        id: row.display_id,
        rarityType: row.rarity_type,
        rarityName: row.rarity_name,
        rarityNameEN: row.rarity_name_en,
        styleName: row.style_name,
        styleNameEN: row.style_name_en,
        creator: row.creator,
        registered: row.registered,
        exposed: row.exposed,
        forSale: row.for_sale,
        isListed: row.is_listed,
        price: Number(row.price) || 0,
        imgSrc: row.img_src,
        tags: row.tags || [],
        isFused: row.is_fused,
        fusion_count: row.fusion_count,
        eliteEligible: row.elite_eligible,
        genetic_history: row.genetic_history || [],
        parent_ids: row.parent_ids || null,
        provenance: row.provenance_hash ? {
            hash: row.provenance_hash,
            timestamp: row.provenance_timestamp,
            origin: row.provenance_origin
        } : null,
        isTokenized: row.is_tokenized,
        qr_code_hash: row.qr_code_hash,
        qr_payload_url: row.qr_payload_url,
        watermarkColor: row.watermark_color,
        filterStyle: row.filter_style,
        resolutions: row.resolutions || { ui: { w: 500, h: 500 }, hd: { w: 4000, h: 4000, src: null } }
    };
}

function cardToInsertRow(card, userId) {
    return {
        id_usuario: userId,
        display_id: card.id,
        rarity_type: card.rarityType,
        rarity_name: card.rarityName,
        rarity_name_en: card.rarityNameEN,
        style_name: card.styleName,
        style_name_en: card.styleNameEN,
        creator: card.creator,
        registered: card.registered ?? true,
        exposed: card.exposed ?? false,
        for_sale: card.forSale ?? false,
        is_listed: card.isListed ?? false,
        price: card.price ?? 0,
        img_src: card.imgSrc,
        tags: card.tags || [],
        is_fused: card.isFused ?? false,
        fusion_count: card.fusion_count ?? 0,
        elite_eligible: card.eliteEligible ?? false,
        genetic_history: card.genetic_history || [],
        parent_ids: card.parent_ids || null,
        provenance_hash: card.provenance?.hash || null,
        provenance_timestamp: card.provenance?.timestamp || null,
        provenance_origin: card.provenance?.origin || 'DROP_STATION_INTERNAL',
        is_tokenized: card.isTokenized ?? false,
        qr_code_hash: card.qr_code_hash || null,
        qr_payload_url: card.qr_payload_url || null,
        watermark_color: card.watermarkColor || '#ffffff',
        filter_style: card.filterStyle || null,
        resolutions: card.resolutions || { ui: { w: 500, h: 500 }, hd: { w: 4000, h: 4000, src: null } }
    };
}

// =========================================================
// LEITURA: carrega todo o cofre do usuário ao logar / restaurar sessão
// =========================================================
async function loadCardsFromSupabase(userId) {
    const { data, error } = await sb.from('cards').select('*').eq('id_usuario', userId).order('created_at', { ascending: true });
    if (error) { console.error('loadCardsFromSupabase:', error.message); return []; }
    return data.map(rowToCard);
}

// =========================================================
// CRIAÇÃO: insere um novo card no cofre
// =========================================================
async function insertCardToSupabase(card, userId) {
    const row = cardToInsertRow(card, userId);
    const { data, error } = await sb.from('cards').insert(row).select().single();
    if (error) { console.error('insertCardToSupabase:', error.message); return null; }
    card._dbId = data.id; // necessário para updates/deletes futuros nesse card
    return card;
}

// =========================================================
// ATUALIZAÇÃO PARCIAL: usado sempre que o estado de um card muda
// (exposed, forSale, price, isListed, fusion_count, etc.)
// `fieldsCamel` usa as MESMAS chaves do objeto em memória (ex: { exposed: true }),
// a função se encarrega de converter pro nome de coluna do banco.
// =========================================================
const CARD_FIELD_TO_COLUMN = {
    exposed: 'exposed', forSale: 'for_sale', isListed: 'is_listed', price: 'price',
    fusion_count: 'fusion_count', eliteEligible: 'elite_eligible',
    genetic_history: 'genetic_history', qr_code_hash: 'qr_code_hash',
    qr_payload_url: 'qr_payload_url', isTokenized: 'is_tokenized',
    watermarkColor: 'watermark_color', tags: 'tags', registered: 'registered'
};

async function updateCardInSupabase(card, fieldsCamel) {
    if (!card._dbId) { console.warn('updateCardInSupabase: card sem _dbId, ignorando update remoto.', card.id); return false; }
    const updatePayload = {};
    Object.keys(fieldsCamel).forEach(key => {
        const col = CARD_FIELD_TO_COLUMN[key];
        if (col) updatePayload[col] = fieldsCamel[key];
    });
    if (Object.keys(updatePayload).length === 0) return false;

    const { error } = await sb.from('cards').update(updatePayload).eq('id', card._dbId);
    if (error) { console.error('updateCardInSupabase:', error.message); return false; }
    return true;
}

// =========================================================
// EXCLUSÃO: usado quando um card é consumido (fusão, troca, etc.)
// =========================================================
async function deleteCardFromSupabase(cardDbId) {
    if (!cardDbId) return false;
    const { error } = await sb.from('cards').delete().eq('id', cardDbId);
    if (error) { console.error('deleteCardFromSupabase:', error.message); return false; }
    return true;
}

// =========================================================
// CLAIM: resgata o card que acabou de "rolar" pro cofre do usuário
// =========================================================
async function claimAssetLogic() {
    // MUTEX GLOBAL: bloqueia qualquer clique duplicado antes de qualquer operação
    if (isProcessingClaim) return;
    if (!activeAssetData) return;

    isProcessingClaim = true;
    downloadBtn.disabled = true;
    const originalBtnText = downloadBtn.innerText;
    downloadBtn.innerText = currentLang === 'PT' ? "SALVANDO..." : "SAVING...";

    // FREE ROLL sem login: bloqueia envio ao cofre, liberta mutex imediatamente
    if (!currentUser.loggedIn) {
        showCyberAlert('ACESSO_NEGADO:', currentLang === 'PT'
            ? 'COFRE BLOQUEADO: Faça login para salvar este ativo no seu cofre seguro. O card será perdido se não consolidar.'
            : 'VAULT LOCKED: Login required to save this asset to your secure vault. Card will be lost if not consolidated.', 'error');
        downloadBtn.disabled = false;
        downloadBtn.innerText = originalBtnText;
        isProcessingClaim = false;
        navigateTo('auth');
        return;
    }

    // Saldo insuficiente: aborta sem debitar nada
    if (activeAssetData.costToClaim > 0 && currentUser.bumps < activeAssetData.costToClaim) {
        downloadBtn.disabled = false;
        downloadBtn.innerText = originalBtnText;
        isProcessingClaim = false;
        playTerminalSound('error');
        openDepositModal();
        return;
    }

    try {
        // === ZONA CRÍTICA ===
        if (activeAssetData.costToClaim > 0) {
            const newBumps = currentUser.bumps - activeAssetData.costToClaim;
            const { error: bumpsErr } = await sb.from('profiles').update({ bumps: newBumps }).eq('id', currentUser.id);
            if (bumpsErr) { console.error('debitar bumps:', bumpsErr.message); throw bumpsErr; }
            currentUser.bumps = newBumps;
            const profBumpsEl = document.getElementById('profBumps');
            if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
        }
        clearInterval(decayInterval);

        // Clona dados antes de qualquer limpeza de estado
        const assetSnapshot = { ...activeAssetData, creator: currentUser.username, registered: true };

        // ── PROVENIÊNCIA: injeta hash + timestamp de nascimento ──
        attachProvenance(assetSnapshot);

        // Salvaguarda extra: impede duplicado se ID já existir no cofre
        const alreadyOwned = savedAssets.some(a => a.id === assetSnapshot.id);
        if (!alreadyOwned) {
            const inserted = await insertCardToSupabase(assetSnapshot, currentUser.id);
            if (!inserted) throw new Error('Falha ao gravar card no Supabase.');
            savedAssets.push(inserted);
        }

        // Limpa estado do drop ANTES do alert
        activeAssetData = null;
        lastMintedBuffer = null;
        downloadBtn.style.display = "none";
        downloadBtn.disabled = false;
        downloadBtn.innerText = originalBtnText;
        stabilityWrapper.style.display = "none";
        document.getElementById('status-text').innerText = currentLang === 'PT' ? "ATIVO_SALVO_NO_COFRE" : "ASSET_SAVED_TO_VAULT";

        playTerminalSound('claim');
        speakPhrase("Ativo integrado ao seu cofre.", "Asset integrated into your vault.");

        // Ledger entry
        pushLedger(`${currentUser.username} resgatou o card ${assetSnapshot.id} [${assetSnapshot.rarityNameEN}]`);

        showCyberAlert('PROCESSO_CONCLUÍDO:', currentLang === 'PT' ? 'Consolidado no seu cofre seguro!' : 'Consolidated into your secure vault!', 'success');

    } catch (e) {
        console.error(e);
        showCyberAlert('ERRO_DE_REDE:', currentLang === 'PT' ? 'Falha ao salvar no cofre. Tenta novamente.' : 'Failed to save to vault. Try again.', 'error');
        downloadBtn.disabled = false;
        downloadBtn.innerText = originalBtnText;
    } finally {
        isProcessingClaim = false;
    }
}

// =========================================================
// EXPOR/RETIRAR DA VITRINE — exemplo do padrão a seguir para as
// demais ações do cofre (venda, presente, etc., nas próximas partes)
// =========================================================
async function toggleExposeAsset(index) {
    const asset = savedAssets[index];
    if (asset.isListed) {
        playSynthSound('shatter');
        showCyberAlert('🔒 ATIVO BLOQUEADO EM CUSTÓDIA NO MERCADO', 'Este card está listado no mercado e está em custódia. Remove o anúncio primeiro para alterar o seu estado.', 'error');
        return;
    }
    const novoEstado = !asset.exposed;
    savedAssets[index].exposed = novoEstado;

    const ok = await updateCardInSupabase(asset, { exposed: novoEstado });
    if (!ok) {
        // rollback do estado local se a escrita remota falhar
        savedAssets[index].exposed = !novoEstado;
        showCyberAlert('ERRO_DE_REDE:', 'Não foi possível atualizar a vitrine. Tenta novamente.', 'error');
        renderVaultGrid();
        return;
    }

    // Nota: não há mais sincronia manual com um array local de mercado —
    // a visibilidade no mercado é 100% derivada de cards.for_sale/is_listed
    // no Supabase, lida sob demanda por loadMarketFromSupabase() sempre que
    // a tela de mercado é aberta.
    renderVaultGrid();
}
// =========================================================
// DROP STATION — PARTE 3/4: INVENTÁRIO / ITENS (SUPABASE)
// SUBSTITUI no script.js original:
//   - função getUserInventory
//   - função consumeInventoryItem (agora assíncrona!)
// ADICIONA (novo):
//   - loadInventoryFromSupabase
//   - grantInventoryItem
//   - seedStarterInventory
//
// ⚠️ BREAKING CHANGE: consumeInventoryItem agora é async (precisa de
// `await`). Em forjarFusao() e fuseCards() (Parte 4), as linhas:
//     modificadores.forEach(m => consumeInventoryItem(m.itemId));
// devem virar:
//     for (const m of modificadores) { await consumeInventoryItem(m.itemId); }
// Isso já vai estar pronto na Parte 4 — só citando aqui pra não estranhar.
//
// INTEGRAÇÃO COM A PARTE 1 (auth-supabase-part.js):
//   1) Em createProfile(), depois do insert do profile, chame:
//        await seedStarterInventory(userId);
//   2) Em applyProfileToCurrentUser(profile), a linha `inventory: []`
//      é só o valor inicial — o carregamento real entra logo depois,
//      em restoreCurrentSession() e no LOGIN de handleAuthSubmit:
//        currentUser.inventory = await loadInventoryFromSupabase(currentUser.id);
// =========================================================

// =========================================================
// CATÁLOGO DE ITENS (mantido client-side — é config estática, não dado de usuário)
// Mesma definição do ITEMS_DB original do script.js.
// =========================================================
const ITEMS_DB = {
    catalisador_estabilidade: {
        category: 'PROTETOR', consumedOnUse: true,
        effect: { type: 'SURVIVAL_BONUS', value: 0.15 },
        name: 'Catalisador de Estabilidade', nameEN: 'Stability Catalyst'
    },
    nucleo_backup: {
        category: 'PROTETOR', consumedOnUse: true,
        effect: { type: 'INSURANCE_BREAK' },
        name: 'Núcleo de Backup', nameEN: 'Backup Core'
    },
    essencia_neon_amarelo: {
        category: 'CATALISADOR', consumedOnUse: true,
        effect: { type: 'FORCE_PALETTE', value: 'gold' },
        name: 'Essência de Neon Amarelo', nameEN: 'Yellow Neon Essence'
    },
    injetor_overclock: {
        category: 'CATALISADOR', consumedOnUse: true,
        effect: { type: 'OVERCLOCK', riskDelta: 0.20, fusionCountBonus: 2 },
        name: 'Injetor de Overclock', nameEN: 'Overclock Injector'
    },
    poeira_silicio: {
        category: 'MOEDA_ENTRADA', consumedOnUse: true,
        effect: { type: 'COST' },
        name: 'Poeira de Silício', nameEN: 'Silicon Dust'
    },
    sucata_circuitos: {
        category: 'MOEDA_ENTRADA', consumedOnUse: true,
        effect: { type: 'COST' },
        name: 'Sucata de Circuitos', nameEN: 'Circuit Scrap'
    }
};

// Kit inicial dado a todo usuário recém-registrado (substitui o que os SEED_USERS faziam)
const STARTER_KIT = [
    { templateId: 'poeira_silicio', category: 'MOEDA_ENTRADA', qty: 5 },
    { templateId: 'catalisador_estabilidade', category: 'PROTETOR', qty: 1 }
];

// =========================================================
// MAPEAMENTO DB <-> OBJETO EM MEMÓRIA
// (mantém o mesmo shape original: { itemId, templateId, category, qty })
// =========================================================
function rowToInventoryItem(row) {
    return {
        _dbId: row.id,
        itemId: row.item_id,
        templateId: row.template_id,
        category: row.category,
        qty: row.qty
    };
}

// =========================================================
// LEITURA: carrega o inventário completo do usuário
// =========================================================
async function loadInventoryFromSupabase(userId) {
    const { data, error } = await sb.from('inventario').select('*').eq('id_usuario', userId).order('created_at', { ascending: true });
    if (error) { console.error('loadInventoryFromSupabase:', error.message); return []; }
    return data.map(rowToInventoryItem);
}

// =========================================================
// CONCESSÃO: adiciona (ou incrementa) um item no inventário do usuário
// Usado pro kit inicial, recompensas de missão, drops especiais, etc.
// =========================================================
async function grantInventoryItem(userId, templateId, qty = 1) {
    const tpl = ITEMS_DB[templateId];
    if (!tpl) { console.warn('grantInventoryItem: template desconhecido', templateId); return null; }

    // Se já existe uma pilha desse item pro usuário, incrementa em vez de duplicar linha
    const { data: existing, error: findErr } = await sb.from('inventario')
        .select('*').eq('id_usuario', userId).eq('template_id', templateId).maybeSingle();
    if (findErr) { console.error('grantInventoryItem (find):', findErr.message); return null; }

    if (existing) {
        const { data, error } = await sb.from('inventario')
            .update({ qty: existing.qty + qty })
            .eq('id', existing.id).select().single();
        if (error) { console.error('grantInventoryItem (update):', error.message); return null; }
        return rowToInventoryItem(data);
    }

    const itemId = `item_${templateId}_${Date.now().toString(36)}`;
    const { data, error } = await sb.from('inventario').insert({
        id_usuario: userId,
        item_id: itemId,
        template_id: templateId,
        category: tpl.category,
        qty,
        effect: tpl.effect,
        consumed_on_use: tpl.consumedOnUse
    }).select().single();
    if (error) { console.error('grantInventoryItem (insert):', error.message); return null; }
    return rowToInventoryItem(data);
}

// =========================================================
// SEED: dá o kit inicial a um usuário recém-registrado
// =========================================================
async function seedStarterInventory(userId) {
    for (const item of STARTER_KIT) {
        await grantInventoryItem(userId, item.templateId, item.qty);
    }
}

// =========================================================
// LEITURA LOCAL: acessor do inventário em memória (mantém compat. com chamadas existentes)
// =========================================================
function getUserInventory() {
    if (!Array.isArray(currentUser.inventory)) currentUser.inventory = [];
    return currentUser.inventory;
}

// =========================================================
// CONSUMO: remove (ou decrementa) um item após uso numa fusão
// ⚠️ Agora é ASYNC — quem chama precisa usar `await`.
// =========================================================
async function consumeInventoryItem(itemId) {
    const inv = getUserInventory();
    const idx = inv.findIndex(i => i.itemId === itemId);
    if (idx === -1) return false;
    const item = inv[idx];

    if (item.qty && item.qty > 1) {
        const ok = await updateInventoryItemQty(item, item.qty - 1);
        if (!ok) return false;
        item.qty -= 1;
    } else {
        const ok = await deleteInventoryItem(item);
        if (!ok) return false;
        inv.splice(idx, 1);
    }
    return true;
}

async function updateInventoryItemQty(item, newQty) {
    if (!item._dbId) { console.warn('updateInventoryItemQty: item sem _dbId', item.itemId); return false; }
    const { error } = await sb.from('inventario').update({ qty: newQty }).eq('id', item._dbId);
    if (error) { console.error('updateInventoryItemQty:', error.message); return false; }
    return true;
}

async function deleteInventoryItem(item) {
    if (!item._dbId) { console.warn('deleteInventoryItem: item sem _dbId', item.itemId); return false; }
    const { error } = await sb.from('inventario').delete().eq('id', item._dbId);
    if (error) { console.error('deleteInventoryItem:', error.message); return false; }
    return true;
}



// =========================================================
// DROP STATION — PARTE 5/4: FOLLOW REAL + MERCADO REAL (SUPABASE)
// Requer rodar antes: schema_passo5_followers_e_mercado.sql
// (cria public.followers + function buy_market_card)
//
// SUBSTITUI no script.js original:
//   - toda a "PERSISTÊNCIA DO MERCADO (dr0p_market)" baseada em
//     localStorage (MARKET_KEY, loadMarket, saveMarket, marketAssets
//     como array em memória solta)
//   - currentUser.followedByMe / followers hardcoded (12, 4, false)
//
// ADICIONA (novo):
//   - loadMarketFromSupabase / listCardOnMarket / unlistCardFromMarket / buyCardFromMarket
//   - fetchFollowState / followUser / unfollowUser / getFollowerCount / getFollowingCount
//
// INTEGRAÇÃO:
//   1) Em renderMarketGrid() (script.js ~linha 2163), troque a leitura
//      de `marketAssets` (array local) por `await loadMarketFromSupabase()`
//      no início da função, ou chame loadMarketFromSupabase() sempre que
//      `navigateTo('market')` for disparado (ver navigateTo, linha 1055)
//      e guarde o resultado na MESMA variável `marketAssets` que o resto
//      do código já lê — assim você não precisa reescrever renderMarketGrid
//      inteira, só a fonte dos dados.
//   2) Troque marketListPrompt (linha 2066) e os pontos que fazem
//      `marketAssets.push(...)` / `marketAssets.filter(...)` + `saveMarket(...)`
//      por chamadas a listCardOnMarket / unlistCardFromMarket / buyCardFromMarket.
//   3) Em viewTargetUserCollection (linha 3564), depois de carregar o
//      perfil-alvo, chame fetchFollowState(targetUserId) pra popular o
//      botão de seguir e os contadores reais.
// =========================================================

// =========================================================
// MERCADO — fonte de verdade é a tabela `cards` (for_sale + is_listed)
// Não existe mais array local persistido em localStorage.
// =========================================================

async function loadMarketFromSupabase() {
    const { data, error } = await sb.from('cards')
        .select('*')
        .eq('for_sale', true)
        .eq('is_listed', true)
        .order('created_at', { ascending: false });
    if (error) { console.error('loadMarketFromSupabase:', error.message); return []; }
    return data.map(rowToCard);
}

// Lista um card do PRÓPRIO cofre no mercado (dono = usuário logado,
// então isso usa o update normal, já coberto pela policy cards_update_own).
async function listCardOnMarket(card, price) {
    if (!card._dbId) { console.warn('listCardOnMarket: card sem _dbId', card.id); return false; }
    if (!price || price <= 0) { console.warn('listCardOnMarket: preço inválido', price); return false; }

    const { error } = await sb.from('cards')
        .update({ for_sale: true, is_listed: true, price })
        .eq('id', card._dbId)
        .eq('id_usuario', currentUser.id); // defesa extra além da RLS
    if (error) { console.error('listCardOnMarket:', error.message); return false; }

    card.forSale = true;
    card.isListed = true;
    card.price = price;
    return true;
}

// Remove o próprio card do mercado (volta pro cofre normal).
async function unlistCardFromMarket(card) {
    if (!card._dbId) { console.warn('unlistCardFromMarket: card sem _dbId', card.id); return false; }

    const { error } = await sb.from('cards')
        .update({ for_sale: false, is_listed: false, price: 0 })
        .eq('id', card._dbId)
        .eq('id_usuario', currentUser.id);
    if (error) { console.error('unlistCardFromMarket:', error.message); return false; }

    card.forSale = false;
    card.isListed = false;
    card.price = 0;
    return true;
}

// Compra um card de OUTRO usuário. Não pode ser um update direto via RLS
// (a policy cards_update_own só libera o dono), então passa pela function
// security definer `buy_market_card`, que valida saldo/listagem e faz a
// transferência (débito/crédito de bumps + troca de id_usuario) de forma
// atômica no banco.
async function buyCardFromMarket(cardDbId) {
    if (!currentUser.loggedIn) {
        showCyberAlert('ACESSO_NEGADO:', 'Faça login para comprar no mercado.', 'error');
        return { ok: false, reason: 'NOT_LOGGED_IN' };
    }

    const { data, error } = await sb.rpc('buy_market_card', {
        p_card_id: cardDbId,
        p_buyer_id: currentUser.id
    });

    if (error) {
        const reason = error.message || '';
        const MENSAGENS = {
            CARD_NAO_ENCONTRADO: 'Este card não existe mais.',
            CARD_NAO_ESTA_LISTADO: 'Este card não está mais à venda.',
            NAO_PODE_COMPRAR_PROPRIO_CARD: 'Você não pode comprar seu próprio card.',
            SALDO_INSUFICIENTE: 'Saldo insuficiente para esta compra.',
            COMPRADOR_NAO_ENCONTRADO: 'Falha ao validar seu perfil. Tenta novamente.'
        };
        const friendly = Object.keys(MENSAGENS).find(k => reason.includes(k));
        showCyberAlert('ERRO_DE_COMPRA:', friendly ? MENSAGENS[friendly] : 'Falha ao concluir a compra. Tenta novamente.', 'error');
        console.error('buyCardFromMarket:', reason);
        return { ok: false, reason };
    }

    // Atualiza saldo local do comprador refazendo fetch do profile
    // (mais seguro que decrementar localmente, já que o débito real
    // aconteceu dentro da function no banco).
    const refreshedProfile = await fetchProfile(currentUser.id);
    if (refreshedProfile) {
        currentUser.bumps = refreshedProfile.bumps;
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
    }

    return { ok: true, card: rowToCard(data) };
}

// =========================================================
// FOLLOW — tabela public.followers (follower_id, following_id)
// =========================================================

async function fetchFollowState(targetUserId) {
    if (!targetUserId) return { followedByMe: false, followers: 0, following: 0 };

    const [meFollowsThemQ, followersCountQ, followingCountQ] = await Promise.all([
        currentUser.loggedIn
            ? sb.from('followers').select('id', { count: 'exact', head: true })
                .eq('follower_id', currentUser.id).eq('following_id', targetUserId)
            : Promise.resolve({ count: 0 }),
        sb.from('followers').select('id', { count: 'exact', head: true }).eq('following_id', targetUserId),
        sb.from('followers').select('id', { count: 'exact', head: true }).eq('follower_id', targetUserId)
    ]);

    return {
        followedByMe: (meFollowsThemQ.count || 0) > 0,
        followers: followersCountQ.count || 0,
        following: followingCountQ.count || 0
    };
}

async function followUser(targetUserId) {
    if (!currentUser.loggedIn) {
        showCyberAlert('ACESSO_NEGADO:', 'Faça login para seguir outros operadores.', 'error');
        return false;
    }
    if (targetUserId === currentUser.id) return false;

    const { error } = await sb.from('followers').insert({
        follower_id: currentUser.id,
        following_id: targetUserId
    });
    // unique constraint: se já seguia, o insert falha com 23505 — trata como sucesso silencioso
    if (error && error.code !== '23505') {
        console.error('followUser:', error.message);
        showCyberAlert('ERRO_DE_REDE:', 'Não foi possível seguir este operador. Tenta novamente.', 'error');
        return false;
    }
    return true;
}

async function unfollowUser(targetUserId) {
    if (!currentUser.loggedIn) return false;

    const { error } = await sb.from('followers').delete()
        .eq('follower_id', currentUser.id)
        .eq('following_id', targetUserId);
    if (error) {
        console.error('unfollowUser:', error.message);
        showCyberAlert('ERRO_DE_REDE:', 'Não foi possível deixar de seguir. Tenta novamente.', 'error');
        return false;
    }
    return true;
}

// Helper de UI: alterna follow/unfollow e re-renderiza o estado do botão.
// Chame isso a partir do onclick do botão de seguir na tela de perfil.
async function toggleFollowTarget(targetUserId, btnEl) {
    if (!targetUserId || targetUserId === currentUser.id) return;
    if (btnEl) btnEl.disabled = true;

    const state = await fetchFollowState(targetUserId);
    const ok = state.followedByMe ? await unfollowUser(targetUserId) : await followUser(targetUserId);

    if (ok && btnEl) {
        const newState = await fetchFollowState(targetUserId);
        btnEl.innerText = newState.followedByMe ? 'SEGUINDO' : 'SEGUIR';
        btnEl.classList.toggle('following-active', newState.followedByMe);
        const followersCountEl = document.getElementById('lbl-followers');
        if (followersCountEl) followersCountEl.innerText = newState.followers;
    }
    if (btnEl) btnEl.disabled = false;
}
