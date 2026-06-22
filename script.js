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
    bio: "Explorador da rede dr0p_station.", avatar: "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", avatarFrame: "frame-style-1", banner: "",
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
const PUBLIC_PROFILE_COLUMNS = 'id, username, bumps, code, bio, avatar, avatar_frame, banner, status, following, fusion_count, cosmetics, equipped_cosmetics, fragments, created_at, updated_at';

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
    fusion_count: 'fusion_count', cosmetics: 'cosmetics', equippedCosmetics: 'equipped_cosmetics', fragments: 'fragments'
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
        bio: "Explorador da rede dr0p_station.", avatar: "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", avatarFrame: "frame-style-1", banner: "",
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
// LOGIN / REGISTRO
// =========================================================
async function handleAuthSubmit(event) {
    event.preventDefault();
    const errorEl = document.getElementById('authErrorMsg');
    errorEl.style.display = 'none';
    const submitBtn = document.getElementById('authSubmitBtn');

    // TUDO dentro do try/catch agora — incluindo validações de username/senha
    // e a checagem de bloqueio por tentativas falhas. Antes essas checagens
    // rodavam ANTES do try, então qualquer erro inesperado ali (ex: acesso a
    // sessionStorage bloqueado pelo navegador) travava o clique inteiro sem
    // nenhuma mensagem visível — exatamente o sintoma relatado. Agora, se
    // algo desse tipo acontecer, cai no catch e mostra "Falha de comunicação
    // com a rede" em vez de não fazer nada.
    try {
        const rawUser = document.getElementById('authUsername').value;
        const rawPass = document.getElementById('authPassword').value;

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

        submitBtn.disabled = true;
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
                showCyberAlert('// ACESSO_BLOQUEADO //', 'dr0p_station é uma rede exclusiva para operadores +18. Este terminal não pode ser consolidado por menores de idade.', 'error');
                return;
            }
            if (!termsOk) {
                errorEl.innerText = 'Você precisa aceitar os Termos de Uso e a Política de Privacidade para continuar.';
                errorEl.style.display = 'block';
                return;
            }

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

        let profile = await fetchProfile(data.user.id);

        if (!profile) {
            // AUTO-CURA: auth válido mas sem profile pelo auth.uid.
            // Causas comuns:
            //   A) Cadastro interrompido antes de gravar o profile.
            //   B) Conta Auth recriada — o profile antigo tem id diferente.
            //
            // Solução: busca o profile pelo username digitado (sem mexer no id),
            // e usa ele diretamente sobrescrevendo o id em memória para a sessão.
            // Não tentamos alterar a PK no banco (Supabase bloqueia via RLS).

            let recovered = null;

            try {
                const { data: byUsername } = await sb
                    .from('profiles')
                    .select(PUBLIC_PROFILE_COLUMNS)
                    .ilike('username', formattedUser)
                    .maybeSingle();

                if (byUsername) {
                    // Encontrou o profile pelo username — usa ele diretamente.
                    // Sobrescreve o id em memória para que o restante do app
                    // funcione com o auth.uid atual (gravações futuras usam o id correto).
                    recovered = { ...byUsername, id: data.user.id };
                }
            } catch(e) {
                console.warn('auto-heal (busca por username):', e);
            }

            // Se não achou pelo username, tenta criar um profile novo
            if (!recovered) {
                recovered = await createProfile(data.user.id, formattedUser, data.user.email);
            }

            if (!recovered) {
                errorEl.innerText = 'Não foi possível localizar seu perfil. Verifique se o username está correto ou registre uma nova conta.';
                errorEl.style.display = 'block';
                return;
            }

            profile = recovered;
        }

        // Fluxo normal de login (serve tanto para o caminho direto quanto para o auto-heal)
        messageThreads = {};
        activeThreadUser = null;
        const prevAssets = [...(savedAssets || [])];
        applyProfileToCurrentUser(profile);
        savedAssets = await loadCardsFromSupabase(currentUser.id);
        currentUser.inventory = await loadInventoryFromSupabase(currentUser.id);
        checkIncomingGifts(prevAssets, savedAssets);
        await refreshPendingGifts();
        initGiftRealtime();
        await refreshIncomingProposals();
        initProposalsRealtime();
        playTerminalSound('login');
        resumePendingContracts();
        navigateTo('engine');

    } catch (e) {
        console.error(e);
        // DEBUG TEMPORÁRIO: mostra o erro real na tela em vez de uma mensagem
        // genérica, pra conseguir diagnosticar sem precisar abrir o console.
        const detail = (e && (e.message || e.error_description || e.toString())) || 'erro desconhecido';
        errorEl.innerText = "Falha de comunicação com a rede: " + detail;
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
    pendingGiftsCache = [];
    _setGiftFabState([]);
    _incomingProposalsCache = [];
    _setProposalBadgeState([]);
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
    // LEDGER_KEY removido: o ledger global agora vive na tabela pública
    // `eventos_globais` (ver ledgerCache / pushLedger / fetchAndSeedGlobalEvents),
    // não mais em localStorage.

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
    // BUGFIX (site "zerado" em aba anônima/outra conta): isto ANTES lia/
    // escrevia em localStorage (LEDGER_KEY), que é local a cada navegador —
    // nenhuma outra aba/sessão via essas entradas. Agora `ledgerCache` é só
    // um espelho em memória da tabela pública `eventos_globais`, populado
    // no boot por fetchAndSeedGlobalEvents() e mantido vivo por Realtime
    // (ver initGlobalRealtime(), mais abaixo) — qualquer aba, logada ou
    // anônima, vê a MESMA lista, atualizada instantaneamente.
    // =========================================================
    let ledgerCache = [];
    function loadLedger() {
        return ledgerCache;
    }
    async function pushLedger(entry) {
        // Só usuários autenticados geram atividade real e atribuível —
        // mesmo padrão de RLS usado em cards/inventario (auth.uid() = id_usuario).
        if (!currentUser.loggedIn) return;
        try {
            const { error } = await sb.from('eventos_globais').insert({
                id_usuario: currentUser.id,
                username: currentUser.username,
                tipo: 'ledger',
                mensagem: entry
            });
            if (error) console.error('pushLedger:', error.message);
        } catch (e) { console.error('pushLedger:', e); }
        // Não precisa atualizar ledgerCache/renderMarketLedger aqui na mão —
        // o INSERT acima dispara o evento Realtime em initGlobalRealtime(),
        // que já cuida de inserir no cache e re-renderizar pra TODO mundo
        // (inclusive esta própria aba), de forma consistente.
    }

    function renderMarketLedger() {
        const box  = document.getElementById('marketLedgerBox');
        const list = document.getElementById('marketLedgerList');
        if (!box || !list) return;
        const ledger = loadLedger();
        if (ledger.length === 0) { box.style.display = 'none'; stopLedgerAutoScroll(); return; }
        box.style.display = 'block';
        const last10 = ledger.slice(0, 10);
        list.innerHTML = last10.map((e, i) =>
            `<div class="ledger-entry ledger-entry-expanded" style="animation-delay:${i * 0.08}s;">
                <span class="ledger-ts">[${e.ts}]</span>
                <span class="ledger-text">${e.text}</span>
             </div>`
        ).join('');
        startLedgerAutoScroll(list);
    }

    // Faz o feed "respirar": rola suavemente para o próximo item a cada
    // poucos segundos, dando sensação de movimento contínuo e dinâmico.
    //
    // BUGFIX (scroll vazando pra página inteira): `entries[idx].scrollIntoView()`
    // sobe por TODOS os ancestrais roláveis até a window, pra garantir a
    // visibilidade total do elemento — então, a cada 2.6s, o "respiro" do
    // ledger também arrastava a PÁGINA INTEIRA junto (mesmo #marketLedgerBox
    // já tendo seu próprio overflow-y:auto). Trocado por scroll manual via
    // scrollTop/scrollTo, isolado SÓ no container interno do ledger — nunca
    // mais toca no scroll da janela. State também isolado: o timer agora é
    // explicitamente encerrado (stopLedgerAutoScroll) sempre que o ledger
    // fica vazio/escondido ou quando o usuário sai da tela de Mercado
    // (ver navigateTo), evitando rodar em segundo plano sem necessidade.
    let ledgerAutoScrollTimer = null;
    function startLedgerAutoScroll(list) {
        if (ledgerAutoScrollTimer) clearInterval(ledgerAutoScrollTimer);
        const entries = list.querySelectorAll('.ledger-entry');
        if (entries.length <= 1) return;

        const scrollBox = list.closest('#marketLedgerBox') || list.parentElement;
        let idx = 0;
        ledgerAutoScrollTimer = setInterval(() => {
            idx = (idx + 1) % entries.length;
            if (!scrollBox) return;
            const target = entries[idx].offsetTop - scrollBox.offsetTop;
            if (typeof scrollBox.scrollTo === 'function') {
                scrollBox.scrollTo({ top: target, behavior: 'smooth' });
            } else {
                scrollBox.scrollTop = target;
            }
        }, 2600);
    }
    function stopLedgerAutoScroll() {
        if (ledgerAutoScrollTimer) { clearInterval(ledgerAutoScrollTimer); ledgerAutoScrollTimer = null; }
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

    // Política de Privacidade — modal próprio (rolável), reaproveita o
    // visual do cyber-alert mas com sua própria overlay/box para não
    // conflitar com showCyberAlert() caso algo dispare um alerta por trás.
    function openPrivacyPolicy() {
        const overlay = document.getElementById('privacyPolicyOverlay');
        if (overlay) overlay.classList.add('visible');
    }
    function closePrivacyPolicy() {
        const overlay = document.getElementById('privacyPolicyOverlay');
        if (overlay) overlay.classList.remove('visible');
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

    // =========================================================
    // FEED GLOBAL DE MUTAÇÕES/FUSÕES (Ponto 1) — AGORA REAL E PÚBLICO
    // BUGFIX (site "zerado" em aba anônima/outra conta): isto ANTES persistia
    // em localStorage (GLOBAL_FEED_KEY) — cada navegador/aba só via os
    // próprios drops/fusões, nunca os de mais ninguém. `globalFeed` segue
    // existindo como array em memória (buildStoriesMarquee() e o resto do
    // app continuam lendo daqui sem mudança), mas quem alimenta esse array
    // agora é a tabela pública `eventos_globais` (tipo='feed'), carregada no
    // boot por fetchAndSeedGlobalEvents() e atualizada ao vivo por
    // initGlobalRealtime() — qualquer aba, logada ou anônima, vê os MESMOS
    // drops/fusões em tempo real.
    //
    // BUGFIX (perfis fantasmas @cyber_k1ng / @neon_samurai): removido o
    // antigo SEED_FEED estático que era usado como "fallback cosmético"
    // antes do banco responder. Isso fazia QUALQUER aba mostrar dois cards
    // falsos por uma fração de segundo (ou indefinidamente, se o fetch
    // falhasse) — perfis que não existem no Supabase. Agora o estado
    // inicial é sempre um array vazio, e a UI mostra um aviso de
    // "carregando" explícito (ver globalFeedLoading + buildStoriesMarquee())
    // em vez de inventar dados, até a primeira resposta real da rede
    // chegar — mesmo que essa resposta seja "ainda não há nenhum evento".
    // =========================================================
    let globalFeed = [];
    let globalFeedLoading = true;

    // [BUGFIX MUTAÇÕES_REDE] Rede de segurança: se por qualquer motivo
    // (latência alta, aba aberta antes do Supabase client terminar de
    // inicializar, erro silencioso engolido por algum catch) a primeira
    // resposta de fetchAndSeedGlobalEvents() demorar mais que isto, força
    // globalFeedLoading=false e repinta — assim o usuário NUNCA vê o feed
    // travado pra sempre no "carregando", nem (pior) um "nenhum drop
    // aconteceu" que seria mentira por causa de uma resposta que ainda nem
    // chegou. Cancelado automaticamente assim que a resposta real chega
    // (ver fetchAndSeedGlobalEvents).
    let _globalFeedSafetyTimer = null;
    function _armGlobalFeedSafetyTimeout() {
        clearTimeout(_globalFeedSafetyTimer);
        _globalFeedSafetyTimer = setTimeout(() => {
            if (globalFeedLoading) {
                console.warn('[MUTAÇÕES_REDE] fetchAndSeedGlobalEvents demorou demais — tentando novamente.');
                fetchAndSeedGlobalEvents();
            }
        }, 6000);
    }

    // Mercado: array em memória que renderMarketGrid() lê/filtra/pagina.
    // Fonte de verdade real é a tabela `cards` no Supabase — este array é
    // só um CACHE preenchido por loadMarketFromSupabase() sempre que a
    // tela de mercado é aberta ou uma ação (listar/comprar/remover) muda
    // o estado, OU quando o Realtime de `cards` detecta uma mudança feita
    // por QUALQUER usuário (ver initGlobalRealtime()) — assim o mercado se
    // atualiza ao vivo pra todo mundo, sem precisar de F5.
    let marketAssets = [];

    // =========================================================
    // REALTIME GLOBAL (Supabase) — fonte real e pública de:
    //   • eventos_globais → ledger de mercado + feed de drops/fusões
    //   • cards            → listagens/vendas/vitrine, refletidas ao vivo
    // Substitui de raiz qualquer dependência de dados mockados/locais
    // (localStorage) pra esses dois feeds. Roda incondicionalmente no boot
    // do script (ver chamada de initGlobalRealtime() perto do
    // onAuthStateChange, Parte 1), ANTES de qualquer login — inclusive em
    // aba anônima, já que a leitura de ambas as tabelas é pública via RLS.
    // =========================================================
    function rowToLedgerEntry(row) {
        return { text: row.mensagem, ts: new Date(row.created_at).toLocaleTimeString('pt-PT') };
    }
    function rowToFeedCard(row) {
        return row.card_payload ? { ...row.card_payload, _eventId: row.id } : null;
    }

    // Publica um card consolidado (drop resgatado ou fusão bem-sucedida) no
    // feed público. Substitui os antigos `globalFeed.unshift(...) +
    // saveGlobalFeed(...)` — a re-renderização do marquee acontece via
    // Realtime (initGlobalRealtime), de forma consistente pra TODO mundo,
    // inclusive quem disparou a ação.
    async function pushFeedCard(cardLike) {
        if (!currentUser.loggedIn) return;
        try {
            const { error } = await sb.from('eventos_globais').insert({
                id_usuario: currentUser.id,
                username: currentUser.username,
                tipo: 'feed',
                mensagem: `${currentUser.username} consolidou ${cardLike.id} [${cardLike.rarityNameEN}]`,
                card_payload: cardLike
            });
            if (error) console.error('pushFeedCard:', error.message);
        } catch (e) { console.error('pushFeedCard:', e); }
    }

    // Busca os últimos eventos reais da rede e usa pra popular ledgerCache
    // (ledger do mercado) e globalFeed (marquee de stories) — chamado uma
    // única vez no boot, antes de qualquer subscrição Realtime.
    async function fetchAndSeedGlobalEvents() {
        _armGlobalFeedSafetyTimeout();
        const { data, error } = await sb.from('eventos_globais')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        clearTimeout(_globalFeedSafetyTimer);
        if (error) {
            console.error('fetchAndSeedGlobalEvents:', error.message);
            globalFeedLoading = false; // não deixa o aviso de "carregando" travado pra sempre em caso de falha de rede
            buildStoriesMarquee();
            return;
        }

        ledgerCache = data.map(rowToLedgerEntry);

        const feedCards = data.map(rowToFeedCard).filter(Boolean);
        // Sempre usa o que veio do banco — mesmo que seja um array vazio
        // (rede nova, sem eventos ainda). Não há mais fallback pra dados
        // estáticos/fantasma: array vazio é um estado real e válido.
        globalFeed = feedCards;
        globalFeedLoading = false;

        renderMarketLedger();
        buildStoriesMarquee();
    }

    // Assina os canais Realtime públicos. Roda incondicionalmente (logado
    // ou não) — é o que faz o ecossistema parecer "vivo" em QUALQUER aba,
    // inclusive anônima, sem precisar dar F5.
    let _globalRealtimeStarted = false;
    function initGlobalRealtime() {
        if (_globalRealtimeStarted) return; // evita assinar 2x (ex: hot reload / re-chamada acidental)
        _globalRealtimeStarted = true;

        fetchAndSeedGlobalEvents();

        // Ledger + marquee: qualquer INSERT em eventos_globais (de QUALQUER
        // usuário, em QUALQUER aba) chega aqui instantaneamente.
        sb.channel('eventos_globais_live')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos_globais' }, (payload) => {
                const row = payload.new;
                ledgerCache.unshift(rowToLedgerEntry(row));
                if (ledgerCache.length > 50) ledgerCache.length = 50;

                const card = rowToFeedCard(row);
                if (card) {
                    globalFeed.unshift(card);
                    if (globalFeed.length > 50) globalFeed.length = 50;
                    buildStoriesMarquee();
                }
                // Só repinta o ledger se a tela de mercado estiver mesmo
                // aberta — evita trabalho de DOM desnecessário em outras telas.
                const marketScreen = document.getElementById('screen-market');
                if (marketScreen && marketScreen.classList.contains('active')) renderMarketLedger();
            })
            .subscribe();

        // Mercado/vitrine: qualquer INSERT/UPDATE/DELETE em `cards` (nova
        // listagem, venda, remoção, exposição na vitrine) de QUALQUER
        // usuário atualiza a tela de mercado de todo mundo ao vivo.
        sb.channel('cards_live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, () => {
                const marketScreen = document.getElementById('screen-market');
                if (marketScreen && marketScreen.classList.contains('active')) renderMarketGrid();
            })
            .subscribe();
    }


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
            'faq-q1': '[+] O que é o dr0p_station?',
            'faq-a1': '▸ Plataforma P2P de cards digitais gerados por IA. Cada card é único, rastreado no registry e negociável em B$ (Bumps).',
            'faq-q2': '[+] O que são Bumps (B$)?',
            'faq-a2': '▸ Moeda interna da rede. Usada para resgatar cards épicos/lendários, comprar no mercado P2P e propor trocas. Carregue via PIX ou cripto.',
            'faq-q3': '[+] O que acontece se não resgatar a tempo?',
            'faq-a3': '▸ A mutação se autodestrói em 10 segundos por instabilidade de rede. O card é removido do feed global permanentemente.',
            'faq-q4': '[+] Como funciona a Alquimia?',
            'faq-a4': '▸ Funde 2 cards do seu cofre para criar um novo. Os originais são destruídos. Raridade resultante depende dos cards usados + roll de probabilidade.',
            'faq-q5': '[+] Quem pode ver meu perfil e cards?',
            'faq-a5': '▸ Perfis públicos são visíveis a todos. Cards expostos na vitrine aparecem no feed. O mercado é público mas compras exigem login.',
            'faq-q6': '[+] Existe risco de perder cards na Fornalha ou em Contratos?',
            'faq-a6': '▸ Sim. Tanto a Fornalha de Sobrecarga quanto os Contratos envolvem risco real de destruição permanente da carta submetida — uma vez confirmada a operação, instabilidades de rede podem corromper o ativo sem aviso prévio, sem direito a estorno. Cards destruídos rendem Fragmentos de Sucata como compensação parcial, nunca o card em si.',
            'faq-q7': '[+] De onde vêm as artes dos cards?',
            'faq-a7': '▸ O terminal intercepta sinais soltos pela rede mundial — referências de cultura pop, memes e ruído visual coletivo — e os processa através de algoritmos de mutação visual próprios. O resultado é uma paródia artística reinterpretada e única, gerada pela própria rede dr0p_station.',
            'log-prefix': 'LOG // ', 'download-btn': 'RESGATAR ATIVO',
            'stability-label': 'TEMPO DE RESGATE: 10s',
            'market-landing-sub': 'VISUALIZAÇÃO PÚBLICA — LOGIN NECESSÁRIO PARA COMPRAR',
            'premium-instant-badge': '✓ RESGATE GARANTIDO // COMPILAÇÃO IMEDIATA'
        },
        EN: {
            'nav-market': 'P2P MARKET', 'nav-inbox': 'SECRET INBOX', 'nav-vault': 'MY VAULT', 'nav-access': 'ACCESS TERMINAL',
            'feed-title': 'NETWORK_MUTATIONS', 'lbl-rarity': 'RARITY', 'lbl-style': 'VISUAL STYLE', 'lbl-creator': 'MINT AUTHOR',
            'vault-title': 'MY SECURE VAULT', 'market-title': 'P2P MARKET DIRECT', 'messages-title': 'INBOX // ENCRYPTED_CHATS', 'profile-showcase': 'EXPOSED SHOWCASE',
            'lbl-id': 'CARD ID CODE', 'free-sub': 'RISK OF SHATTER // UNSTABLE FLOW', 'premium-sub': '100% SECURE // COMPILATION WARRANTY',
            'faq-title': '> TERMINAL_INFO // FREQUENTLY ASKED',
            'faq-q1': '[+] What is dr0p_station?',
            'faq-a1': '▸ P2P platform for AI-generated digital cards. Each card is unique, tracked in the registry and tradeable in B$ (Bumps).',
            'faq-q2': '[+] What are Bumps (B$)?',
            'faq-a2': '▸ Internal network currency. Used to claim epic/legendary cards, buy on P2P market and propose trades. Load via PIX or crypto.',
            'faq-q3': '[+] What happens if I don\'t claim in time?',
            'faq-a3': '▸ The mutation self-destructs in 10 seconds due to network instability. The card is permanently removed from the global feed.',
            'faq-q4': '[+] How does Alchemy work?',
            'faq-a4': '▸ Fuse 2 cards from your vault to create a new one. Originals are destroyed. Resulting rarity depends on input cards + probability roll.',
            'faq-q5': '[+] Who can see my profile and cards?',
            'faq-a5': '▸ Public profiles visible to all. Cards exposed in showcase appear in feed. Market is public but purchases require login.',
            'faq-q6': '[+] Is there a risk of losing cards in the Furnace or Contracts?',
            'faq-a6': '▸ Yes. Both the Overload Furnace and Contracts carry a real risk of permanent destruction of the submitted card — once the operation is confirmed, network instabilities can corrupt the asset without prior warning, with no refund. Destroyed cards yield Scrap Fragments as partial compensation, never the card itself.',
            'faq-q7': '[+] Where do the card arts come from?',
            'faq-a7': '▸ The terminal intercepts stray signals from the global network — pop culture references, memes and collective visual noise — and processes them through proprietary visual mutation algorithms. The result is a unique, reinterpreted artistic parody generated by the dr0p_station network itself.',
            'log-prefix': 'LOG // ', 'download-btn': 'CLAIM ASSET',
            'stability-label': 'CLAIM TIME LEFT: 10s',
            'market-landing-sub': 'PUBLIC VIEW — LOGIN REQUIRED TO PURCHASE',
            'premium-instant-badge': '✓ GUARANTEED CLAIM // IMMEDIATE COMPILATION'
        }
    };

    const CYBER_VOICES = {
        PT: [
            "Acesso concedido.", "Brecha de dados detectada.", "dr0p_station online.", "Mutação instável.",
            "Ativo integrado ao cofre.", "Protocolo de fusão iniciado.", "Rede segura estabelecida.",
            "Identidade verificada.", "Transmissão criptografada.", "Alerta de rede ativado.",
            "Compra confirmada.", "Card lendário detectado.", "Terminal ativado. Bem-vindo, operador."
        ],
        EN: [
            "Access granted.", "Data breach detected.", "dr0p_station online.", "Mutation unstable.",
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

        } else if (type === 'overload') {
            // Sirene ciberpunk: dois tons alternando 3x + voz específica de sobrecarga
            beep(1800, 'sawtooth', 0.18, 0.25);
            setTimeout(() => beep(900,  'sawtooth', 0.18, 0.22), 220);
            setTimeout(() => beep(1800, 'sawtooth', 0.18, 0.22), 440);
            setTimeout(() => beep(900,  'sawtooth', 0.18, 0.20), 660);
            setTimeout(() => beep(1800, 'sawtooth', 0.18, 0.20), 880);
            setTimeout(() => beep(600,  'square',   0.35, 0.18), 1100);
            setTimeout(() => speakPhrase(
                "Alerta crítico. Sobrecarga na rede detectada. Chance de drop épico aumentada por cinco minutos.",
                "Critical alert. Network overload detected. Epic drop rate increased for five minutes."
            ), 1500);
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

    function navigateTo(screenId, skipProfileReload) {
        try { playSynthSound('click'); } catch(e) {}

        // Limpa estado anterior do drop ao sair do engine, evitando botão travado/duplicação
        try {
            if (screenId !== 'engine') {
                downloadBtn.disabled = false;
            } else {
                downloadBtn.disabled = false;
            }
        } catch(e) {}

        try {
            document.querySelectorAll('.spa-screen').forEach(s => s.classList.remove('active'));
            const t = document.getElementById(`screen-${screenId}`);
            if(t) t.classList.add('active');
        } catch(e) { console.warn('navigateTo screen switch error:', e); return; }

        try { if (screenId === 'engine') { setTimeout(resizeCanvases, 50); renderDailyDropButton(); renderDailyMissions(); renderDropStyleFilters(); } } catch(e) { console.warn('navigateTo engine init:', e); }
        try { if (screenId === 'leaderboard') renderLeaderboard(); } catch(e) { console.warn('navigateTo leaderboard:', e); }
        try { if (screenId === 'vault') renderVaultGrid(); } catch(e) { console.warn('navigateTo vault:', e); }
        try { if (screenId === 'market') { renderMarketGrid(); renderMarketLedger(); } else { stopLedgerAutoScroll(); } } catch(e) { console.warn('navigateTo market:', e); }
        try { if (screenId === 'messages') { renderChatThreads(); renderGlobalOffers('offersContainer'); } } catch(e) { console.warn('navigateTo messages:', e); }
        // BUGFIX (redirecionamento): navegar para 'profile' SEMPRE recarregava os dados
        // do usuário logado, mesmo quando vínhamos de viewExternalProfile() (clique em
        // "VER PERFIL" no Inspect). Isso fazia a tela "voltar" pro próprio perfil
        // imediatamente após abrir o perfil de outra pessoa. Agora, quem já carregou
        // o perfil-alvo (ex: viewExternalProfile) passa skipProfileReload=true e
        // navigateTo não pisa em cima dos dados já renderizados.
        try {
            if (screenId === 'profile' && !skipProfileReload) {
                viewTargetUserCollection(currentUser.username, currentUser.code, currentUser.bio, currentUser.avatar, currentUser.banner, true);
            }
        } catch(e) { console.warn('navigateTo profile load:', e); }
        try { if (screenId === 'contracts') renderContractsScreen(); } catch(e) { console.warn('navigateTo contracts:', e); }
        try { if (screenId === 'loja') renderLoja(true); } catch(e) { console.warn('navigateTo loja:', e); }
    }

    // ── MENU HAMBÚRGUER MOBILE — REMOVIDO ───────────────────────────────
    // O menu hambúrguer foi eliminado do projeto. A navegação mobile agora
    // usa o mesmo .nav-menu-wrapper empilhado por flex-wrap, sem painel
    // suspenso nem botão de alternância.

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
        // URL pública de inspeção direta do card
        const cardDisplayId = encodeURIComponent(cardObj.id || cardObj.qr_code_hash);
        cardObj.qr_payload_url = `https://dr0p-station.vercel.app/inspect?card=${cardDisplayId}&hash=${encodeURIComponent(cardObj.qr_code_hash)}`;
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
    const DAILY_DROP_REWARD_BUMPS = 30; // 30 B$ garantidos — nunca trava o usuário

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
        // Também busca avatar e avatar_frame pra renderizar a moldura neon de cada operador no Placar.
        const { data: profilesData, error: profErr } = await sb.from('profiles').select('id, username, bumps, fusion_count, avatar, avatar_frame');
        if (profErr) { console.error('renderLeaderboard (profiles):', profErr.message); list.innerHTML = '<div class="empty-vault-notice">FALHA AO CARREGAR PLACAR.</div>'; return; }

        const { data: legendaryRows, error: cardsErr } = await sb.from('cards').select('id_usuario').eq('rarity_type', 'legendary');
        if (cardsErr) console.error('renderLeaderboard (cards):', cardsErr.message);
        const legendaryCounts = {};
        (legendaryRows || []).forEach(r => { legendaryCounts[r.id_usuario] = (legendaryCounts[r.id_usuario] || 0) + 1; });

        const rows = (profilesData || []).map(u => ({
            username: u.username,
            bumps: u.bumps || 0,
            legendaryCount: legendaryCounts[u.id] || 0,
            avatar: u.avatar || 'https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg',
            avatarFrame: u.avatar_frame || FRAME_DEFAULT_ID
        }));

        rows.sort((a, b) => leaderboardMode === 'bumps' ? (b.bumps - a.bumps) : (b.legendaryCount - a.legendaryCount));
        const top5 = rows.slice(0, 5);

        if (top5.length === 0) {
            list.innerHTML = '<div class="empty-vault-notice">NENHUM OPERADOR REGISTRADO NA REDE.</div>';
            return;
        }

        // Recompensas sazonais (simuladas, sem valor real) atreladas a cada posição do Placar Global.
        const SEASON_REWARDS = [
            '+500 B$ + Caixa Lendária',
            '+300 B$ + Caixa Épica',
            '+150 B$ + Caixa Épica',
            '+75 B$ + Caixa Comum',
            '+50 B$ + Caixa Comum'
        ];

        list.innerHTML = top5.map((r, i) => {
            const medal = ['🥇','🥈','🥉','🎖️','🎖️'][i] || '▫️';
            const value = leaderboardMode === 'bumps' ? `${r.bumps} B$` : `${r.legendaryCount} LENDÁRIOS`;
            const isMe = r.username === currentUser.username ? ' style="color:#00ffff;"' : '';
            // Mostra SOMENTE recompensas em Bumps na coluna de recompensas
            const bumpsReward = ['500 B$', '300 B$', '150 B$', '75 B$', '50 B$'][i] || '—';
            const avatarSrc = r.avatar || 'https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg';
            return `<div class="leaderboard-row" onclick="viewExternalProfile('${r.username.replace(/'/g,"\\'")}');"${isMe}>
                <span>${medal} #${i+1}</span>
                <span class="avatar-container ${r.avatarFrame}"><span class="cyber-frame"><img src="${avatarSrc}" draggable="false" loading="lazy" onerror="this.src='https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg'"></span></span>
                <span>${r.username}</span>
                <span>${value}</span>
                <span class="lb-rewards">💰 ${bumpsReward}</span>
            </div>`;
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
        playTerminalSound('overload');

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
                        <div>② Aprovar o contrato do dr0p_station</div>
                        <div>③ Pagar o <b style="color:#ffaa00;">gas fee</b> em ETH (custo variável da rede)</div>
                        <div>④ Aguardar a confirmação on-chain (~30s)</div>
                    </div>
                    <p style="margin:10px 0 0; color:#555566; font-size:0.48rem;">O controle e o custo são <b style="color:#fff;">inteiramente seus</b>. O dr0p_station nunca cobra taxas de mint — apenas o gás da rede Ethereum.</p>
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

    // =========================================================
    // [ESCOPO 6] FILTROS AVANÇADOS DO DROP HUB — Free Roll / Premium Drop
    // Permite o jogador restringir o pool de raridade, estilo visual e/ou
    // modo (free/premium) antes de girar. Em vez de re-rolar até bater
    // (caro e impreciso), os filtros restringem diretamente os arrays de
    // candidatos usados por executeHardwareRoll — ver _applyDropFilters().
    // =========================================================
    // =========================================================
    // [ESCOPO 6] BANCO DE DADOS DE FILTROS — 15+ VARIAÇÕES POR RARIDADE
    // Cada raridade tem um pool de variações estéticas (sub-raças) que são
    // embaralhadas aleatoriamente no momento da dropagem.
    // =========================================================
    const DROP_FILTER_DB = {
        common: [
            { name: 'CHROME DECAY',       filter: 'contrast(180%) saturate(30%) invert(10%)' },
            { name: 'BINARY DEEP',        filter: 'saturate(400%) contrast(150%)' },
            { name: 'RETRO GLITCH',       filter: 'invert(100%) hue-rotate(180deg)' },
            { name: 'STATIC NOISE',       filter: 'contrast(200%) brightness(80%) saturate(0%)' },
            { name: 'STEEL PULSE',        filter: 'sepia(60%) contrast(140%) brightness(110%)' },
            { name: 'GHOST SIGNAL',       filter: 'opacity(80%) saturate(20%) brightness(140%)' },
            { name: 'ACID WASH',          filter: 'hue-rotate(45deg) saturate(250%) contrast(120%)' },
            { name: 'DARK MATTER',        filter: 'brightness(60%) contrast(180%) saturate(50%)' },
            { name: 'FLUX STATIC',        filter: 'contrast(160%) saturate(60%) hue-rotate(200deg)' },
            { name: 'VOID REMNANT',       filter: 'invert(30%) sepia(40%) contrast(130%)' },
            { name: 'DATA SMEAR',         filter: 'blur(0.3px) contrast(170%) saturate(80%)' },
            { name: 'PHANTOM_WIRE',       filter: 'hue-rotate(270deg) contrast(150%) brightness(90%)' },
            { name: 'JUNK_PULSE',         filter: 'sepia(100%) brightness(120%) saturate(200%)' },
            { name: 'PALE_SIGNAL',        filter: 'saturate(10%) brightness(130%) contrast(120%)' },
            { name: 'CARBON_DRIFT',       filter: 'grayscale(80%) contrast(160%) brightness(95%)' }
        ],
        epic: [
            { name: 'GOTHIC APOCALYPSE',  filter: 'grayscale(100%) brightness(120%) contrast(200%)' },
            { name: 'VIRTUAL OVERDRIVE',  filter: 'sepia(80%) hue-rotate(320deg) saturate(300%)' },
            { name: 'NEON PULSE',         filter: 'hue-rotate(60deg) saturate(180%) invert(5%)' },
            { name: 'PLASMA BURN',        filter: 'hue-rotate(15deg) saturate(350%) contrast(160%)' },
            { name: 'ULTRAVIOLET',        filter: 'hue-rotate(240deg) saturate(400%) brightness(85%)' },
            { name: 'GLITCH_LAYER',       filter: 'saturate(500%) hue-rotate(120deg) contrast(180%)' },
            { name: 'TOXIC_GLITCH',       filter: 'hue-rotate(90deg) saturate(600%) contrast(200%) brightness(80%)' },
            { name: 'SOLAR_FLARE',        filter: 'hue-rotate(30deg) saturate(450%) brightness(110%) contrast(150%)' },
            { name: 'SHOCK_WAVE',         filter: 'contrast(220%) saturate(280%) hue-rotate(165deg)' },
            { name: 'PROTOCOL_9',         filter: 'invert(20%) saturate(350%) hue-rotate(75deg) contrast(190%)' },
            { name: 'CIRCUIT_BURN',       filter: 'sepia(60%) hue-rotate(280deg) saturate(400%) contrast(170%)' },
            { name: 'DARK_SURGE',         filter: 'brightness(70%) saturate(500%) hue-rotate(200deg)' },
            { name: 'EMERALD_STATIC',     filter: 'hue-rotate(100deg) saturate(300%) contrast(140%) brightness(95%)' },
            { name: 'CRIMSON_BYTE',       filter: 'hue-rotate(345deg) saturate(450%) contrast(175%)' },
            { name: 'HYPERION_DRIFT',     filter: 'saturate(600%) contrast(160%) hue-rotate(50deg) brightness(90%)' }
        ],
        legendary: [
            { name: 'ROSE PHANTOM',       filter: 'hue-rotate(60deg) saturate(180%) invert(5%)' },
            { name: 'CYBER_VOID',         filter: 'hue-rotate(185deg) saturate(500%) contrast(200%) brightness(75%)' },
            { name: 'OBSIDIAN_CORE',      filter: 'brightness(50%) contrast(250%) saturate(200%) hue-rotate(220deg)' },
            { name: 'AQUA_GENESIS',       filter: 'hue-rotate(175deg) saturate(400%) contrast(160%) brightness(90%)' },
            { name: 'SILVER_PROTOCOL',    filter: 'saturate(0%) brightness(140%) contrast(200%) invert(10%)' },
            { name: 'GOLDEN_BREACH',      filter: 'sepia(100%) hue-rotate(20deg) saturate(350%) contrast(160%)' },
            { name: 'ELECTRIC_DEITY',     filter: 'hue-rotate(195deg) saturate(600%) brightness(85%) contrast(190%)' },
            { name: 'TEMPEST_CORE',       filter: 'hue-rotate(210deg) saturate(450%) brightness(70%) contrast(220%)' },
            { name: 'STARFALL_DRIFT',     filter: 'brightness(80%) saturate(300%) hue-rotate(240deg) contrast(180%)' },
            { name: 'VOID_CIRCUIT',       filter: 'invert(15%) hue-rotate(190deg) saturate(550%) contrast(210%)' },
            { name: 'NEON_FROST',         filter: 'hue-rotate(168deg) saturate(500%) brightness(95%) contrast(170%)' },
            { name: 'AURORA_SIGNAL',      filter: 'hue-rotate(150deg) saturate(400%) brightness(85%) contrast(160%)' },
            { name: 'PHANTOM_CIRCUIT',    filter: 'invert(10%) hue-rotate(200deg) saturate(480%) contrast(195%)' },
            { name: 'DEEP_NETWORK',       filter: 'brightness(65%) saturate(550%) hue-rotate(205deg) contrast(230%)' },
            { name: 'CHROME_DEITY',       filter: 'saturate(20%) contrast(280%) brightness(85%) hue-rotate(190deg)' }
        ],
        ancestral: [
            { name: 'ROSA PHANTASMA',     filter: 'hue-rotate(300deg) saturate(400%) contrast(130%) brightness(90%)' },
            { name: 'ROSE_PHANTASMA_MkII',filter: 'hue-rotate(320deg) saturate(600%) contrast(180%) brightness(80%)' },
            { name: 'BLOOD_PROTOCOL',     filter: 'hue-rotate(350deg) saturate(700%) contrast(200%) brightness(70%)' },
            { name: 'VOID_MONARCH',       filter: 'invert(30%) hue-rotate(280deg) saturate(800%) contrast(220%) brightness(65%)' },
            { name: 'DARK_ANCESTRAL',     filter: 'brightness(45%) saturate(900%) hue-rotate(310deg) contrast(250%)' },
            { name: 'CRIMSON_GOD',        filter: 'hue-rotate(340deg) saturate(750%) brightness(75%) contrast(210%)' },
            { name: 'SILICON_DEITY',      filter: 'sepia(100%) hue-rotate(330deg) saturate(600%) contrast(190%)' },
            { name: 'OMEGA_FLUX',         filter: 'invert(20%) saturate(800%) hue-rotate(305deg) contrast(230%) brightness(70%)' },
            { name: 'PHANTOM_SOUL',       filter: 'hue-rotate(295deg) saturate(700%) brightness(60%) contrast(240%)' },
            { name: 'TOXIC_GLITCH_MkII',  filter: 'hue-rotate(285deg) saturate(900%) contrast(260%) brightness(55%)' },
            { name: 'VOID_GENESIS',       filter: 'brightness(50%) saturate(1000%) hue-rotate(315deg) contrast(270%)' },
            { name: 'INFERNO_CORE',       filter: 'hue-rotate(355deg) saturate(800%) contrast(220%) brightness(65%)' },
            { name: 'ABYSS_PROTOCOL',     filter: 'invert(25%) hue-rotate(300deg) saturate(750%) brightness(60%)' },
            { name: 'SPECTRAL_MONARCH',   filter: 'hue-rotate(275deg) saturate(850%) contrast(240%) brightness(70%)' },
            { name: 'NEURAL_PHANTOM',     filter: 'invert(15%) saturate(950%) hue-rotate(290deg) contrast(260%) brightness(62%)' }
        ]
    };

    // Helpers para selecionar variações aleatórias do banco de filtros
    function _getRandomDropVariant(rarityKey) {
        const pool = DROP_FILTER_DB[rarityKey] || DROP_FILTER_DB.common;
        const idx = Math.floor(Math.random() * pool.length);
        return pool[idx];
    }

    const DROP_VISUAL_STYLES = DROP_FILTER_DB.common.map(v => v.name)
        .concat(DROP_FILTER_DB.epic.map(v => v.name))
        .concat(DROP_FILTER_DB.legendary.map(v => v.name));


    let dropFilters = {
        rarity: 'all',   // all | common | epic | legendary | ancestral
        style: 'all',    // all | <nome do estilo>
        mode: 'all'      // all | free | premium
    };

    function toggleDropFiltersPanel() {
        const panel = document.getElementById('dropFiltersPanel');
        if (!panel) return;
        panel.style.display = panel.style.display === 'none' || !panel.style.display ? 'flex' : 'none';
    }

    function _updateDropFilterActiveCount() {
        const count = (dropFilters.rarity !== 'all' ? 1 : 0) + (dropFilters.style !== 'all' ? 1 : 0) + (dropFilters.mode !== 'all' ? 1 : 0);
        const badge = document.getElementById('dropFilterActiveCount');
        if (!badge) return;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
        badge.innerText = String(count);
    }

    function setDropRarityFilter(rarity) {
        dropFilters.rarity = rarity;
        document.querySelectorAll('#dropRarityFilterTags .drop-filter-tag').forEach(tag => {
            tag.classList.toggle('active', tag.dataset.rarity === rarity);
        });
        _updateDropFilterActiveCount();
        _applyDropModeVisibility();
    }

    function setDropStyleFilter(style) {
        dropFilters.style = style;
        document.querySelectorAll('#dropStyleFilterTags .drop-filter-tag').forEach(tag => {
            tag.classList.toggle('active', tag.dataset.style === style);
        });
        _updateDropFilterActiveCount();
    }

    function setDropPoolFilter(mode) {
        dropFilters.mode = mode;
        document.querySelectorAll('.drop-filter-tags .drop-filter-tag[data-mode]').forEach(tag => {
            tag.classList.toggle('active', tag.dataset.mode === mode);
        });
        _updateDropFilterActiveCount();
        _applyDropModeVisibility();
    }

    // Esconde visualmente o ticket Free/Premium que não combina com o
    // filtro de MODO selecionado — evita clique acidental no pool errado.
    function _applyDropModeVisibility() {
        const btnFree = document.getElementById('btnFree');
        const btnPremium = document.getElementById('btnPremium');
        if (btnFree) btnFree.style.display = (dropFilters.mode === 'premium') ? 'none' : 'flex';
        if (btnPremium) btnPremium.style.display = (dropFilters.mode === 'free') ? 'none' : 'flex';
    }

    function renderDropStyleFilters() {
        const container = document.getElementById('dropStyleFilterTags');
        if (!container) return;
        const tags = ['<button type="button" class="drop-filter-tag active" data-style="all" onclick="setDropStyleFilter(\'all\')">TODOS</button>']
            .concat(DROP_VISUAL_STYLES.map(s =>
                `<button type="button" class="drop-filter-tag" data-style="${s}" onclick="setDropStyleFilter('${s}')">${s}</button>`
            ));
        container.innerHTML = tags.join('');
    }

    // Aplica o filtro de RARIDADE ao roll: se o resultado natural não bate
    // com o filtro selecionado, força o resultado dentro do subconjunto
    // permitido em vez de simplesmente descartar o drop. Retorna a
    // raridade final a ser usada por executeHardwareRoll.
    function _resolveFilteredRarity(naturalRarityKey, rarityRoll) {
        if (dropFilters.rarity === 'all') return naturalRarityKey;
        return dropFilters.rarity; // filtro de raridade força o resultado nessa faixa
    }

    function _resolveFilteredStyleIndex(naturalIndex) {
        if (dropFilters.style === 'all') return naturalIndex;
        const idx = DROP_VISUAL_STYLES.indexOf(dropFilters.style);
        return idx === -1 ? naturalIndex : idx;
    }

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

            const visualStylesPT = DROP_VISUAL_STYLES;
            const visualStylesEN = DROP_VISUAL_STYLES;
            // visualFilters is now resolved per-rarity from DROP_FILTER_DB
            // styleIndex is kept for backward compat but overridden below
            let styleIndex = _resolveFilteredStyleIndex(Math.floor(Math.random() * 6));

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

            // [ESCOPO 6] Filtro de RARIDADE_ALVO ativo — força o resultado
            // pra dentro da raridade escolhida pelo jogador, em vez do roll
            // natural acima (que continua rodando, só não decide o resultado
            // final se houver filtro).
            rarityKey = _resolveFilteredRarity(rarityKey, rarityRoll);

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
                const variant = _getRandomDropVariant('ancestral');
                filterStyle = variant.filter;
                styleName   = variant.name;
                styleNameEN = variant.name;
                if(!isPremium) claimCost = 50;
            } else if (rarityKey !== "common") {
                const variant = _getRandomDropVariant(rarityKey);
                filterStyle = variant.filter;
                styleName = variant.name;
                styleNameEN = variant.name;
                if(!isPremium) claimCost = 50;
            } else {
                const variant = _getRandomDropVariant('common');
                filterStyle = variant.filter;
                styleName = variant.name;
                styleNameEN = variant.name;
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

            // BUGFIX (feed global com lixo/efêmero): este card ainda NÃO foi
            // resgatado (pode shatterar em 10s se não for reivindicado — ver
            // shatterAsset()). Publicar isso no feed PÚBLICO/real
            // (eventos_globais) faria a rede inteira ver mutações que nunca
            // chegaram a existir de fato, e exigiria desfazer via DELETE em
            // tempo real se a pessoa não resgatasse a tempo. Agora só entram
            // no feed global cards REAIS e definitivos: resgatados
            // (claimAssetLogic → pushFeedCard) ou fundidos com sucesso
            // (pushFeedCard no resultado da fusão). A pré-visualização local
            // do drop continua funcionando normalmente — só não é mais
            // transmitida pra rede antes de ser consolidada.

            downloadBtn.style.display = "block";
            downloadBtn.innerText = claimCost > 0 ? 
                (currentLang === 'PT' ? `RESGATAR (CUSTO: 50 B$)` : `CLAIM (COST: 50 B$)`) : 
                (currentLang === 'PT' ? "ENVIAR AO COFRE VIRTUAL" : "SEND TO SECURE VAULT");
            
            document.getElementById('status-text').innerText = currentLang === 'PT' ? "MUTAÇÃO_ESTÁVEL" : "MUTATION_STABLE";
            
            playSynthSound('success'); 
            speakPhrase("Mutação bem sucedida! Resgate o ativo.", "Mutation successful! Claim the asset.");

            // [ESCOPO 6] BUGFIX: o cronômetro de shatter (startStabilityDecay)
            // estava correndo SEMPRE, inclusive em rolls Premium — então um
            // PREMIUM_DROP_PASS, que deveria ser "100% SECURE // GARANTIA DE
            // COMPILAÇÃO" / entrega garantida e imediata, ainda corria risco
            // de ser destruído se o jogador demorasse mais de 10s pra clicar
            // em resgatar. Agora Premium pula o cronômetro por completo:
            // mostra o badge de resgate garantido e nunca chama shatterAsset().
            const premiumBadge = document.getElementById('premiumInstantBadge');
            if (isPremium) {
                stabilityWrapper.style.display = "none";
                if (premiumBadge) premiumBadge.style.display = "block";
            } else {
                if (premiumBadge) premiumBadge.style.display = "none";
                startStabilityDecay();
            }
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
        // Não precisa mais limpar `globalFeed` aqui — o drop nunca chegou a
        // ser publicado nele (ver nota no fim de claimAssetLogic's preview,
        // acima), já que só cards efetivamente resgatados/fundidos entram
        // no feed público agora.

        downloadBtn.style.display = "none";
        targetContainer.className = "target-box shattering";
        const premiumBadgeEl = document.getElementById('premiumInstantBadge');
        if (premiumBadgeEl) premiumBadgeEl.style.display = "none";
        
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

        // BUGFIX (perfis fantasmas): enquanto o Supabase ainda não respondeu
        // a primeira leitura de `eventos_globais`, mostramos um aviso de
        // terminal em vez de qualquer card inventado/estático.
        if (globalFeedLoading) {
            container.innerHTML = '<div class="feed-loading-notice">[ CARREGANDO DADOS CENTRAIS DO NÓ // SINCRONIZANDO COM A REDE... ]</div>';
            return;
        }

        if (globalFeed.length === 0) {
            container.innerHTML = '<div class="feed-loading-notice">[ REDE SEM DROPS AINDA // NENHUM EVENTO REGISTRADO ]</div>';
            return;
        }
        
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

        // Reaplica o drag-to-scroll sempre que o feed é repintado (re-render
        // troca o innerHTML, mas o container #storiesContainer em si nunca é
        // recriado — o guard `dataset.dragInit` em initStoriesDragScroll
        // evita re-ligar os listeners do zero a cada chamada).
        initStoriesDragScroll();
    }

    // =========================================================
    // DRAG-TO-SCROLL no feed MUTAÇÕES_REDE (clique-e-arrasta)
    // =========================================================
    // Permite ao usuário pausar o marquee automático e "puxar" os cards
    // manualmente pra frente/trás (mouse + touch), igual a um carrossel
    // nativo. Resolve junto o bug do onClick abrindo o card ERRADO: como
    // o marquee desloca a posição dos cards continuamente, sem essa
    // distinção um simples toque-e-arraste (comum em touch, ao tentar
    // rolar o feed) acabava soltando o dedo sobre um card DIFERENTE
    // daquele que estava embaixo do dedo no início do gesto — e o
    // navegador disparava `click` nesse card errado, abrindo o modal
    // de inspeção do item errado. A correção mede a distância arrastada
    // e, se ultrapassar um pequeno limiar, intercepta e cancela o
    // `click` (fase de captura, antes de chegar no listener do
    // story-node) — só permite o `click` passar quando foi de fato um
    // toque/clique parado, garantindo que o card aberto é sempre
    // exatamente o que o usuário pretendia.
    function initStoriesDragScroll() {
        const container = document.getElementById('storiesContainer');
        if (!container || container.dataset.dragInit) return;
        container.dataset.dragInit = '1';

        const DRAG_THRESHOLD_PX = 4;
        let isDown = false;
        let dragged = false;
        let startX = 0;
        let startOffset = 0;
        let resumeTimer = null;

        function getCurrentTranslateX(el) {
            const t = window.getComputedStyle(el).transform;
            if (!t || t === 'none') return 0;
            const m = t.match(/matrix.*\((.+)\)/);
            if (!m) return 0;
            const parts = m[1].split(',').map(parseFloat);
            return parts.length === 16 ? parts[12] : parts[4]; // matrix3d vs matrix
        }

        function pointerDown(clientX) {
            clearTimeout(resumeTimer);
            isDown = true;
            dragged = false;
            startX = clientX;
            startOffset = getCurrentTranslateX(container);
            // Pausa o marquee automático (mesma classe usada pelo hover —
            // ver pauseMarquee) e "congela" os cards na posição atual antes
            // de assumir o controle manual via transform inline.
            container.classList.remove('animated');
            container.style.transition = 'none';
            container.style.transform = `translate3d(${startOffset}px, 0, 0)`;
            container.style.cursor = 'grabbing';
        }

        function pointerMove(clientX) {
            if (!isDown) return;
            const delta = clientX - startX;
            if (Math.abs(delta) > DRAG_THRESHOLD_PX) dragged = true;
            container.style.transform = `translate3d(${startOffset + delta}px, 0, 0)`;
        }

        function pointerUp() {
            if (!isDown) return;
            isDown = false;
            container.style.cursor = '';
            // Não houve arraste de verdade (foi um clique parado): libera o
            // `click` normalmente — o listener do container abaixo só
            // intercepta quando `dragged` for true.
            // Retoma o marquee automático sozinho após uma pausa de
            // inatividade, pra ele não ficar travado pra sempre em telas
            // touch (que não disparam mouseleave/resumeMarquee).
            resumeTimer = setTimeout(() => { resumeMarquee(); }, 2500);
        }

        container.addEventListener('mousedown', (e) => { pointerDown(e.clientX); e.preventDefault(); });
        window.addEventListener('mousemove', (e) => pointerMove(e.clientX));
        window.addEventListener('mouseup', pointerUp);

        container.addEventListener('touchstart', (e) => pointerDown(e.touches[0].clientX), { passive: true });
        container.addEventListener('touchmove', (e) => pointerMove(e.touches[0].clientX), { passive: true });
        container.addEventListener('touchend', pointerUp);

        // Fase de CAPTURA: roda antes do listener de click de cada
        // story-node, então consegue suprimir o clique-fantasma pós-drag
        // sem precisar tocar/alterar o listener individual de cada card.
        container.addEventListener('click', (e) => {
            if (dragged) {
                e.stopPropagation();
                e.preventDefault();
                dragged = false;
            }
        }, true);
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
            // [ESCOPO 4] Cards purgados ganham a classe is-purged (chamas +
            // selo PURGED/DETONADA via CSS) e --purge-label conforme idioma.
            card.className = `album-card rare-${a.rarityType}${a.isPurged ? ' is-purged' : ''}`;
            if (a.isPurged) card.style.setProperty('--purge-label', currentLang === 'PT' ? '"DETONADA"' : '"PURGED"');
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
                    ${a.isPurged ? `<div style="font-size:0.5rem;color:#ff0033;text-align:center;padding:6px 0;">// ATIVO DETONADO — SOMENTE INSPEÇÃO //</div>` : `
                    <button class="btn-action btn-expose" data-action="expose" data-idx="${index}">${a.exposed ? '⭐ SAIR DA VITRINE' : '📁 EXPOR NA VITRINE'}</button>
                    ${a.forSale
                        ? `<button class="btn-action btn-sell" data-action="unlist" data-idx="${index}" style="border-color:#ff0044;color:#ff0044;">✕ REMOVER VENDA</button>`
                        : `<button class="btn-action btn-sell" data-action="sell" data-idx="${index}" style="border-color:${a.exposed?'#555':'#ffaa00'};color:${a.exposed?'#555':'#ffaa00'};${a.exposed?'cursor:not-allowed;opacity:0.5;':''}" ${a.exposed?'disabled title="Retire da vitrine antes de vender"':''}>💵 VENDER ATIVO</button>`
                    }
                    <button class="btn-action btn-gift" data-action="gift" data-idx="${index}" style="border-color:${(a.exposed||a.forSale)?'#555':'#ff00ff'};color:${(a.exposed||a.forSale)?'#555':'#ff00ff'};${(a.exposed||a.forSale)?'cursor:not-allowed;opacity:0.5;':''}" ${(a.exposed||a.forSale)?'disabled title="Card indisponível para presente (exposto ou listado)"':''}>🎁 PRESENTEAR</button>
                    `}
                    <button class="btn-action btn-dl"     data-action="download" data-idx="${index}">Obter Item 📥</button>
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
                else if (action === 'sell')   marketListPrompt(idx);
                else if (action === 'unlist') unlistVaultCard(idx);
                else if (action === 'gift')   giftAssetPrompt(idx);
                else if (action === 'download') downloadVaultAsset(idx);
            });
            g.appendChild(card);
        });

        renderPagination('vaultPagination', filtered.length, vaultPage, (p) => { vaultPage = p; renderVaultGrid(); });
    }

    // toggleExposeAsset agora vem da Parte 2 (Supabase), no final do arquivo.

    async function marketListPrompt(index) {
        if (savedAssets[index].isPurged) {
            showCyberAlert('CARD_DETONADO', 'Cards detonados (purged) não podem ser listados.', 'error');
            return;
        }
        if (savedAssets[index].isListed) {
            playSynthSound('shatter');
            showCyberAlert('🔒 ATIVO BLOQUEADO EM CUSTÓDIA NO MERCADO', 'Este card já está em custódia no mercado. Remove o anúncio primeiro.', 'error');
            return;
        }
        const asset = savedAssets[index];
        const suggested = asset.price > 0 ? asset.price : (asset.rarityType === 'ancestral' ? 5000 : asset.rarityType === 'legendary' ? 1500 : asset.rarityType === 'epic' ? 500 : 100);

        // Remove painel anterior se existir
        const oldPanel = document.getElementById('inlinePricePanel');
        if (oldPanel) oldPanel.remove();

        const card = document.querySelector(`[data-vault-index="${index}"]`);
        if (!card) return;

        const panel = document.createElement('div');
        panel.id = 'inlinePricePanel';
        panel.className = 'inline-price-panel';
        panel.innerHTML = `
            <div class="ipp-title">set_price ${asset.id} [${asset.rarityType.toUpperCase()}]</div>
            <div class="ipp-prompt-row">
                <span class="ipp-prefix">&gt;</span>
                <input id="ippInput" class="ipp-input" type="number" min="1" max="999999" value="${suggested}" placeholder="valor...">
                <span class="ipp-unit">B$</span>
            </div>
            <div class="ipp-actions">
                <button class="ipp-confirm-btn" onclick="confirmMarketList(${index})">LISTAR</button>
                <button class="ipp-cancel-btn" onclick="document.getElementById('inlinePricePanel').remove()">CANCELAR</button>
            </div>
        `;

        card.appendChild(panel);
        setTimeout(() => panel.classList.add('ipp-visible'), 10);
        document.getElementById('ippInput').focus();
    }

    async function confirmMarketList(index) {
        const input = document.getElementById('ippInput');
        if (!input) return;
        const parsed = parseInt(input.value);
        if (isNaN(parsed) || parsed <= 0) { showCyberAlert('ERRO DE INPUT', 'Valor de venda inválido. Insere um número positivo.', 'error'); return; }

        const panel = document.getElementById('inlinePricePanel');
        if (panel) panel.remove();

        const ok = await listCardOnMarket(savedAssets[index], parsed);
        if (!ok) {
            showCyberAlert('ERRO_DE_REDE', 'Falha ao listar o card no mercado. Tenta novamente.', 'error');
            return;
        }

        pushLedger(`${currentUser.username} listou o card ${savedAssets[index].id} [${savedAssets[index].rarityNameEN}] por ${parsed} B$`);
        renderVaultGrid();
    }

    // [ESCOPO 5] Remove venda diretamente do cofre (sem prompt, 1 clique)
    async function unlistVaultCard(index) {
        const asset = savedAssets[index];
        if (!asset) return;
        const ok = await unlistCardFromMarket(asset);
        if (!ok) { showCyberAlert('ERRO_DE_REDE', 'Falha ao remover o anúncio. Tenta novamente.', 'error'); return; }
        asset.forSale = false; asset.isListed = false; asset.price = 0;
        playSynthSound('success');
        showCyberAlert('✓ ANÚNCIO REMOVIDO', `Card <b>${asset.id}</b> retirado do mercado e devolvido ao cofre.`, 'success');
        renderVaultGrid();
    }


    async function giftAssetPrompt(index) {
        const giftedCard = savedAssets[index];
        if (!giftedCard) return;

        // [ESCOPO 2] Cards expostos na Vitrine ou já listados para troca
        // são intocáveis — nem presente, nem venda, até serem retirados.
        if (giftedCard.exposed) {
            showCyberAlert('CARD_BLOQUEADO', 'Este card está exposto na Vitrine do Perfil. Remova-o da vitrine antes de presentear.', 'warn');
            return;
        }
        if (giftedCard.forSale || giftedCard.isListed) {
            showCyberAlert('CARD_BLOQUEADO', 'Este card está listado no mercado. Remova o anúncio antes de presentear.', 'warn');
            return;
        }
        if (giftedCard.isPurged) {
            showCyberAlert('CARD_DETONADO', 'Cards detonados (purged) não podem ser transferidos.', 'error');
            return;
        }

        const rawInput = prompt("Digite o @username exato do destinatário da rede (Ex: @cyber_k1ng):");
        if (!rawInput) return;

        // Validação rígida: @ obrigatório, 3-20 chars após o @, só
        // letras/números/underscore (mesmo padrão de validateUsername).
        const targetUser = rawInput.trim();
        const STRICT_USERNAME_RE = /^@[a-zA-Z0-9_]{3,20}$/;
        if (!STRICT_USERNAME_RE.test(targetUser)) {
            showCyberAlert('FORMATO INVÁLIDO', 'Use @ seguido de 3 a 20 letras, números ou _ (ex: @cyber_k1ng).', 'error');
            return;
        }
        if (targetUser.toLowerCase() === currentUser.username.toLowerCase()) {
            showCyberAlert('OPERAÇÃO INVÁLIDA', 'Não é possível presentear a si mesmo.', 'error');
            return;
        }

        const targetProfile = await fetchProfileByUsername(targetUser);
        if (!targetProfile) {
            showCyberAlert('ERRO_REDE', 'Esse nó de usuário não existe ou está desconectado.', 'error'); return;
        }
        if (!giftedCard._dbId) {
            showCyberAlert('ERRO', 'Card sem registro remoto válido. Recarregue o cofre e tente novamente.', 'error'); return;
        }

        // ── RPC ATÔMICA enviar_presente: valida posse + bloqueios, troca o
        // dono (id_usuario) e grava o registro em `presentes` numa única
        // transação no servidor. Substitui o fluxo antigo (insert de cópia
        // + delete do original), que não era atômico e podia duplicar o
        // card caso o delete falhasse depois do insert ter sido bem-sucedido.
        const { data: presenteId, error } = await sb.rpc('enviar_presente', {
            p_remetente_id: currentUser.id,
            p_remetente_username: currentUser.username,
            p_destinatario_id: targetProfile.id,
            p_destinatario_username: targetProfile.username,
            p_card_id: giftedCard._dbId,
            p_card_display_id: giftedCard.id,
            p_mensagem: null
        });

        if (error) {
            console.error('enviar_presente:', error.message);
            showCyberAlert('ERRO_DE_REDE', 'Falha ao transferir o card. Tenta novamente.', 'error');
            return;
        }

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

    // =========================================================
    // [ESCOPO 1] CAIXA DE PRESENTE FLUTUANTE — receiver-side
    // Consulta a tabela `presentes` por linhas pendentes destinadas ao
    // usuário logado. Se houver alguma, mostra o FAB com badge luminoso
    // e ativa o efeito de glitch de tela. Chamado no login e refrescado
    // por Realtime (ver initGiftRealtime).
    // =========================================================
    let pendingGiftsCache = [];

    async function refreshPendingGifts() {
        if (!currentUser.loggedIn || !currentUser.id) {
            _setGiftFabState([]);
            return;
        }
        const { data, error } = await sb.from('presentes')
            .select('id, remetente_id, remetente_username, card_id, card_display_id, card_snapshot, mensagem, created_at')
            .eq('destinatario_id', currentUser.id)
            .eq('status', 'pendente')
            .order('created_at', { ascending: false });
        if (error) { console.error('refreshPendingGifts:', error.message); return; }
        pendingGiftsCache = data || [];
        _setGiftFabState(pendingGiftsCache);
    }

    function _setGiftFabState(gifts) {
        const fab = document.getElementById('giftFab');
        const badge = document.getElementById('giftFabBadge');
        const glitch = document.getElementById('giftScreenGlitch');
        if (!fab || !badge || !glitch) return;
        if (gifts.length > 0) {
            fab.classList.add('has-gifts');
            glitch.classList.add('active');
            badge.innerText = gifts.length > 99 ? '99+' : String(gifts.length);
        } else {
            fab.classList.remove('has-gifts');
            glitch.classList.remove('active');
            badge.innerText = '0';
        }
    }

    function openReceivedGiftsModal() {
        const modal = document.getElementById('receivedGiftsModal');
        const grid = document.getElementById('receivedGiftsGrid');
        if (!modal || !grid) return;
        if (pendingGiftsCache.length === 0) {
            grid.innerHTML = '<div class="empty-vault-notice">Nenhum presente pendente.</div>';
        } else {
            grid.innerHTML = pendingGiftsCache.map(g => {
                const snap = g.card_snapshot || {};
                const rarityColor = snap.rarity_type === 'legendary' ? '#00ffff' : snap.rarity_type === 'epic' ? '#ffaa00' : '#aaa';
                return `
                <div class="received-gift-item" style="display:flex; align-items:center; gap:10px; padding:10px; border:1px solid #2a1530; border-radius:6px; margin-bottom:8px; background:#0c0810;">
                    ${snap.img_src ? `<img src="${snap.img_src}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid ${rarityColor};">` : ''}
                    <div style="flex:1;">
                        <div style="font-size:0.62rem; color:${rarityColor};">${snap.display_id || g.card_display_id}</div>
                        <div style="font-size:0.54rem; color:#888899;">de <b style="color:#ff00ff;">${g.remetente_username}</b></div>
                    </div>
                    <button class="btn-action" style="border-color:#00ff66; font-size:0.5rem; padding:6px 10px;" onclick="claimReceivedGift('${g.id}')">ABRIR</button>
                </div>`;
            }).join('');
        }
        modal.classList.add('active');
    }

    function closeReceivedGiftsModal() {
        const modal = document.getElementById('receivedGiftsModal');
        if (modal) modal.classList.remove('active');
    }

    async function claimReceivedGift(presenteId) {
        const { error } = await sb.rpc('resgatar_presente', {
            p_destinatario_id: currentUser.id,
            p_presente_id: presenteId
        });
        if (error) {
            console.error('resgatar_presente:', error.message);
            showCyberAlert('ERRO', 'Falha ao resgatar o presente. Tente novamente.', 'error');
            return;
        }
        playSynthSound('success');
        speakPhrase("Presente Recebido. Novo Lootbox detectado.", "New Lootbox Detected. Gift received.");
        showCyberAlert('✓ LOOTBOX ABERTA', 'Card adicionado ao seu cofre.', 'success');

        // Recarrega cofre e a lista de presentes pendentes
        savedAssets = await loadCardsFromSupabase(currentUser.id);
        await refreshPendingGifts();
        if (pendingGiftsCache.length === 0) closeReceivedGiftsModal();
        else openReceivedGiftsModal();
        renderVaultGrid();
    }

    // Realtime: assim que uma linha pendente é inserida em `presentes`
    // para este usuário, atualiza o FAB sem precisar de refresh manual.
    function initGiftRealtime() {
        if (!currentUser.loggedIn || !currentUser.id) return;
        sb.channel('presentes-' + currentUser.id)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'presentes',
                filter: `destinatario_id=eq.${currentUser.id}`
            }, () => { refreshPendingGifts(); })
            .subscribe();
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
                tradeBtn.innerText = "FAZER PROPOSTA";
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

    async function openInspectModal(cardAsset) {
        if(!cardAsset) return;
        const ownerName = cardAsset.creator || cardAsset.owner;

        document.getElementById('inspectImg').src = cardAsset.imgSrc;
        document.getElementById('inspectTitle').innerText = `INSPECT // ${cardAsset.id}`;

        // [ESCOPO 4] CARIMBO DE EXCLUSÃO — exibe chamas pixel art + selo
        // PURGED/DETONADA quando o card foi sacrificado/consumido em
        // fusão, fornalha ou descarte. Os dois textos (EN+PT) aparecem
        // juntos sempre — não depende do idioma ativo.
        const purgedStamp = document.getElementById('purgedStamp');
        const purgedFireLayer = document.getElementById('purgedFireLayer');
        if (purgedStamp && purgedFireLayer) {
            if (cardAsset.isPurged) {
                purgedStamp.style.display = 'flex';
                purgedFireLayer.classList.add('active');
            } else {
                purgedStamp.style.display = 'none';
                purgedFireLayer.classList.remove('active');
            }
        }

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

        // BUGFIX (veracidade do nível): antes este número vinha de uma fórmula
        // paralela (globalFeed.filter(creator).length * 5), que ficava estática/errada
        // e não batia com o nível mostrado na Vitrine do perfil. Agora busca a coleção
        // REAL do dono do card e usa a MESMA fórmula (scoreFromAssets) da Vitrine.
        let ownerScore;
        if (ownerName === currentUser.username) {
            ownerScore = scoreFromAssets(savedAssets);
        } else {
            const ownerProfile = await fetchProfileByUsername(ownerName);
            const ownerAssets = ownerProfile ? await loadCardsFromSupabase(ownerProfile.id) : [];
            ownerScore = scoreFromAssets(ownerAssets);
        }

        const metaBox = document.getElementById('inspectMetaBox');
        metaBox.innerHTML = `
            <div class="inspect-crt-lines" style="
                font-size:0.5rem; color:${rarityColor}88; margin-bottom:12px;
                border:1px solid ${rarityColor}33; padding:6px 10px;
                background: rgba(0,0,0,0.6);
                font-family:'Space Mono',monospace; letter-spacing:1px;
                line-height:1.8;
            ">${crtLines.map(l => `<div>${l}</div>`).join('')}</div>
            <div class="inspect-meta-grid">
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">CÓDIGO ID</span>
                    <span class="inspect-meta-value">${cardAsset.id}</span>
                </div>
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">ESTILO VISUAL</span>
                    <span class="inspect-meta-value">${currentLang === 'PT' ? cardAsset.styleName : (cardAsset.styleNameEN || cardAsset.styleName)}</span>
                </div>
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">RARIDADE</span>
                    <span class="inspect-meta-value" style="color:${rarityColor}">${(currentLang === 'PT' ? cardAsset.rarityName : cardAsset.rarityNameEN).toUpperCase()}</span>
                </div>
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">NÍVEL DO PROPRIETÁRIO</span>
                    <span class="inspect-meta-value">LVL ${ownerScore || 1}</span>
                </div>
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">DONO DA ASSINATURA</span>
                    <span class="inspect-meta-value inspect-author" style="color:#00ff66; text-decoration:underline; cursor:pointer;">${ownerName}</span>
                </div>
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">ESTADO NA REDE</span>
                    <span class="inspect-meta-value">${cardAsset.registered ? 'CRIPTOGRAFADO EM WALLET' : 'FLUXO VOLÁTIL'}</span>
                </div>
            </div>
        `;

        metaBox.querySelector('.inspect-author').addEventListener('click', () => viewExternalProfile(ownerName));

        const zone = document.getElementById('inspectActionZone'); zone.innerHTML = '';
        if (cardAsset.registered && ownerName !== currentUser.username && !cardAsset.isPurged) {
            const btn = document.createElement('button'); btn.className = 'btn-action'; btn.style.borderColor = '#ff00ff';
            btn.innerText = `📝 FAZER PROPOSTA PARA ${ownerName}`;
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
                        : (ownerName === currentUser.username
                            ? `<button class="btn-action inspect-web3-btn" style="margin-top:8px; border-color:#9933ff; color:#9933ff; font-size:0.5rem; padding:5px 12px; width:auto;"
                                onclick="showTokenizeModal(${JSON.stringify(cardAsset.id).replace(/"/g,'&quot;')})">
                                ⬡ TOKENIZAR CARD (Web3)
                               </button>`
                            : '')
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
    // [ESCOPO 5] LEDGER DE OFERTAS DE TROCA — tabela propostas_p2p
    // BUGFIX CRÍTICO: a versão antiga guardava as propostas em
    // localStorage (chave 'cyber_global_offers'), que é por NAVEGADOR,
    // não por conta. Isso é a causa raiz do "histórico de propostas
    // desaparecia": se o outro jogador estivesse num dispositivo
    // diferente (o caso normal, já que são contas reais no Supabase),
    // a oferta simplesmente nunca existia do lado dele — não é que o
    // dado "sumia", é que nunca esteve lá. Substituído pela tabela real
    // public.propostas_p2p (RLS: cada parte só vê as próprias propostas),
    // que persiste no servidor e é visível para AMBOS os jogadores
    // envolvidos, em qualquer dispositivo.
    // =========================================================

    // Cache local da contagem de pendentes para o badge — atualizado por
    // refreshIncomingProposals() (polling leve) e Realtime.
    let _incomingProposalsCache = [];

    async function createOffer({ owner, receiver, assetId, targetAssetDbId, bumpsOffered, offeredAssetDbId, offeredAssetDisplayId }) {
        if (!owner || !receiver || !currentUser.id) return null;

        const targetProfile = await fetchProfileByUsername(receiver.startsWith('@') ? receiver : '@' + receiver.replace(/^@/, ''));
        if (!targetProfile) {
            console.error('createOffer: destinatário não encontrado', receiver);
            return null;
        }

        // O card alvo da proposta é o card do DESTINATÁRIO que o remetente
        // quer adquirir — vem de thread.targetAsset (ver submitCounterProposal).
        const targetAssetDisplayId = assetId;

        if (!targetAssetDbId) {
            console.error('createOffer: card alvo sem _dbId, não é possível registrar a proposta.');
            return null;
        }

        const { data, error } = await sb.from('propostas_p2p').insert({
            remetente_id: currentUser.id,
            remetente_username: currentUser.username,
            destinatario_id: targetProfile.id,
            destinatario_username: targetProfile.username,
            card_id: targetAssetDbId,
            card_display_id: targetAssetDisplayId,
            bumps_ofertados: bumpsOffered || 0,
            card_ofertado_id: offeredAssetDbId || null,
            card_ofertado_display_id: offeredAssetDisplayId || null
        }).select().single();

        if (error) { console.error('createOffer:', error.message); return null; }
        return { id: data.id, ...data };
    }

    async function updateOfferStatus(offerId, status) {
        if (status === 'rejected') {
            const { error } = await sb.from('propostas_p2p')
                .update({ status: 'recusada', recusada_em: new Date().toISOString() })
                .eq('id', offerId)
                .eq('destinatario_id', currentUser.id)
                .eq('status', 'pendente');
            if (error) console.error('updateOfferStatus (recusar):', error.message);
        }
        // 'accepted' é tratado por acceptCurrentProposal via RPC aceitar_proposta_p2p
        // (precisa ser atômico com a transferência real de cards/bumps).
        await refreshIncomingProposals();
        renderGlobalOffers('offersContainer');
    }

    // Carrega propostas onde o usuário logado é remetente OU destinatário,
    // para renderizar o painel offersContainer (substitui loadGlobalOffers).
    async function loadGlobalOffers() {
        if (!currentUser.loggedIn || !currentUser.id) return [];
        const { data, error } = await sb.from('propostas_p2p')
            .select('id, remetente_username, destinatario_username, card_display_id, bumps_ofertados, card_ofertado_display_id, status, created_at')
            .or(`remetente_id.eq.${currentUser.id},destinatario_id.eq.${currentUser.id}`)
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) { console.error('loadGlobalOffers:', error.message); return []; }
        // Mapeia para o shape que renderGlobalOffers já espera (owner/receiver/assetId/bumpsOffered)
        return (data || []).map(p => ({
            id: p.id,
            owner: p.remetente_username,
            receiver: p.destinatario_username,
            assetId: p.card_display_id,
            bumpsOffered: p.bumps_ofertados,
            status: p.status === 'pendente' ? 'pending' : p.status === 'concluida' ? 'accepted' : p.status === 'recusada' ? 'rejected' : p.status,
            createdAt: new Date(p.created_at).getTime()
        }));
    }

    // [ESCOPO 5] Badge de notificação — pendentes onde o usuário é destinatário
    async function refreshIncomingProposals() {
        if (!currentUser.loggedIn || !currentUser.id) { _setProposalBadgeState([]); return; }
        const { data, error } = await sb.from('propostas_p2p')
            .select('id, remetente_username, card_display_id, bumps_ofertados, created_at')
            .eq('destinatario_id', currentUser.id)
            .eq('status', 'pendente')
            .order('created_at', { ascending: false });
        if (error) { console.error('refreshIncomingProposals:', error.message); return; }
        _incomingProposalsCache = data || [];
        _setProposalBadgeState(_incomingProposalsCache);
    }

    function _setProposalBadgeState(pending) {
        const dot = document.getElementById('newOfferAlertDot');
        if (!dot) return;
        dot.classList.toggle('active', pending.length > 0);
        dot.style.display = pending.length > 0 ? 'block' : 'none';
    }

    // Realtime: nova linha em propostas_p2p destinada a este usuário acende
    // o ponto de alerta imediatamente, sem precisar abrir a tela de Propostas.
    function initProposalsRealtime() {
        if (!currentUser.loggedIn || !currentUser.id) return;
        sb.channel('propostas-' + currentUser.id)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'propostas_p2p',
                filter: `destinatario_id=eq.${currentUser.id}`
            }, () => { refreshIncomingProposals(); })
            .subscribe();
    }

    async function renderGlobalOffers(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<div style="font-size:0.6rem;color:#444;padding:8px 0;">Carregando propostas...</div>';
        if (!currentUser.loggedIn) { container.innerHTML = ''; return; }

        const offers = await loadGlobalOffers();
        container.innerHTML = '';
        const me = currentUser.username;

        if (offers.length === 0) {
            container.innerHTML = '<div style="font-size:0.6rem;color:#444;padding:8px 0;">Nenhuma proposta registrada ainda.</div>';
            return;
        }

        offers.forEach(offer => {
            const isReceiver = offer.receiver === me;
            const isOwner = offer.owner === me;
            if (!isReceiver && !isOwner) return;

            const card = document.createElement('div');
            card.className = 'offer-card';

            if (isReceiver && offer.status === 'pending') {
                card.innerHTML = `
                    <span>Proposta de <b>${offer.owner}</b> — ${offer.bumpsOffered} B$ pelo ativo ${offer.assetId}</span>
                    <span>
                        <button class="btn-action accept-offer">Aceitar</button>
                        <button class="btn-action decline-offer">Recusar</button>
                    </span>
                `;
                card.querySelector('.accept-offer').addEventListener('click', () => acceptOfferFromList(offer));
                card.querySelector('.decline-offer').addEventListener('click', () => updateOfferStatus(offer.id, 'rejected'));
            } else {
                const statusLabel = offer.status === 'pending' ? 'Pendente' : (offer.status === 'accepted' ? 'Aceita' : 'Recusada');
                const directionLabel = isOwner ? `Proposta enviada a <b>${offer.receiver}</b>` : `Proposta de <b>${offer.owner}</b>`;
                card.innerHTML = `<span>${directionLabel} — ${offer.bumpsOffered} B$ pelo ativo ${offer.assetId} — <b>${statusLabel}</b></span>`;
            }

            container.appendChild(card);
        });

        if (container.innerHTML === '') {
            container.innerHTML = '<div style="font-size:0.6rem;color:#444;padding:8px 0;">Nenhuma proposta registrada ainda.</div>';
        }
    }

    // Aceitar diretamente da lista de Propostas (fora de uma thread de chat
    // aberta) — usa a mesma RPC atômica aceitar_proposta_p2p.
    async function acceptOfferFromList(offer) {
        const { error } = await sb.rpc('aceitar_proposta_p2p', {
            p_destinatario_id: currentUser.id,
            p_proposta_id: offer.id
        });
        if (error) {
            console.error('aceitar_proposta_p2p:', error.message);
            showCyberAlert('ERRO', 'Não foi possível concluir a proposta. Ela pode já ter expirado ou os itens não estarem mais disponíveis.', 'error');
            return;
        }
        playSynthSound('success');
        showCyberAlert('✓ PROPOSTA ACEITA', 'Itens e Bumps transferidos com sucesso.', 'success');
        pushLedger(`${offer.owner} e ${offer.receiver} concluíram uma troca P2P: ${offer.bumpsOffered} B$ pelo ativo ${offer.assetId}`);

        // Recarrega estado local afetado
        savedAssets = await loadCardsFromSupabase(currentUser.id);
        const freshProfile = await fetchProfile(currentUser.id);
        if (freshProfile) currentUser.bumps = freshProfile.bumps;
        renderVaultGrid();
        await refreshIncomingProposals();
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
    async function submitCounterProposal() {
        if(!activeThreadUser || !messageThreads[activeThreadUser]) return;
        let thread = messageThreads[activeThreadUser];

        if(thread.activeProposal && thread.activeProposal.status === "ACCEPTED") {
            showCyberAlert('LOG_ERRO:', 'Este canal de negociação já foi finalizado com sucesso.', 'error'); return;
        }

        const bumpsOffered = parseInt(document.getElementById('counterBumpsInput').value) || 0;
        const selectedAssetId = document.getElementById('counterAssetSelect').value;

        if(bumpsOffered < 0) { showCyberAlert('LOG_ERRO:', 'Valor inválido de Bumps.', 'error'); return; }
        if(bumpsOffered > currentUser.bumps) { showCyberAlert('ACESSO_NEGADO:', 'Você não possui saldo de Bumps suficiente em conta para cobrir esta proposta.', 'error'); return; }

        if (!thread.targetAsset || !thread.targetAsset._dbId) {
            showCyberAlert('LOG_ERRO:', 'Ativo alvo sem registro válido no servidor. Reabra a negociação a partir do mercado.', 'error'); return;
        }

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

        // PROPOSTA GLOBAL — agora persistida em propostas_p2p (Supabase),
        // visível para ambas as partes em qualquer dispositivo.
        const offerRecord = await createOffer({
            owner: currentUser.username,
            receiver: activeThreadUser,
            assetId: thread.targetAsset.id,
            targetAssetDbId: thread.targetAsset._dbId,
            bumpsOffered,
            offeredAssetDbId: assetObject ? assetObject._dbId : null,
            offeredAssetDisplayId: assetObject ? assetObject.id : null
        });
        thread.activeProposal.globalOfferId = offerRecord ? offerRecord.id : null;

        if (!offerRecord) {
            showCyberAlert('ERRO_DE_REDE', 'Falha ao registrar a proposta no servidor. Tente novamente.', 'error');
            return;
        }

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

    async function acceptCurrentProposal() {
        if(!activeThreadUser || !messageThreads[activeThreadUser]) return;
        let thread = messageThreads[activeThreadUser];
        let prop = thread.activeProposal;

        if(!thread.targetAsset) return;
        if(!prop || !prop.globalOfferId) {
            showCyberAlert('LOG_ERRO:', 'Esta proposta não tem um registro de servidor válido para ser concluída.', 'error');
            return;
        }

        let sellerName = thread.targetAsset.creator;

        // Só quem é dono do card alvo (destinatário da proposta) pode aceitar —
        // a RPC aceitar_proposta_p2p valida isso novamente no servidor.
        if (currentUser.username !== sellerName) {
            showCyberAlert('ACESSO_NEGADO:', 'Apenas o dono do ativo alvo pode aceitar esta proposta.', 'error');
            return;
        }

        // ── RPC ATÔMICA: transfere card alvo + card ofertado (se houver) +
        // Bumps ofertados (se houver), tudo numa única transação no servidor,
        // e grava a transição em historico_propostas_p2p. Substitui a
        // simulação antiga que lia/escrevia em localStorage chaves
        // "user_<nome>" — o que nunca refletia a conta real do outro
        // jogador (ela está no Supabase, não no localStorage deste navegador).
        const { error } = await sb.rpc('aceitar_proposta_p2p', {
            p_destinatario_id: currentUser.id,
            p_proposta_id: prop.globalOfferId
        });

        if (error) {
            console.error('aceitar_proposta_p2p:', error.message);
            showCyberAlert('ERRO_DE_REDE:', 'Não foi possível concluir a troca. O item pode já não estar mais disponível.', 'error');
            return;
        }

        // Recarrega o cofre e o saldo reais a partir do Supabase — fonte de
        // verdade única, em vez de mutar savedAssets/bumps na mão.
        savedAssets = await loadCardsFromSupabase(currentUser.id);
        const freshProfile = await fetchProfile(currentUser.id);
        if (freshProfile) currentUser.bumps = freshProfile.bumps;
        renderVaultGrid();

        prop.status = "ACCEPTED";
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
    // DOWNLOAD DO ASSET (Ponto 6) — SOMENTE IMAGEM ESTÁTICA HD
    // O botão "Obter Item 📥" baixa EXCLUSIVAMENTE a imagem
    // estática (.png/.jpg) em alta definição, mesmo que o card
    // possua variações animadas. Download em lote removido.
    // =========================================================
    async function downloadVaultAsset(index) {
        const asset = savedAssets[index];
        if (!asset) return;
        if (asset.creator !== currentUser.username) {
            showCyberAlert('ACESSO NEGADO', 'Apenas o dono original pode descarregar este ativo.', 'error');
            return;
        }

        const baseName = `dr0p_${(asset.id || '').replace('#','')}_${asset.rarityType}`;

        // Somente download estático PNG/JPG
        const aStatic = document.createElement('a');
        aStatic.href = asset.imgSrc;
        if (asset.imgSrc && asset.imgSrc.startsWith('data:')) {
            aStatic.download = `${baseName}_hd.png`;
            aStatic.click();
        } else if (asset.imgSrc) {
            // Tenta fetch para forçar download em vez de abrir no browser
            try {
                const resp = await fetch(asset.imgSrc);
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const a2 = document.createElement('a');
                a2.href = url;
                a2.download = `${baseName}_hd.png`;
                a2.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            } catch(e) {
                window.open(asset.imgSrc, '_blank');
            }
        }
    }

    // Gera um WebP animado simples (2 frames com glow pulsante) a partir
    // do dataURL estático. Usa canvas + captureStream de forma síncrona
    // via sequência de frames desenhados — sem dependências externas.
    async function _generateAnimatedWebP(srcDataUrl, rarityType) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const SIZE = 400;
                const c = document.createElement('canvas');
                c.width = SIZE; c.height = SIZE;
                const ctx = c.getContext('2d');
                const glowColor = rarityType === 'ancestral' ? 'rgba(255,0,127,' :
                                  rarityType === 'legendary' ? 'rgba(0,255,255,' :
                                  rarityType === 'epic'      ? 'rgba(255,170,0,' : 'rgba(180,180,180,';

                // Tenta usar MediaRecorder para capturar canvas animado
                if (!c.captureStream || !window.MediaRecorder) { resolve(null); return; }
                const stream = c.captureStream(8); // 8fps
                const chunks = [];
                let mr;
                try { mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' }); }
                catch(e) { resolve(null); return; }

                mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
                mr.onstop = () => {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    resolve(URL.createObjectURL(blob));
                };

                mr.start();
                let frame = 0;
                const TOTAL_FRAMES = 16;
                const interval = setInterval(() => {
                    const alpha = 0.2 + 0.35 * Math.abs(Math.sin(frame * Math.PI / TOTAL_FRAMES));
                    ctx.clearRect(0, 0, SIZE, SIZE);
                    ctx.drawImage(img, 0, 0, SIZE, SIZE);
                    ctx.save();
                    ctx.shadowBlur = 30; ctx.shadowColor = glowColor + '0.8)';
                    ctx.strokeStyle = glowColor + alpha + ')';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(4, 4, SIZE - 8, SIZE - 8);
                    ctx.restore();
                    frame++;
                    if (frame >= TOTAL_FRAMES) { clearInterval(interval); mr.stop(); }
                }, 125);
            };
            img.onerror = () => resolve(null);
            img.src = srcDataUrl;
        });
    }

    // =========================================================
    // ALQUIMIA — FUSÃO DE 2 CARDS COM PROBABILIDADE (VAULT ONLY)
    // =========================================================

    // Estado de seleção da galeria de alquimia
    let _alchSelected = { alpha: null, beta: null }; // { id, asset }
    // Estado de seleção da Fornalha (até 3 cards)
    let _furnSelected = []; // array de cards
    // Estado de navegação interna da Central de Alquimia: 'menu' | 'fusao' | 'fornalha'
    let _alchMode = 'menu';

    function toggleAlchemyPanel() {
        const panel = document.getElementById('alchemyPanel'); if (!panel) return;
        if (panel.style.display === 'none' || !panel.style.display) {
            if (!currentUser.loggedIn) { showCyberAlert('ACESSO NEGADO', currentLang === 'PT' ? 'Precisas de estar logado para aceder ao laboratório de Alquimia.' : 'Login required to access the Alchemy Lab.', 'error'); return; }
            panel.style.display = 'block';
            setAlchemyMode('menu');
        } else {
            panel.style.display = 'none';
        }
    }

    /**
     * Gerencia a navegação entre as telas da Central de Alquimia:
     * 'menu' (escolha de protocolo), 'fusao' (modo padrão) e 'fornalha' (alto risco).
     */
    function setAlchemyMode(mode) {
        _alchMode = mode;
        const menuView = document.getElementById('alchMenuView');
        const fusaoView = document.getElementById('alchFusaoView');
        const fornalhaView = document.getElementById('alchFornalhaView');
        if (menuView) menuView.style.display = mode === 'menu' ? 'block' : 'none';
        if (fusaoView) fusaoView.style.display = mode === 'fusao' ? 'block' : 'none';
        if (fornalhaView) fornalhaView.style.display = mode === 'fornalha' ? 'block' : 'none';

        if (mode === 'fusao') {
            _alchSelected = { alpha: null, beta: null };
            openAlchemyPanel();
        } else if (mode === 'fornalha') {
            _furnSelected = [];
            openFurnacePanel();
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
    // FORNALHA DE SOBRECARGA — MODO DE ALTO RISCO (até 3 cards)
    // 80% DESTRUIÇÃO TOTAL (delete no Supabase) / 20% MUTAÇÃO MÁXIMA
    // (queima os originais e gera 1 card novo de alta raridade)
    // =========================================================

    function openFurnacePanel() {
        _renderFurnGallery();
        _updateFurnPreview();
    }

    /** Renderiza a galeria de miniaturas no painel da Fornalha (seleção múltipla, máx 3) */
    function _renderFurnGallery() {
        const grid = document.getElementById('furnGalleryGrid');
        if (!grid) return;
        grid.innerHTML = '';

        const eligible = savedAssets.filter(a => !a.isListed);
        if (eligible.length === 0) {
            grid.innerHTML = '<div style="color:#ff550044; font-size:0.55rem; padding:8px; grid-column:1/-1;">Nenhum ativo disponível para a Fornalha.</div>';
            return;
        }

        eligible.forEach(card => {
            const thumb = document.createElement('div');
            thumb.className = 'furn-thumb';
            thumb.dataset.id = card.id;
            if (card.isLocked) thumb.classList.add('locked-in-contract');
            if (_furnSelected.some(c => c.id === card.id)) thumb.classList.add('selected');

            const rarColor = _rarityColor(card.rarityType);
            thumb.innerHTML = `
                <img src="${card.imgSrc}" alt="${card.id}">
                <div class="alch-thumb-rarity" style="color:${rarColor};">${(card.rarityNameEN || 'CMN').slice(0,3)}</div>
            `;

            thumb.addEventListener('click', () => _furnThumbClick(card));
            grid.appendChild(thumb);
        });
    }

    /**
     * Lógica de seleção na Fornalha: clique alterna o card dentro/fora de
     * _furnSelected, com limite de 3 cards simultâneos.
     */
    function _furnThumbClick(card) {
        const idx = _furnSelected.findIndex(c => c.id === card.id);
        if (idx >= 0) {
            _furnSelected.splice(idx, 1);
        } else {
            if (_furnSelected.length >= 3) {
                showCyberAlert('LIMITE DO REATOR', currentLang === 'PT' ? 'Máximo de 3 ativos por sobrecarga.' : 'Maximum of 3 assets per overload.', 'warn');
                return;
            }
            _furnSelected.push(card);
        }
        _renderFurnGallery();
        _updateFurnPreview();
    }

    /** Atualiza os 3 slots de preview e o estado do botão de sobrecarga */
    function _updateFurnPreview() {
        for (let i = 0; i < 3; i++) {
            const slot = document.getElementById(`furnPreviewSlot${i + 1}`);
            if (!slot) continue;
            const card = _furnSelected[i];
            if (card) {
                const rc = _rarityColor(card.rarityType);
                slot.innerHTML = `<img src="${card.imgSrc}" style="border:2px solid ${rc};">`;
            } else {
                slot.innerHTML = '<div class="furn-empty-slot">☢<span>VAZIO</span></div>';
            }
        }
        const btn = document.getElementById('furnOverloadBtn');
        if (btn) btn.disabled = _furnSelected.length === 0;
    }

    /**
     * Executa a Sobrecarga: anima o reator, sorteia o resultado (80/20) e
     * reflete a queima ou a mutação máxima diretamente no Supabase.
     */
    async function startOverload() {
        if (!currentUser.loggedIn) { showCyberAlert('ACESSO NEGADO', currentLang === 'PT' ? 'Precisas de estar logado para aceder à Fornalha.' : 'Login required to access the Furnace.', 'error'); return; }
        if (_furnSelected.length === 0) return;
        if (_furnSelected.some(c => c.isListed)) { showCyberAlert('🔒 CUSTÓDIA ATIVA', currentLang === 'PT' ? 'Ativos em custódia no mercado não podem ser sobrecarregados.' : 'Assets listed on market cannot be overloaded.', 'error'); return; }

        const overloadBtn = document.getElementById('furnOverloadBtn');
        overloadBtn.disabled = true;

        // Snapshot dos cards selecionados ANTES de qualquer alteração
        const snaps = _furnSelected.map(c => ({...c}));
        const idsConsumidos = snaps.map(c => c.id);

        const furnacePanel = document.getElementById('alchFornalhaView');
        furnacePanel.classList.add('furnace-charging');
        playSynthSound('click');
        speakPhrase("Iniciando sobrecarga do reator. Núcleo instável.", "Initiating reactor overload. Core unstable.");

        setTimeout(() => {
            furnacePanel.classList.remove('furnace-charging');

            // ── Overlay de glitch/reator por 1500ms ───────────────────────
            const glitchOverlay = document.createElement('div');
            glitchOverlay.id = 'furnaceGlitchOverlay';
            Object.assign(glitchOverlay.style, {
                position: 'fixed', inset: '0', zIndex: '9999',
                background: 'rgba(10, 3, 0, 0.94)', display: 'flex',
                flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '18px', pointerEvents: 'all',
            });

            const flashLayer = document.createElement('div');
            flashLayer.className = 'furnace-flash-layer';
            glitchOverlay.appendChild(flashLayer);

            document.body.classList.add('furnace-screen-shake');

            playTerminalSound('alchemy');
            playFusionShockSound();
            const glitchSoundTimer = setInterval(() => playSynthSound('click'), 280);
            const flashTimers = [250, 550, 850, 1100, 1350].map(delay =>
                setTimeout(() => {
                    flashLayer.classList.add('flash-pulse');
                    setTimeout(() => flashLayer.classList.remove('flash-pulse'), 90);
                    playSynthSound('click');
                }, delay)
            );

            const glitchLabel = document.createElement('div');
            glitchLabel.className = 'loading-glitch loading-glitch-cursor furnace-glitch-label';
            glitchLabel.setAttribute('data-text', '[ REACTOR CORE INSTABLE ]');
            glitchLabel.textContent = '[ REACTOR CORE INSTABLE ]';
            Object.assign(glitchLabel.style, { fontSize: '1.3rem', letterSpacing: '4px' });

            const glitchSub = document.createElement('div');
            glitchSub.style.cssText = 'font-family:"Space Mono",monospace; font-size:0.6rem; color:#ff550099; letter-spacing:2px;';
            const subMessages = [
                'CONTENÇÃO DE NÚCLEO FALHANDO...',
                'TEMPERATURA CRÍTICA ATINGIDA...',
                'CALCULANDO PROBABILIDADE DE DERRETIMENTO...',
                'SOBRECARGA EM ANDAMENTO...',
            ];
            glitchSub.textContent = subMessages[Math.floor(Math.random() * subMessages.length)];

            const glitchBar = document.createElement('span');
            glitchBar.className = 'loading-glitch-bar furnace-glitch-bar';
            Object.assign(glitchBar.style, { width: '260px', display: 'block' });

            const scanline = document.createElement('div');
            scanline.className = 'loading-glitch-scanline furnace-glitch-scanline';

            glitchOverlay.appendChild(scanline);
            glitchOverlay.appendChild(glitchLabel);
            glitchOverlay.appendChild(glitchSub);
            glitchOverlay.appendChild(glitchBar);
            document.body.appendChild(glitchOverlay);

            setTimeout(async () => {
                clearInterval(glitchSoundTimer);
                document.body.classList.remove('furnace-screen-shake');
                glitchOverlay.remove();

                // Remove os cards da memória local ANTES de decidir o resultado
                savedAssets = savedAssets.filter(a => !idsConsumidos.includes(a.id));

                const roll = Math.random();
                let alertTitle, alertMsg, alertType;

                if (roll < 0.80) {
                    // ── FALHA (80%): marca todos os cards selecionados como purged
                    // (continuam existindo como registro histórico/inspecionável,
                    // em vez de serem apagados sem deixar rastro) ──
                    for (const snap of snaps) {
                        if (snap._dbId) await purgeCardInSupabase(snap._dbId, 'fornalha_falha');
                        markCardPurgedLocally(snap, 'fornalha_falha');
                    }
                    // Concede Fragmentos de Sucata como compensação
                    const furnFragments = snaps.length * FRAGMENTS_PER_FURNACE_FAIL;
                    currentUser.fragments = (currentUser.fragments || 0) + furnFragments;
                    await updateProfileInSupabase(currentUser.id, { fragments: currentUser.fragments });

                    alertTitle = '[ERRO] FALHA DE CONTENÇÃO';
                    alertMsg = currentLang === 'PT'
                        ? `[ERRO] COMPONENTES DERRETIDOS NA FORNALHA. ATIVOS DESTRUÍDOS.<br><small style="color:#ff550099">${idsConsumidos.join(', ')}</small><br><span style="color:#aaa;">+${furnFragments} Fragmentos de Sucata concedidos como compensação. (Total: ${currentUser.fragments})</span>`
                        : `[ERROR] COMPONENTS MELTED IN THE FURNACE. ASSETS DESTROYED.<br><small style="color:#ff550099">${idsConsumidos.join(', ')}</small><br><span style="color:#aaa;">+${furnFragments} Scrap Fragments granted as compensation. (Total: ${currentUser.fragments})</span>`;
                    alertType = 'error';
                    triggerAncestralFlash('#ff5500');
                    playSynthSound('shatter');
                    speakPhrase("Fornalha falhou. Ativos derretidos. Fragmentos de sucata concedidos.", "Furnace failed. Assets melted. Scrap fragments granted.");
                    pushLedger(`${currentUser.username} sobrecarregou a Fornalha com ${idsConsumidos.join('+')} — DERRETIMENTO TOTAL (+${furnFragments} FRAG)`);

                } else {
                    // ── SUCESSO (20%): marca originais como purged (consumidos pela
                    // mutação) + gera 1 card novo de alta raridade ──
                    for (const snap of snaps) {
                        if (snap._dbId) await purgeCardInSupabase(snap._dbId, 'fornalha_mutacao');
                        markCardPurgedLocally(snap, 'fornalha_mutacao');
                    }

                    const rarityRoll = Math.random();
                    const newRarity = rarityRoll < 0.55 ? 'ancestral' : 'legendary';
                    const rN   = newRarity === 'ancestral' ? 'ANCESTRAL' : 'LENDÁRIO';
                    const rNEN = newRarity === 'ancestral' ? 'ANCESTRAL' : 'LEGENDARY';
                    const wc   = newRarity === 'ancestral' ? '#ff007f' : '#00ffff';

                    const baseSnap = snaps[Math.floor(Math.random() * snaps.length)];
                    const fusedVisual = await renderFusedCardVisual(baseSnap.imgSrc, 'gold');
                    if (newRarity === 'ancestral') triggerAncestralFlash('#ff007f');

                    const newId = "#" + Math.floor(100000 + Math.random() * 900000);
                    const inheritedFusionCount = Math.max(...snaps.map(s => s.fusion_count || 0)) + 1;

                    const newCard = {
                        id: newId, rarityType: newRarity, rarityName: rN, rarityNameEN: rNEN,
                        styleName: 'OVERLOAD MUTATION', styleNameEN: 'OVERLOAD MUTATION',
                        creator: currentUser.username, registered: true, exposed: false,
                        forSale: false, isListed: false, price: 0,
                        imgSrc: fusedVisual, isFused: true, tags: ['fused', 'fornalha', 'evento'],
                        fusion_count: inheritedFusionCount,
                        genetic_history: snaps.flatMap(s => s.genetic_history || []).concat([{
                            fusionId: `FRN-${inheritedFusionCount.toString().padStart(4, '0')}`,
                            ts: Date.now(),
                            sacrificedCardId: idsConsumidos.join('+'),
                            survivalRollResult: roll,
                            mutation: { huePalette: 'gold', source: 'fornalha' }
                        }]),
                        eliteEligible: inheritedFusionCount >= 3
                    };
                    attachProvenance(newCard);
                    newCard.provenance.parentIds = idsConsumidos;
                    savedAssets.push(newCard);

                    const inserted = await insertCardToSupabase(newCard, currentUser.id);
                    if (!inserted) console.error('startOverload: falha ao gravar card mutado no Supabase.');

                    alertTitle = '[SOBRECARGA BEM SUCEDIDA]';
                    alertMsg = currentLang === 'PT'
                        ? `[SOBRECARGA BEM SUCEDIDA] NOVO ATIVO GERADO NA REDE.<br><b>${newId}</b> — <span style="color:${wc}">${rNEN}</span>`
                        : `[OVERLOAD SUCCESSFUL] NEW ASSET GENERATED ON THE NETWORK.<br><b>${newId}</b> — <span style="color:${wc}">${rNEN}</span>`;
                    alertType = 'success';
                    playTerminalSound('alchemy');
                    registerFusionForBadges();
                    pushFeedCard({...newCard});
                    pushLedger(`${currentUser.username} sobrecarregou a Fornalha com ${idsConsumidos.join('+')} → ${newCard.id} [${newCard.rarityNameEN}]`);
                }

                _furnSelected = [];
                _renderFurnGallery();
                _updateFurnPreview();
                renderVaultGrid();
                showCyberAlert(alertTitle, alertMsg, alertType);

            }, 1500);
        }, 1200);
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
            // destruição total: nenhum dos dois sobrevive — marcados como
            // purged em vez de apagados, preservando o registro histórico
            if (cardPrincipal._dbId) await purgeCardInSupabase(cardPrincipal._dbId, 'fusao_destruicao_total');
            if (cardSacrificado._dbId) await purgeCardInSupabase(cardSacrificado._dbId, 'fusao_destruicao_total');
            markCardPurgedLocally(cardPrincipal, 'fusao_destruicao_total');
            markCardPurgedLocally(cardSacrificado, 'fusao_destruicao_total');
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
        // ── marca o card sacrificado como purged (foi consumido pela fusão) ──
        if (cardSacrificado._dbId) await purgeCardInSupabase(cardSacrificado._dbId, 'fusao_sacrificio');
        markCardPurgedLocally(cardSacrificado, 'fusao_sacrificio');
    
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
    
                // ── SUPABASE: marca como purged os cards realmente consumidos ──
                // Se o seguro salvou c1, só c2 é purgado; senão, os dois são.
                // Marcados como purged em vez de apagados: continuam existindo
                // como registro histórico/inspecionável (selo PURGED/DETONADA).
                if (insuranceWillSave) {
                    if (snap2._dbId) await purgeCardInSupabase(snap2._dbId, 'fusao_sacrificio');
                    markCardPurgedLocally(snap2, 'fusao_sacrificio');
                } else {
                    if (snap1._dbId) await purgeCardInSupabase(snap1._dbId, 'fusao_destruicao_total');
                    if (snap2._dbId) await purgeCardInSupabase(snap2._dbId, 'fusao_destruicao_total');
                    markCardPurgedLocally(snap1, 'fusao_destruicao_total');
                    markCardPurgedLocally(snap2, 'fusao_destruicao_total');
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
                // Fusões bem-sucedidas (comum ou épico/lendário) entram no feed
                // global REAL e público (eventos_globais), pra aparecerem na Home
                // de TODO mundo (não só desta aba) e sobreviverem ao F5 — ver
                // pushFeedCard()/initGlobalRealtime(). A re-renderização do
                // marquee acontece via Realtime, não na mão aqui.
                if (result === 'success' || result === 'common') {
                    pushFeedCard({...fusedCard});
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

        // Busca o profile completo do ALVO sendo exibido (uma única vez, reaproveitado
        // abaixo pra vitrine/follow/cosméticos) sempre que não for o próprio dono.
        // Isso é o que garante que moldura/fundo neon/adereço/estante mostrados na tela
        // são SEMPRE os do dono daquele perfil — nunca os do currentUser logado, que
        // só entra em jogo quando isOwner === true. Sem isso, visitar o perfil de outra
        // pessoa "vazaria" os cosméticos equipados por quem está logado.
        const targetProfile = isOwner ? null : await fetchProfileByUsername(username);
        const displayFrame = isOwner
            ? (currentUser.avatarFrame || FRAME_DEFAULT_ID)
            : ((targetProfile && targetProfile.avatar_frame) || FRAME_DEFAULT_ID);
        const displayEquipped = isOwner
            ? (currentUser.equippedCosmetics || { background: null, prop: null, shelf: null, emoticon: null })
            : ((targetProfile && targetProfile.equipped_cosmetics && typeof targetProfile.equipped_cosmetics === 'object')
                ? { background: null, prop: null, shelf: null, emoticon: null, ...targetProfile.equipped_cosmetics }
                : { background: null, prop: null, shelf: null, emoticon: null });

        // Avatar do usuário logado/visitado (BUGFIX: avatar sumido da tela de perfil)
        const avatarImg = document.getElementById('profAvatarImg');
        if (avatarImg) avatarImg.src = avatar || 'https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg';
        const avatarFrameWrap = document.getElementById('avatarFrameWrap');
        if (avatarFrameWrap) {
            avatarFrameWrap.classList.remove('frame-style-1', 'frame-style-2', 'frame-style-3', 'frame-style-4', 'frame-subnet-static-pulse');
            avatarFrameWrap.classList.add(displayFrame);
        }
        // Aplica os 3 efeitos visuais reais (glow de fundo, adereço de card,
        // estante) usando ESTRITAMENTE os cosméticos do perfil exibido.
        applyAllEquippedEffects(displayEquipped);

        // Banner
        const bannerEl = document.getElementById('profBannerView');
        if (bannerEl) {
            bannerEl.style.backgroundImage = banner ? `url(${banner})` : '';
        }

        // Saldo (somente para o próprio usuário)
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = isOwner ? `${currentUser.bumps} B$` : '--- B$';

        // [ESCOPO 3] Troca botão: CARREGAR (próprio) / TRANSFERIR BUMPS (terceiro)
        const depositOrTransferBtn = document.getElementById('profDepositOrTransferBtn');
        if (depositOrTransferBtn) {
            if (isOwner) {
                depositOrTransferBtn.innerText = '+ CARREGAR';
                depositOrTransferBtn.onclick = () => openDepositModal();
                depositOrTransferBtn.style.borderColor = '';
                depositOrTransferBtn.style.color = '';
            } else {
                depositOrTransferBtn.innerText = '↗ TRANSFERIR BUMPS';
                depositOrTransferBtn.onclick = () => {
                    if (!currentUser.loggedIn) { showCyberAlert('ACESSO NEGADO', 'Faça login para transferir Bumps.', 'error'); return; }
                    openTransferBumpsModal(username);
                };
                depositOrTransferBtn.style.borderColor = '#00ffff';
                depositOrTransferBtn.style.color = '#00ffff';
            }
        }

        // Zona de edição só aparece para o próprio perfil
        const editZone = document.getElementById('profileEditZone');
        if (editZone) editZone.style.display = isOwner ? 'block' : 'none';

        // ── PONTO 2: trava de usuário logado no botão [ INVENTÁRIO DE RELÍQUIAS ] ──
        // Só renderiza/exibe o botão quando o profile.id do perfil visualizado é
        // igual ao user.id da sessão logada. Visitantes nunca veem este botão,
        // mesmo manipulando o DOM manualmente (openRelicInventoryModal também
        // re-checa isso por segurança).
        const relicBtn = document.getElementById('relicInventoryBtn');
        if (relicBtn) relicBtn.style.display = isOwner ? 'block' : 'none';

        // Inventário de equipamentos (Molduras/Acessórios da Loja do Spike) —
        // também exclusivo do dono do perfil.
        renderEquipmentInventory(isOwner);
        if (isOwner) renderRelicInventoryModal();

        const inputBio = document.getElementById('inputBio');
        if (inputBio) inputBio.value = isOwner ? (bio || '') : '';
        // Sempre volta o editor de bio pro estado fechado (botão visível, textarea oculta)
        // ao trocar de perfil, evitando que a área de edição "vaze" do usuário A pro B.
        cancelBioEdit();

        // Vitrine: assets expostos do usuário-alvo
        // (também usado pra obter o id real do usuário-alvo, necessário pro follow)
        let sourceAssets = savedAssets;
        let targetUserId = isOwner ? currentUser.id : null;
        if (!isOwner) {
            targetUserId = targetProfile ? targetProfile.id : null;
            sourceAssets = targetProfile ? await loadCardsFromSupabase(targetProfile.id) : [];
        }
        const exposedAssets = sourceAssets.filter(a => a.exposed);
        // Ordenação: da carta mais rara/poderosa para a menos rara
        const RARITY_POWER = { ancestral: 4, legendary: 3, epic: 2, common: 1 };
        exposedAssets.sort((a, b) => (RARITY_POWER[b.rarityType] || 0) - (RARITY_POWER[a.rarityType] || 0));
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
            // Reaplica a estante (o innerHTML='' acima não mexe nas classes do
            // próprio grid, mas reforça o estado certo logo após popular os cards).
            applyEquippedShelfEffect(displayEquipped);
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

    // ── NÍVEL DE COLEÇÃO ──────────────────────────────────────────
    // BUGFIX (veracidade do nível): esta é a ÚNICA fonte de verdade
    // para o cálculo do nível de coleção. openInspectModal() agora
    // chama esta mesma função (em vez de uma fórmula paralela baseada
    // em globalFeed) para que o nível mostrado no Inspect bata 1:1
    // com o nível mostrado na Vitrine do perfil.
    // [ESCOPO 7] Títulos de nível da conta — 4 tiers conforme solicitado.
    // Curva de XP suavizada: thresholds mais espaçados e pesos por card
    // reduzidos em relação à versão anterior, pra a progressão entre
    // níveis ficar mais gradual (evita o salto abrupto de tier que a
    // pontuação antiga causava com poucos cards lendários/épicos).
    const COLLECTION_TIERS = [
        { min: 0,   label: 'NETRUNNER FANTASMA',           icon: '👻', cls: 'rank-basic'   },
        { min: 18,  label: 'ESPECULADOR DA SUB-REDE',      icon: '📡', cls: 'rank-hype'    },
        { min: 42,  label: 'SIFÃO DE DADOS',                icon: '🌀', cls: 'rank-elite'   },
        { min: 80,  label: 'MODIFICADOR DE SILÍCIO',        icon: '⚡', cls: 'rank-godlike' }
    ];

    function scoreFromAssets(items) {
        let score = 0;
        (items || []).forEach(i => {
            // Pesos reduzidos (antes: legendary 12 / epic 6 / common 2) —
            // suaviza a curva pra cada card individual pesar menos no
            // score total, exigindo uma coleção mais ampla pra subir de
            // nível em vez de um único drop sortudo destravar o tier todo.
            if (i.rarityType === 'ancestral') score += 10;
            else if (i.rarityType === 'legendary') score += 7;
            else if (i.rarityType === 'epic') score += 3;
            else score += 1;
        });
        return score;
    }

    function computeCollectionLevel(items, areaElement) {
        if(!areaElement) return;
        const score = scoreFromAssets(items);

        let tierIndex = 0;
        for (let i = 0; i < COLLECTION_TIERS.length; i++) {
            if (score >= COLLECTION_TIERS[i].min) tierIndex = i;
        }
        const tier = COLLECTION_TIERS[tierIndex];
        const nextTier = COLLECTION_TIERS[tierIndex + 1] || null;
        const isMaxed = !nextTier;
        const pointsToNext = isMaxed ? 0 : (nextTier.min - score);
        const pct = isMaxed ? 100 : Math.max(4, Math.min(100, Math.round(((score - tier.min) / (nextTier.min - tier.min)) * 100)));

        // 10 "pontos" de progresso em estilo terminal (cada bolinha = 10% do trajeto até o próximo nível)
        const totalDots = 10;
        const filledDots = Math.round((pct / 100) * totalDots);
        const dotsHtml = Array.from({ length: totalDots }, (_, idx) =>
            `<span class="${idx < filledDots ? 'dot-filled' : ''}">${idx < filledDots ? '●' : '○'}</span>`
        ).join(' ');

        const nextLabel = isMaxed
            ? '<span class="next-lvl-tag">NÍVEL MÁXIMO ATINGIDO</span>'
            : `<span class="next-lvl-tag">FALTAM <b style="color:#00ffff;">${pointsToNext} PTS</b> P/ PRÓXIMO NÍVEL</span>`;

        areaElement.innerHTML = `
            <div class="showcase-rank-badge ${tier.cls}">${tier.icon} STATUS: ${tier.label} (LVL ${score || 1})</div>
            <div class="collection-progress-wrap">
                <div class="collection-progress-terminal">
                    <span>&gt; SCORE_ATUAL: <b style="color:#00ff66;">${score}</b> PTS</span>
                    ${nextLabel}
                </div>
                <div class="collection-progress-bar-track">
                    <div class="collection-progress-bar-fill${isMaxed ? ' maxed' : ''}" style="width:${pct}%;"></div>
                </div>
                <div class="collection-progress-dots">${dotsHtml}</div>
            </div>
        `;
    }

    let currentFrameFilter = 'todos';

    function openAvatarSelector() {
        if(selectedProfileUser !== currentUser.username) return;
        document.getElementById('avatarSelectorModal').style.display = 'flex';
        renderFrameSelectorRow(currentFrameFilter);
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

    // ── PONTO 3: SELETOR DE MOLDURAS AMPLIADO COM FILTROS DE RARIDADE ──
    const FRAME_RARITY_LABELS = { todos: 'TODOS', raro: 'RARO', lendario: 'LENDÁRIO', ancestral: 'ANCESTRAL' };
    const FRAME_RARITY_ICONS  = { raro: '⬡', lendario: '◈', ancestral: '☠' };

    function setFrameFilter(filter) {
        currentFrameFilter = filter;
        renderFrameSelectorRow(filter);
    }

    // Lista completa das molduras selecionáveis: a padrão (grátis, sempre
    // possuída) + as vendidas na Loja (NEON_PULSE / GLITCH_CORE /
    // APOCALYPSE_OVERRIDE / STATIC_PULSE).
    function allSelectableFrames() {
        return [
            { id: FRAME_DEFAULT_ID, category: 'moldura', name: 'Neon Hexlock', accent: '#00ffff', rarity: FRAME_DEFAULT_RARITY, free: true },
            ...LOJA_FRAME_ITEMS,
            ...LOJA_SUBNET_FRAME_ITEMS
        ];
    }

    function frameSelectorButtonMarkup(frame) {
        const owned = frame.free || (Array.isArray(currentUser.cosmetics) && currentUser.cosmetics.includes(frame.id));
        const isActive = (currentUser.avatarFrame || FRAME_DEFAULT_ID) === frame.id;
        const opacity = isActive ? '1' : (owned ? '0.45' : '0.35');

        if (!owned) {
            // Trava de segurança: usuário não tem o item no array cosmetics.
            return `
                <button class="btn-action frame-locked-btn" style="border-color:#333; flex:1; opacity:${opacity}; cursor:not-allowed; color:#555;" disabled data-frame="${frame.id}" data-rarity="${frame.rarity}">
                    🔒 BLOQUEADO - VISITE O SPIKE
                </button>`;
        }

        return `
            <button class="btn-action" style="border-color:${frame.accent}; flex:1; opacity:${opacity};" data-frame="${frame.id}" data-rarity="${frame.rarity}" onclick="lojaEquipFrame('${frame.id}')">
                ${FRAME_RARITY_ICONS[frame.rarity] || '⬡'} ${frame.name.toUpperCase()}
            </button>`;
    }

    function renderFrameSelectorRow(filter) {
        const filterZone = document.getElementById('frameFilterZone');
        if (filterZone) {
            filterZone.innerHTML = Object.keys(FRAME_RARITY_LABELS).map(key => `
                <button class="filter-btn${filter === key ? ' active' : ''}" onclick="setFrameFilter('${key}')">[ ${FRAME_RARITY_LABELS[key]} ]</button>
            `).join('');
        }

        const row = document.getElementById('frameSelectorRow');
        if (!row) return;
        const frames = allSelectableFrames().filter(f => filter === 'todos' || f.rarity === filter);
        row.innerHTML = frames.length
            ? frames.map(frameSelectorButtonMarkup).join('')
            : '<p style="font-size:0.6rem; color:#666;">Nenhuma moldura nessa raridade ainda.</p>';
    }

    // ── MOLDURAS CYBERPUNK: 5 modelos (frame-style-1 "NEON HEXLOCK" grátis,
    // frame-style-2 "NEON PULSE", frame-style-3 "GLITCH CORE", frame-style-4
    // "APOCALYPSE OVERRIDE", frame-subnet-static-pulse "STATIC PULSE" — os 4
    // últimos só compráveis na Loja do Spike/ZRK). ──
    async function setAvatarFrame(frameId) {
        if(selectedProfileUser !== currentUser.username) return;

        // Trava de segurança (camada extra, além do botão já vir desabilitado
        // no markup): nunca persiste uma moldura que o usuário não possui.
        if (frameId !== FRAME_DEFAULT_ID && (!Array.isArray(currentUser.cosmetics) || !currentUser.cosmetics.includes(frameId))) {
            console.warn('[MOLDURA] Bloqueado: usuário não possui', frameId);
            if (typeof showCyberAlert === 'function') {
                showCyberAlert('BLOQUEADO', 'Você ainda não possui essa moldura. Visite o ZRK na Loja.', 'error');
            }
            return;
        }

        currentUser.avatarFrame = frameId;
        const avatarFrameWrap = document.getElementById('avatarFrameWrap');
        if (avatarFrameWrap) {
            avatarFrameWrap.classList.remove(FRAME_DEFAULT_ID, 'frame-style-2', 'frame-style-3', 'frame-style-4', 'frame-subnet-static-pulse');
            avatarFrameWrap.classList.add(frameId);
        }
        document.querySelectorAll('#frameSelectorRow [data-frame]').forEach(b => {
            b.style.opacity = (b.dataset.frame === frameId) ? '1' : '0.45';
        });
        await updateProfileInSupabase(currentUser.id, { avatarFrame: frameId });
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

        // FILTRO ESTRITO: apenas itens com a tag 'evento'. Cards 'Fundidos' (Fused)
        // são EXCLUÍDOS mesmo que tragam a tag evento, pois não têm o tamanho/proporção
        // corretos para banner. Itens lendários "legados" sem a tag também não entram mais —
        // a regra agora é estritamente por tag, conforme solicitado.
        const eventItems = savedAssets.filter(i => i.tags && i.tags.includes('evento') && !i.isFused);

        const eventSection = document.createElement('div');
        eventSection.innerHTML = '<div style="font-size:0.55rem; color:#ff00ff; letter-spacing:2px; margin:12px 0 8px;">BANNERS DE EVENTO (CARDS TAG: EVENTO)</div>';

        const allEventCards = eventItems;
        if (allEventCards.length === 0) {
            eventSection.innerHTML += '<div style="color:#666; font-size:0.6rem; padding:8px;">Nenhum card de evento elegível no cofre. Apenas cards com tag [EVENTO] (não-fundidos) desbloqueiam banners personalizados.</div>';
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

    // =========================================================
    // [ESCOPO 6] BARRA DE BUSCA — localiza jogadores por @username
    // Sugestões ao vivo (ilike) enquanto digita + busca exata no Enter/clique
    // no botão. Reaproveita viewExternalProfile() pra navegação.
    // =========================================================
    let _userSearchDebounce = null;

    function _normalizeSearchTerm(raw) {
        return (raw || '').trim().replace(/^@/, '');
    }

    async function handleGlobalUserSearchInput() {
        clearTimeout(_userSearchDebounce);
        const input = document.getElementById('globalUserSearchInput');
        const box = document.getElementById('globalUserSearchSuggest');
        if (!input || !box) return;
        const term = _normalizeSearchTerm(input.value);

        if (term.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }

        _userSearchDebounce = setTimeout(async () => {
            const { data, error } = await sb.from('profiles')
                .select('username, avatar, code')
                .ilike('username', `%${term}%`)
                .limit(6);
            if (error) { console.error('handleGlobalUserSearchInput:', error.message); return; }
            if (!data || data.length === 0) {
                box.innerHTML = '<div class="gus-suggest-empty">Nenhum operador encontrado.</div>';
                box.style.display = 'block';
                return;
            }
            box.innerHTML = data.map(p => `
                <div class="gus-suggest-item" onclick="selectUserSearchResult('${p.username.replace(/'/g, "\\'")}')">
                    <img src="${p.avatar || 'https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg'}" class="gus-suggest-avatar">
                    <span>@${p.username}</span>
                    <span class="gus-suggest-code">${p.code || ''}</span>
                </div>
            `).join('');
            box.style.display = 'block';
        }, 250);
    }

    function selectUserSearchResult(username) {
        const input = document.getElementById('globalUserSearchInput');
        const box = document.getElementById('globalUserSearchSuggest');
        if (input) input.value = '';
        if (box) { box.style.display = 'none'; box.innerHTML = ''; }
        viewExternalProfile(username);
    }

    async function searchAndLoadUserProfile() {
        const input = document.getElementById('globalUserSearchInput');
        const box = document.getElementById('globalUserSearchSuggest');
        if (!input) return;
        const term = _normalizeSearchTerm(input.value);
        if (!term) return;
        if (box) { box.style.display = 'none'; box.innerHTML = ''; }
        const profile = await fetchProfileByUsername(term);
        if (!profile) {
            showCyberAlert('NÓ NÃO ENCONTRADO', `Nenhum operador com o handle @${term} está registrado na rede.`, 'error');
            return;
        }
        input.value = '';
        viewExternalProfile(term);
    }

    // Fecha o dropdown de sugestões ao clicar fora dele
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('globalUserSearch');
        const box = document.getElementById('globalUserSearchSuggest');
        if (wrapper && box && !wrapper.contains(e.target)) { box.style.display = 'none'; }
    });

    async function viewExternalProfile(username) {
        try {
            closeInspectModal();
        } catch(e) {}
        try {
            const p = await fetchProfileByUsername(username);
            // BUGFIX (redirecionamento): troca a tela ANTES de popular os dados,
            // e usa skipProfileReload=true para impedir que navigateTo('profile')
            // recarregue o perfil do usuário logado por cima do perfil-alvo.
            navigateTo('profile', true);
            if(p) {
                await viewTargetUserCollection(p.username, p.code, p.bio, p.avatar, p.banner, p.username === currentUser.username);
            } else {
                await viewTargetUserCollection(username, "#9999", "Membro estável.", "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", "", false);
            }
        } catch(e) {
            console.warn('viewExternalProfile error (fallback mockup):', e);
            try {
                navigateTo('profile', true);
                await viewTargetUserCollection(username, "#9999", "Operador desconectado.", "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", "", false);
            } catch(e2) { console.warn('viewExternalProfile fallback failed:', e2); }
        }
    }

    function toggleBioEdit() {
        const textarea = document.getElementById('inputBio');
        const actions = document.getElementById('bioEditActions');
        const btn = document.getElementById('btnEditBio');
        if (!textarea) return;
        textarea.value = currentUser.bio || '';
        textarea.classList.add('active');
        actions.classList.add('active');
        btn.style.display = 'none';
        textarea.focus();
    }

    function cancelBioEdit() {
        const textarea = document.getElementById('inputBio');
        const actions = document.getElementById('bioEditActions');
        const btn = document.getElementById('btnEditBio');
        if (textarea) textarea.classList.remove('active');
        if (actions) actions.classList.remove('active');
        if (btn) btn.style.display = '';
    }

    async function saveProfileCustoms() {
        const bioVal = document.getElementById('inputBio').value.trim();
        currentUser.bio = bioVal;
        const bioView = document.getElementById('profBioView');
        if (bioView) bioView.innerText = bioVal;
        cancelBioEdit();
        await updateProfileInSupabase(currentUser.id, { bio: bioVal });
    }

    function openDepositModal() { document.getElementById('depositModal').style.display = 'flex'; }
    function closeDepositModal() { document.getElementById('depositModal').style.display = 'none'; }

    async function simularDeposito(amount) {
        currentUser.bumps += amount;
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
        await updateProfileInSupabase(currentUser.id, { bumps: currentUser.bumps });
        const walletBadgeD = document.getElementById('wallet-balance-badge');
        if (walletBadgeD) walletBadgeD.innerText = `${currentUser.bumps} B$`;
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

    // Cada contrato agora tem riskChance (0–1): probabilidade de o card ser
    // CORROMPIDO (destruído) ao final da missão. Isso cria um dreno real
    // de cartas comuns e evita acúmulo infinito no mercado.
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
            reward: 5,
            riskChance: 0.15, // 15% de chance de corrupção
            riskLabel: '⚠ 15% RISCO DE CORRUPÇÃO'
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
            reward: 30,
            riskChance: 0.25, // 25% de chance de corrupção
            riskLabel: '⚠ 25% RISCO DE CORRUPÇÃO'
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
            reward: 100,
            riskChance: 0.35, // 35% de chance de corrupção
            riskLabel: '⚠ 35% RISCO DE CORRUPÇÃO'
        },
        {
            id: 'CTR-04',
            name: 'Purgar Protocolo Ghost',
            desc: 'Missão suicida. Queime 3 cartas comuns como isca para atrair os scanners e abrir caminho para a rede fantasma.',
            durationMs: 3 * 60 * 1000,
            durationLabel: '3 MIN',
            reqCount: 3,
            reqRarity: 'common',
            reqLabel: '3 Cards Comuns',
            reward: 25,
            riskChance: 0.50, // 50% de chance de corrupção — alto risco, maior recompensa relativa
            riskLabel: '☠ 50% RISCO DE DESTRUIÇÃO'
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

        // === RISCO DE CORRUPÇÃO ===
        const riskChance = contract.riskChance || 0;
        const corruptedIds = [];
        const survivedIds   = [];

        cardIds.forEach(cid => {
            if (riskChance > 0 && Math.random() < riskChance) {
                corruptedIds.push(cid);
            } else {
                survivedIds.push(cid);
            }
        });

        // Marca cards corrompidos como purged (não apaga) + concede Fragmentos de Sucata
        let fragmentsEarned = 0;
        for (const cid of corruptedIds) {
            const idx = savedAssets.findIndex(a => a.id === cid);
            const card = idx > -1 ? savedAssets[idx] : null;
            try {
                // BUGFIX: a query usava .eq('id', cid) comparando o id de
                // EXIBIÇÃO (ex: "#449201") contra a coluna `id` (uuid real
                // da linha) — nunca dava match, então o card corrompido nunca
                // era de fato marcado no banco. Usa _dbId (uuid real) em vez disso.
                if (card && card._dbId) await purgeCardInSupabase(card._dbId, 'contrato_corrupcao');
            } catch(e) { console.error('concludeContract purge corrupted:', e); }
            if (card) markCardPurgedLocally(card, 'contrato_corrupcao');
            fragmentsEarned += FRAGMENTS_PER_CORRUPTED_CARD;
        }

        // Desbloqueia cards que sobreviveram
        survivedIds.forEach(cid => {
            const card = savedAssets.find(a => a.id === cid);
            if (card) card.isLocked = false;
        });

        // Adiciona fragmentos ao saldo do usuário se houve corrupção
        if (fragmentsEarned > 0) {
            currentUser.fragments = (currentUser.fragments || 0) + fragmentsEarned;
            await updateProfileInSupabase(currentUser.id, { fragments: currentUser.fragments });
        }

        // Adiciona recompensa em Bumps
        currentUser.bumps += contract.reward;
        await updateProfileInSupabase(currentUser.id, { bumps: currentUser.bumps });

        // Remove contrato ativo
        const active = loadActiveContracts();
        delete active[contractId];
        saveActiveContracts(active);

        // Atualiza badge de saldo se visível
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;

        // Monta mensagem de resultado
        let resultMsg = `<b style="color:#ff6600;">${contract.name}</b><br>`;
        resultMsg += `+<b style="color:#ffaa00;">${contract.reward} B$</b> adicionados ao terminal.<br>`;
        if (corruptedIds.length > 0) {
            resultMsg += `<br><span style="color:#ff0044;">☠ ${corruptedIds.length} card(s) CORROMPIDO(s) e destruído(s) na operação.</span>`;
            resultMsg += `<br><span style="color:#aaa;">+${fragmentsEarned} Fragmento(s) de Sucata concedido(s) como compensação.</span>`;
        } else {
            resultMsg += `<br><span style="color:#00ff66;">✓ Todos os cards retornaram intactos.</span>`;
        }

        playSynthSound('success');
        showCyberAlert('CONTRATO_CONCLUÍDO', resultMsg, corruptedIds.length > 0 ? 'warn' : 'success');

        // Re-renderiza tela se estiver aberta
        const screen = document.getElementById('screen-contracts');
        if (screen && screen.classList.contains('active')) renderContractsScreen();
        // Atualiza cofre se aberto
        if (document.getElementById('screen-vault') && document.getElementById('screen-vault').classList.contains('active')) renderVault();
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
                    ${contract.riskChance ? `<span class="contract-meta-pill pill-risk" style="border-color:#ff0044; color:#ff0044;">${contract.riskLabel}</span>` : ''}
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
        resolutions: row.resolutions || { ui: { w: 500, h: 500 }, hd: { w: 4000, h: 4000, src: null } },
        // [ESCOPO 4] CARIMBO DE EXCLUSÃO — estado purged/detonada
        isPurged: row.is_purged ?? false,
        purgedAt: row.purged_at || null,
        purgedReason: row.purged_reason || null,
        // [ESCOPO 3] mídia animada gerada pela fusão (gif/webp), se houver
        isAnimated: row.is_animated ?? false,
        animatedMime: row.animated_mime || null
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
        resolutions: card.resolutions || { ui: { w: 500, h: 500 }, hd: { w: 4000, h: 4000, src: null } },
        is_purged: card.isPurged ?? false,
        purged_at: card.purgedAt || null,
        purged_reason: card.purgedReason || null,
        is_animated: card.isAnimated ?? false,
        animated_mime: card.animatedMime || null
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
// [ESCOPO 4] CARIMBO DE EXCLUSÃO — PURGE (estado purged/detonada)
// Usado no lugar de deleteCardFromSupabase sempre que um card é
// sacrificado/consumido nas mecânicas de fusão ou descarte. Em vez
// de remover a linha, marca is_purged=true (+ timestamp e motivo) e
// bloqueia exposição/venda/listagem. O card permanece visível como
// registro histórico no cofre e no Inspect, com o efeito de chamas
// + selo PURGED/DETONADA, em vez de simplesmente desaparecer.
// =========================================================
async function purgeCardInSupabase(cardDbId, reason) {
    if (!cardDbId) return false;
    const { error } = await sb.from('cards').update({
        is_purged: true,
        purged_at: new Date().toISOString(),
        purged_reason: reason || 'fusao',
        exposed: false, for_sale: false, is_listed: false
    }).eq('id', cardDbId);
    if (error) { console.error('purgeCardInSupabase:', error.message); return false; }
    return true;
}

// Aplica o mesmo carimbo no objeto em memória, espelhando o update remoto
// acima — evita um reload completo do cofre só pra refletir o purge.
function markCardPurgedLocally(card, reason) {
    if (!card) return;
    card.isPurged = true;
    card.purgedAt = new Date().toISOString();
    card.purgedReason = reason || 'fusao';
    card.exposed = false; card.forSale = false; card.isListed = false;
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

        // Ledger entry + feed global: o card só entra na rede pública AGORA,
        // porque só agora ele é real e definitivo (gravado em `cards` via
        // insertCardToSupabase acima). Drops não-resgatados nunca chegam aqui.
        pushLedger(`${currentUser.username} resgatou o card ${assetSnapshot.id} [${assetSnapshot.rarityNameEN}]`);
        pushFeedCard(assetSnapshot);

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
    if (!asset) { console.warn('toggleExposeAsset: index inválido', index); return; }
    if (asset.isPurged) {
        showCyberAlert('CARD_DETONADO', 'Cards detonados (purged) não podem ser expostos na vitrine.', 'error');
        return;
    }
    if (asset.isListed) {
        playSynthSound('shatter');
        showCyberAlert('🔒 ATIVO BLOQUEADO EM CUSTÓDIA NO MERCADO', 'Este card está listado no mercado e está em custódia. Remove o anúncio primeiro para alterar o seu estado.', 'error');
        return;
    }
    if (!asset._dbId) {
        showCyberAlert('ERRO DE SINCRONIZAÇÃO', 'Este card ainda não foi sincronizado com o servidor. Recarregue a página.', 'error');
        return;
    }

    const novoEstado = !asset.exposed;
    savedAssets[index].exposed = novoEstado;
    renderVaultGrid(); // feedback imediato na UI

    const ok = await updateCardInSupabase(asset, { exposed: novoEstado });
    if (!ok) {
        savedAssets[index].exposed = !novoEstado; // rollback
        showCyberAlert('ERRO_DE_REDE', 'Não foi possível atualizar a vitrine. Tenta novamente.', 'error');
        renderVaultGrid();
        return;
    }

    playSynthSound(novoEstado ? 'success' : 'click');
    showCyberAlert(
        novoEstado ? '⭐ EXPOSTO NA VITRINE' : '📁 RETIRADO DA VITRINE',
        novoEstado ? `Card <b>${asset.id}</b> agora aparece na sua vitrine pública.` : `Card <b>${asset.id}</b> retirado da vitrine.`,
        'success'
    );
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

// =========================================================
// BOOT: REALTIME GLOBAL
// Chamada movida pra cá (fim do arquivo) DE PROPÓSITO: nesse ponto da
// execução, TODAS as declarações `let`/`const` que initGlobalRealtime()
// usa (globalFeed, ledgerCache, marketAssets, SEED_FEED, _globalRealtimeStarted)
// já rodaram. Chamar isto mais acima no arquivo (antes dessas declarações)
// lança ReferenceError por TDZ e trava o resto do script — é exatamente
// isso que causava "nada clica / drop não gira" depois desse patch.
// Roda incondicionalmente, sem esperar login — é o que faz uma aba
// anônima (ou qualquer conta) ver a MESMA atividade da rede ao vivo.
// =========================================================
initGlobalRealtime();


/* ════════ MÓDULO MERCADO_NEGRO_DO_SPIKE — anexado automaticamente ════════ */

/* ════════════════════════════════════════════════════════════════════
   MÓDULO: MERCADO NEGRO DO SPIKE — renderLoja()
   ────────────────────────────────────────────────────────────────────
   Cole este bloco no final do seu script.js (ou em outro arquivo
   carregado depois do script.js, já que ele usa currentUser).

   USO:
     1. Garanta que existe uma <div id="lojaScreen"></div> ou similar
        na sua div principal de conteúdo (ou troque LOJA_TARGET_ID
        abaixo pelo id da sua div de tela atual).
     2. Chame renderLoja() quando o usuário navegar pra essa tela,
        do mesmo jeito que você já chama renderVaultGrid(), etc.
        Ex: if (screenId === 'loja') renderLoja();

   INTEGRAÇÃO SUPABASE: handlePurchase() e handleAcceptContract() só
   logam no console e atualizam currentUser.bumps em memória. Os
   pontos marcados com "// TODO SUPABASE" são onde entram as chamadas
   reais (updateProfileInSupabase, grant de cosmético, etc.) — seguem
   o mesmo padrão usado em renderDailyMissions() / claimDailyDrop().
   ════════════════════════════════════════════════════════════════════ */

// ID da div onde a Loja será injetada. Troque para o id real da sua
// div de conteúdo principal se ela já existir (ex: 'screen-loja').
const LOJA_TARGET_ID = 'lojaScreen';

// Estado local de cosméticos comprados. Fonte de verdade é o Supabase
// (coluna profiles.cosmetics) — currentUser.cosmetics já vem populado dali
// no login/refresh (ver applyProfileToCurrentUser). lojaOwnedItems deixou
// de existir como array mock separado: tudo lê/escreve direto em
// currentUser.cosmetics, pra nunca dessincronizar do banco.

// ── PONTO ET PUNK — comerciante da Loja trocado de robô (🤖 "Spike") pra
// um ET com estética punk ("ZRK", abreviação de "Zarkrin", o nome real é
// impronunciável em qualquer idioma humano). Mantido o nome da constante
// (SPIKE_LINES_LOJA) por compatibilidade com qualquer outro ponto do
// código que ainda referencie esse identificador — só o CONTEÚDO das
// falas e a renderização visual (lojaBuildMarkup) mudaram.
const SPIKE_LINES_LOJA = [
    "Hackeei o firmware da nave só pra abrir essa loja aqui. Valeu a pena.",
    "Root no mainframe, root no seu cartão. Mesma técnica, planetas diferentes.",
    "Atravessei sete firewalls intergalácticos pra te vender essa moldura.",
    "Bumps são só números num banco de dados. Eu já invadi bancos de dados melhores que esse.",
    "Garantia? Aqui não. Mas o exploit que usei pra entrar nessa estação, esse sim era sólido.",
    "Sucateiro raiz desde antes do colapso da Rede Outer. E sysadmin não-certificado desde sempre.",
    "Se a luz neon queimar seu olho, já era — não devolvo B$. Reporta bug, eu rio.",
    "Tenho exploits novos chegando. Ou não. Depende do humor do firewall da Terra.",
    "Não pirateei sua nave-mãe. Ainda. Compra logo essa moldura.",
    "Meu antivírus é desconfiança. O seu devia ser também.",
    "Decodifiquei sua linguagem em 0.3 segundos. Seus preços, em menos ainda.",
    "Punk não morre, só recompila."
];

// Moldura padrão (frame-style-1) não é vendida na Loja — todo usuário já
// nasce com ela equipada (ver currentUser.avatarFrame inicial). Por isso não
// entra em LOJA_FRAME_ITEMS (que só lista o que é comprável), mas precisa
// de uma entrada de raridade própria pro seletor/filtro saber como tratá-la.
const FRAME_DEFAULT_ID = 'frame-style-1';
const EQUIPMENT_INVENTORY_TARGET_ID = 'profEquipmentInventoryZone';
const FRAME_DEFAULT_RARITY = 'raro';

const LOJA_FRAME_ITEMS = [
    { id: 'frame-style-2', category: 'moldura', name: 'Neon Pulse',           price: 1000, accent: '#00ffff', tagline: 'Pulso cíclico de luz fria ao redor do avatar.', rarity: 'raro' },
    { id: 'frame-style-3', category: 'moldura', name: 'Glitch Core',          price: 2200, accent: '#ff00ff', tagline: 'Distorção de sinal instável. Estética de corrompido.', rarity: 'lendario' },
    { id: 'frame-style-4', category: 'moldura', name: 'Apocalypse Override',  price: 3500, accent: '#ff0044', tagline: 'Moldura de emergência de núcleo. Só pra raridade alta.', rarity: 'ancestral' }
];

// ── Categoria "Molduras de Sub-Rede": linha de molduras de entrada,
// vendida separada das molduras principais (LOJA_FRAME_ITEMS). Usa a
// mesma category 'moldura' pra reaproveitar toda a lógica de equip já
// existente (setAvatarFrame / cosmeticSlotForCategory ignora 'moldura'
// de qualquer forma, pois molduras usam slot próprio).
const LOJA_SUBNET_FRAME_ITEMS = [
    { id: 'frame-subnet-static-pulse', category: 'moldura', name: 'Static Pulse', price: 250, accent: '#88aaff', tagline: 'Ruído de sinal fraco da sub-rede. Pulso instável, preço de entrada.', rarity: 'raro' }
];

const LOJA_BACKGROUND_ITEMS = [
    { id: 'bg-neon-glow',   category: 'fundo', name: 'Luz Neon de Fundo',  price: 850, accent: '#ffaa00', tagline: 'Glow ambiente atrás do perfil. Liga sozinho à noite.', colorKey: 'amber' },
    { id: 'bg-neon-toxic',  category: 'fundo', name: 'Luz Neon Tóxica',    price: 850, accent: '#22c55e', tagline: 'Glow verde tóxico ao redor da caixa de perfil.', colorKey: 'green' },
    { id: 'bg-neon-violet', category: 'fundo', name: 'Luz Neon Violeta',   price: 950, accent: '#a855f7', tagline: 'Glow roxo-elétrico, vibe synthwave.', colorKey: 'purple' }
];

// Mapa colorKey → classes Tailwind reais aplicadas no profile-main-box quando
// o acessório de fundo correspondente está equipado (Ponto 4 — efeito real,
// não decorativo).
const NEON_BG_TAILWIND_CLASSES = {
    amber:  ['shadow-[inset_0_0_50px_rgba(255,170,0,0.35)]',  'bg-gradient-to-b', 'from-amber-950/40',  'to-transparent'],
    green:  ['shadow-[inset_0_0_50px_rgba(34,197,94,0.3)]',   'bg-gradient-to-b', 'from-green-950/40',  'to-transparent'],
    purple: ['shadow-[inset_0_0_50px_rgba(168,85,247,0.35)]', 'bg-gradient-to-b', 'from-purple-950/40', 'to-transparent']
};
// Lista achatada de TODAS as classes possíveis, usada só pra limpeza (remover
// tudo antes de aplicar o conjunto novo, evitando acúmulo de classes mortas).
const NEON_BG_TAILWIND_ALL_CLASSES = Object.values(NEON_BG_TAILWIND_CLASSES).flat();

const LOJA_EMOTICON_ITEMS = [
    { id: 'emo-pack-circuito',  category: 'emoticon', name: 'Pack Circuito',  price: 300, accent: '#00ff66', tagline: '12 emoticons de chat com tema de placa-mãe.', glyphs: ['⚡','🛰️','☢','⬡'] },
    { id: 'emo-pack-ancestral', category: 'emoticon', name: 'Pack Ancestral', price: 600, accent: '#ff007f', tagline: '12 emoticons raros, tema runas digitais.', glyphs: ['✦','◈','✧','⟁'] }
];

// ── PONTO 1 — Adereços para os Cards: pequeno elemento absoluto injetado
// acima da PFP do avatar quando equipado (ver applyEquippedPropEffect). ──
const LOJA_PROP_ITEMS = [
    { id: 'prop-chapeu-pixel',  category: 'adereco', name: 'Chapéu Pixel',   price: 450, accent: '#ffaa00', tagline: 'Chapéu 8-bit sobreposto na PFP. Clássico do underground.', glyph: '🎩' },
    { id: 'prop-peruca-cyber',  category: 'adereco', name: 'Peruca Cyber',   price: 600, accent: '#00ffff', tagline: 'Fios de fibra ótica no lugar de cabelo. Carrega de noite.', glyph: '💇' },
    { id: 'prop-oculos-glitch', category: 'adereco', name: 'Óculos Glitch',  price: 520, accent: '#ff00ff', tagline: 'Lente com falha de sinal permanente. Estilo, não defeito.', glyph: '🕶️' }
];

// ── PONTO 1 — Estantes e Expositores: mudam a moldura/fundo do slot
// individual onde cada card fica posicionado na Vitrine (ver applyEquippedShelfEffect). ──
const LOJA_SHELF_ITEMS = [
    { id: 'shelf-suporte-mainframe', category: 'estante', name: 'Suporte Mainframe', price: 700, accent: '#00ffff', tagline: 'Slots com moldura metálica de placa-mãe industrial.' },
    { id: 'shelf-estante-neon',      category: 'estante', name: 'Estante Neon',      price: 780, accent: '#ff00ff', tagline: 'Slots com glow neon individual atrás de cada card.' }
];

const LOJA_ALL_ITEMS = [...LOJA_FRAME_ITEMS, ...LOJA_SUBNET_FRAME_ITEMS, ...LOJA_BACKGROUND_ITEMS, ...LOJA_PROP_ITEMS, ...LOJA_SHELF_ITEMS, ...LOJA_EMOTICON_ITEMS];

// Mapeia a categoria de um item de loja pro slot correspondente dentro de
// currentUser.equippedCosmetics. Molduras NÃO entram aqui — elas usam a
// coluna própria avatar_frame / a function setAvatarFrame.
function cosmeticSlotForCategory(category) {
    if (category === 'fundo') return 'background';
    if (category === 'adereco') return 'prop';
    if (category === 'estante') return 'shelf';
    if (category === 'emoticon') return 'emoticon';
    return null;
}

const LOJA_MOCK_CONTRACTS = [
    { id: 'ctr-001', title: 'EMPRÉSTIMO_DE_CARD // RAID NOTURNA',        status: 'EM_BREVE',  reward: 140, minRarity: 'epic',      description: 'Cede um card épico+ por 6h para operação coletiva. Recompensa em B$ ao final.' },
    { id: 'ctr-002', title: 'EMPRÉSTIMO_DE_CARD // VITRINE_PATROCINADA', status: 'EM_BREVE',  reward: 300, minRarity: 'legendary', description: 'Card lendário exposto na vitrine parceira por 24h. Risco zero de destruição.' },
    { id: 'ctr-003', title: 'EMPRÉSTIMO_DE_CARD // FORNALHA_DE_TERCEIROS', status: 'BLOQUEADO', reward: 620, minRarity: 'ancestral', description: 'Card ancestral usado como garantia em fornalha alheia. Alto risco, alta paga.' }
];

// ── garante o CDN do Tailwind, já que o resto do site não carrega ──
function ensureTailwindLoaded(callback) {
    if (window.tailwind || document.getElementById('loja-tailwind-cdn')) {
        callback();
        return;
    }
    const script = document.createElement('script');
    script.id = 'loja-tailwind-cdn';
    script.src = 'https://cdn.tailwindcss.com';
    script.onload = callback;
    document.head.appendChild(script);
}

function lojaPreviewMarkup(item) {
    if (item.category === 'moldura') {
        return `<div class="w-full h-full flex items-center justify-center bg-black">
                    <div class="w-16 h-16 rounded-full border-2 animate-pulse" style="border-color:${item.accent}; box-shadow:0 0 18px ${item.accent};"></div>
                </div>`;
    }
    if (item.category === 'fundo') {
        return `<div class="w-full h-full flex items-center justify-center bg-black">
                    <div class="w-20 h-20 rounded-full blur-sm" style="background:radial-gradient(circle, ${item.accent}55 0%, transparent 70%);"></div>
                </div>`;
    }
    if (item.category === 'emoticon') {
        return `<div class="w-full h-full flex items-center justify-center gap-2 bg-black text-2xl">
                    ${(item.glyphs || []).slice(0, 4).map(g => `<span style="color:${item.accent}; text-shadow:0 0 8px ${item.accent};">${g}</span>`).join('')}
                </div>`;
    }
    if (item.category === 'adereco') {
        return `<div class="w-full h-full flex items-center justify-center bg-black text-4xl">
                    <span style="filter: drop-shadow(0 0 8px ${item.accent});">${item.glyph || '✨'}</span>
                </div>`;
    }
    if (item.category === 'estante') {
        return `<div class="w-full h-full grid grid-cols-2 gap-1 p-2 bg-black">
                    ${Array.from({ length: 4 }).map(() => `<div class="border" style="border-color:${item.accent}; box-shadow:inset 0 0 8px ${item.accent}66;"></div>`).join('')}
                </div>`;
    }
    return '';
}

function lojaItemCardMarkup(item) {
    const owned = !!(currentUser && Array.isArray(currentUser.cosmetics) && currentUser.cosmetics.includes(item.id));
    const balance = (currentUser && currentUser.bumps) || 0;
    const affordable = balance >= item.price;

    const btnClasses = owned
        ? 'border border-zinc-700 text-zinc-600 cursor-not-allowed'
        : affordable
            ? 'bg-amber-500 text-black border border-amber-500 hover:bg-amber-400 cursor-pointer'
            : 'border border-zinc-800 text-zinc-600 cursor-not-allowed';
    const btnLabel = owned ? 'ATIVO' : affordable ? 'COMPRAR' : 'SEM B$';

    return `
        <div class="relative bg-[#0a0703] border ${owned ? '' : 'border-amber-900/40'} p-3 flex flex-col gap-2.5 transition-all hover:border-amber-500 hover:-translate-y-0.5"
             style="${owned ? `border-color:${item.accent}; box-shadow:0 0 14px ${item.accent}33;` : ''}">
            ${owned ? `<div class="absolute -top-2 -left-2 text-[0.55rem] font-bold px-1.5 py-0.5 text-black" style="background:${item.accent}; box-shadow:0 0 10px ${item.accent};">INSTALADO</div>` : ''}
            <div class="w-full aspect-square border border-zinc-900">
                ${lojaPreviewMarkup(item)}
            </div>
            <div class="flex flex-col gap-0.5">
                <span class="text-[0.5rem] uppercase tracking-wider font-bold text-amber-800">${item.category}</span>
                <span class="text-sm font-extrabold text-amber-200">${item.name}</span>
                <span class="text-[0.62rem] text-amber-700/80 leading-snug">${item.tagline}</span>
            </div>
            <div class="flex items-center justify-between mt-1">
                <span class="text-sm font-extrabold text-amber-500">${item.price} B$</span>
                <button
                    class="text-[0.6rem] font-extrabold uppercase tracking-wide px-3 py-1.5 ${btnClasses}"
                    ${owned || !affordable ? 'disabled' : ''}
                    onclick="lojaHandlePurchase('${item.id}')">
                    ${btnLabel}
                </button>
            </div>
        </div>
    `;
}

function lojaContractCardMarkup(contract) {
    const locked = true; // mock — contratos reais ainda não habilitados
    const statusColor = contract.status === 'EM_BREVE' ? 'text-amber-500 border-amber-500'
        : contract.status === 'BLOQUEADO' ? 'text-red-500 border-red-500'
        : 'text-emerald-500 border-emerald-500';

    return `
        <div class="bg-[#0a0703] border border-amber-900/40 p-4 flex flex-col gap-2.5">
            <div class="flex justify-between items-start gap-2.5">
                <span class="text-[0.75rem] font-extrabold text-amber-200">${contract.title}</span>
                <span class="text-[0.5rem] font-extrabold ${statusColor} border px-1.5 py-0.5 whitespace-nowrap">${contract.status}</span>
            </div>
            <p class="text-[0.65rem] text-amber-700/80 leading-relaxed m-0">${contract.description}</p>
            <div class="flex justify-between items-center mt-1">
                <span class="text-[0.6rem] text-amber-800">RARIDADE MÍN: <b class="text-amber-500">${contract.minRarity.toUpperCase()}</b></span>
                <span class="text-sm font-extrabold text-amber-500">+${contract.reward} B$</span>
            </div>
            <button
                class="mt-1 text-[0.6rem] font-extrabold uppercase tracking-wide py-2 border border-zinc-800 text-zinc-600 cursor-not-allowed"
                disabled
                onclick="lojaHandleAcceptContract('${contract.id}')">
                AGUARDANDO_ABERTURA
            </button>
        </div>
    `;
}

function lojaCategorySection(label, items) {
    if (items.length === 0) return '';
    return `
        <div class="mb-7">
            <h2 class="text-[0.7rem] font-extrabold text-amber-500 tracking-widest mb-3 border-l-2 border-amber-500 pl-2 uppercase">${label}</h2>
            <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));">
                ${items.map(lojaItemCardMarkup).join('')}
            </div>
        </div>
    `;
}

function lojaBuildMarkup() {
    const balance = (currentUser && currentUser.bumps) || 0;
    const line = SPIKE_LINES_LOJA[Math.floor(Math.random() * SPIKE_LINES_LOJA.length)];

    return `
    <div class="min-h-screen bg-black text-amber-200 font-mono p-5 pb-16 relative overflow-hidden" style="font-family:'Space Mono', monospace;">

        <div class="flex justify-between items-center flex-wrap gap-3.5 mb-6 relative z-10">
            <div>
                <h1 class="text-base font-extrabold tracking-widest text-amber-500 uppercase m-0" style="text-shadow:0 0 14px rgba(255,170,0,0.5);">
                    MERCADO_NEGRO // TERMINAL_DE_SUCATA
                </h1>
                <p class="text-[0.6rem] text-amber-800 mt-1 tracking-wide">ACESSO NÃO REGISTRADO. NEGOCIE POR SUA CONTA E RISCO.</p>
            </div>
            <div class="flex items-center gap-2.5 bg-[#0a0703] border border-amber-500 px-4 py-2.5" style="box-shadow:0 0 14px rgba(255,170,0,0.18);">
                <div class="w-6 h-6 rounded-full border-2 border-amber-500 flex items-center justify-center text-xs font-extrabold text-amber-500" style="box-shadow:0 0 10px #ffaa00;">B</div>
                <div class="flex flex-col leading-tight">
                    <span class="text-[0.5rem] text-amber-800 tracking-wide">SALDO_ATUAL</span>
                    <span id="lojaBalanceDisplay" class="text-sm font-extrabold text-amber-200">${balance.toLocaleString('pt-BR')} B$</span>
                </div>
            </div>
        </div>

        <div class="flex gap-4 items-start bg-[#0a0703] border border-amber-900/40 p-4 mb-6 relative z-10 flex-wrap">
            <div id="lojaEtAvatar" class="w-16 h-16 flex-shrink-0 border-2 border-amber-500 flex items-center justify-center text-3xl relative loja-et-avatar" style="background:repeating-linear-gradient(45deg, #100b03 0px, #100b03 4px, #1a1206 4px, #1a1206 8px); box-shadow:0 0 16px rgba(255,170,0,0.35); cursor:pointer;" onclick="speakZrkLine()" title="Clique pra ouvir o ZRK">
                👽
                <span class="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" style="box-shadow:0 0 8px #00ff66;"></span>
            </div>
            <div class="flex-1" style="min-width:220px;">
                <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span class="text-[0.7rem] font-extrabold text-amber-500 tracking-wide">ZRK // ET_PUNK</span>
                    <span class="text-[0.5rem] text-emerald-500 border border-emerald-500 px-1.5 tracking-wide">[ZRK_v0.49_ONLINE]</span>
                </div>
                <div id="lojaSpikeLine" class="bg-black border border-zinc-900 px-3 py-2.5 text-[0.7rem] text-amber-300 leading-relaxed" style="min-height:36px;">
                    ▸ ${line}
                </div>
            </div>
        </div>

        <div class="flex gap-2 mb-5 relative z-10 border-b border-amber-900/40 flex-wrap">
            <button id="lojaTabBtnContratos" onclick="lojaSwitchTab('contratos')"
                class="bg-transparent text-amber-800 border-b-2 border-transparent text-[0.65rem] font-extrabold tracking-wide px-4.5 py-2.5 uppercase cursor-pointer transition-all">
                [ CONTRATOS ]
            </button>
            <button id="lojaTabBtnCosmeticos" onclick="lojaSwitchTab('cosmeticos')"
                class="bg-amber-500 text-black border-b-2 border-amber-500 text-[0.65rem] font-extrabold tracking-wide px-4.5 py-2.5 uppercase cursor-pointer transition-all">
                [ COSMÉTICOS ]
            </button>
            <button id="lojaTabBtnFragmentos" onclick="lojaSwitchTab('fragmentos')"
                class="bg-transparent text-amber-800 border-b-2 border-transparent text-[0.65rem] font-extrabold tracking-wide px-4.5 py-2.5 uppercase cursor-pointer transition-all"
                style="border-color:transparent; color:#aaaaaa;">
                [ FRAGMENTOS 🧩 ]
            </button>
        </div>

        <div id="lojaTabContratos" class="hidden relative z-10">
            <p class="text-[0.65rem] text-amber-800 mb-4">
                Espaço reservado para missões futuras de empréstimo de cards. ZRK libera contratos por conta própria — sem aviso, sem garantia.
            </p>
            <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));">
                ${LOJA_MOCK_CONTRACTS.map(lojaContractCardMarkup).join('')}
            </div>
        </div>

        <div id="lojaTabCosmeticos" class="relative z-10">
            <div class="loja-filter-bar">
                <button class="loja-filter-btn active" data-loja-cat="todos" onclick="lojaFilterCategory('todos')">TODOS</button>
                <button class="loja-filter-btn" data-loja-cat="molduras" onclick="lojaFilterCategory('molduras')">MOLDURAS</button>
                <button class="loja-filter-btn" data-loja-cat="subnet" onclick="lojaFilterCategory('subnet')">MOLDURAS SUB-REDE</button>
                <button class="loja-filter-btn" data-loja-cat="fundo" onclick="lojaFilterCategory('fundo')">LUZ DE FUNDO</button>
                <button class="loja-filter-btn" data-loja-cat="adereco" onclick="lojaFilterCategory('adereco')">ADEREÇOS</button>
                <button class="loja-filter-btn" data-loja-cat="estante" onclick="lojaFilterCategory('estante')">ESTANTES</button>
                <button class="loja-filter-btn" data-loja-cat="emoticon" onclick="lojaFilterCategory('emoticon')">EMOTICONS</button>
            </div>
            <div id="lojaCatMolduras" data-loja-cat="molduras">${lojaCategorySection('MOLDURAS', LOJA_FRAME_ITEMS)}</div>
            <div id="lojaCatSubnet" data-loja-cat="subnet">${lojaCategorySection('MOLDURAS DE SUB-REDE', LOJA_SUBNET_FRAME_ITEMS)}</div>
            <div id="lojaCatFundo" data-loja-cat="fundo">${lojaCategorySection('LUZ DE FUNDO', LOJA_BACKGROUND_ITEMS)}</div>
            <div id="lojaCatAdereco" data-loja-cat="adereco">${lojaCategorySection('ADEREÇOS DE CARD', LOJA_PROP_ITEMS)}</div>
            <div id="lojaCatEstante" data-loja-cat="estante">${lojaCategorySection('ESTANTES E EXPOSITORES', LOJA_SHELF_ITEMS)}</div>
            <div id="lojaCatEmoticon" data-loja-cat="emoticon">${lojaCategorySection('EMOTICONS', LOJA_EMOTICON_ITEMS)}</div>
        </div>

        <div id="lojaTabFragmentos" class="hidden relative z-10">
            ${lojaFragmentosTabMarkup()}
        </div>

        <div class="pointer-events-none absolute inset-0 z-20" style="background-image:repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(255,170,0,0.035) 2px, rgba(255,170,0,0.035) 3px); mix-blend-mode:overlay;"></div>
    </div>
    `;
}

// ── ALTERNÂNCIA DE ABAS (classList hidden, nativo) ──
// ── Gera o HTML da aba de Fragmentos de Sucata ──
function lojaFragmentosTabMarkup() {
    const frags = (currentUser && typeof currentUser.fragments === 'number') ? currentUser.fragments : 0;
    const ticketCost  = typeof FRAGMENTS_TO_REDEEM_TICKET !== 'undefined' ? FRAGMENTS_TO_REDEEM_TICKET : 30;
    const itemCost    = typeof FRAGMENTS_TO_REDEEM_ITEM   !== 'undefined' ? FRAGMENTS_TO_REDEEM_ITEM   : 15;
    const canTicket   = frags >= ticketCost;
    const canItem     = frags >= itemCost;

    return `
    <div style="margin-bottom:18px;">
        <div style="color:#aaa; font-size:0.6rem; letter-spacing:2px; margin-bottom:4px;">🧩 SISTEMA DE FRAGMENTOS DE SUCATA</div>
        <p style="font-size:0.6rem; color:#666688; margin-bottom:16px; line-height:1.6;">
            Fragmentos são gerados quando cartas são <b style="color:#ff0044;">destruídas</b> em Contratos ou na Fornalha de Sobrecarga.
            Acumule-os e troque por recompensas aqui — nunca fique completamente bloqueado.
        </p>

        <div style="background:#0a0a14; border:1px solid #333355; padding:16px; margin-bottom:18px; display:flex; align-items:center; gap:16px;">
            <div style="font-size:2rem;">🧩</div>
            <div>
                <div style="font-size:0.55rem; color:#666688; letter-spacing:2px;">SEU SALDO DE FRAGMENTOS</div>
                <div id="lojaFragsDisplay" style="font-size:1.4rem; font-weight:bold; color:#00ffcc; font-family:'Archivo Black', monospace;">${frags}</div>
            </div>
        </div>

        <div style="display:grid; gap:14px; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));">

            <div style="background:#070712; border:1px solid ${canItem ? '#00ffcc' : '#223'}; padding:16px;">
                <div style="color:#00ffcc; font-size:0.65rem; font-weight:bold; letter-spacing:1px; margin-bottom:6px;">POEIRA DE SILÍCIO</div>
                <p style="font-size:0.55rem; color:#888899; margin-bottom:12px;">Item básico usado como catalisador na Alquimia. Essencial para novas fusões.</p>
                <div style="font-size:0.6rem; color:#aaa; margin-bottom:10px;">Custo: <b style="color:#00ffcc;">${itemCost} 🧩 Fragmentos</b></div>
                <button onclick="redeemFragment('item')"
                    style="width:100%; padding:10px; background:${canItem ? '#00ffcc22' : '#111'}; border:1px solid ${canItem ? '#00ffcc' : '#333'}; color:${canItem ? '#00ffcc' : '#555'}; font-family:'Space Mono',monospace; font-size:0.6rem; letter-spacing:1px; cursor:${canItem ? 'pointer' : 'not-allowed'}; font-weight:bold;">
                    ${canItem ? '🔁 RESGATAR ITEM' : `⏳ FALTAM ${itemCost - frags} FRAGMENTOS`}
                </button>
            </div>

            <div style="background:#070712; border:1px solid ${canTicket ? '#ffaa00' : '#223'}; padding:16px;">
                <div style="color:#ffaa00; font-size:0.65rem; font-weight:bold; letter-spacing:1px; margin-bottom:6px;">FREE ROLL TICKET</div>
                <p style="font-size:0.55rem; color:#888899; margin-bottom:12px;">Um ticket de redirecionamento de drop. Use como se fosse um DROP GRATUITO garantido.</p>
                <div style="font-size:0.6rem; color:#aaa; margin-bottom:10px;">Custo: <b style="color:#ffaa00;">${ticketCost} 🧩 Fragmentos</b></div>
                <button onclick="redeemFragment('ticket')"
                    style="width:100%; padding:10px; background:${canTicket ? '#ffaa0022' : '#111'}; border:1px solid ${canTicket ? '#ffaa00' : '#333'}; color:${canTicket ? '#ffaa00' : '#555'}; font-family:'Space Mono',monospace; font-size:0.6rem; letter-spacing:1px; cursor:${canTicket ? 'pointer' : 'not-allowed'}; font-weight:bold;">
                    ${canTicket ? '🎟 RESGATAR TICKET' : `⏳ FALTAM ${ticketCost - frags} FRAGMENTOS`}
                </button>
            </div>

        </div>
    </div>`;
}

// ── Resgata fragmentos por item ou ticket ──
async function redeemFragment(type) {
    if (!currentUser || !currentUser.loggedIn) {
        showCyberAlert('ACESSO NEGADO', 'Faça login pra resgatar fragmentos.', 'error');
        return;
    }
    const frags = currentUser.fragments || 0;
    const TICKET_COST = typeof FRAGMENTS_TO_REDEEM_TICKET !== 'undefined' ? FRAGMENTS_TO_REDEEM_TICKET : 30;
    const ITEM_COST   = typeof FRAGMENTS_TO_REDEEM_ITEM   !== 'undefined' ? FRAGMENTS_TO_REDEEM_ITEM   : 15;

    if (type === 'ticket') {
        if (frags < TICKET_COST) {
            showCyberAlert('FRAGMENTOS INSUFICIENTES', `Você precisa de ${TICKET_COST} fragmentos. Atual: ${frags}.`, 'warn');
            return;
        }
        currentUser.fragments -= TICKET_COST;
        await updateProfileInSupabase(currentUser.id, { fragments: currentUser.fragments });
        // Concede 1 ticket grátis: simula um executeHardwareRoll(false) imediato
        showCyberAlert('🎟 TICKET RESGATADO!',
            `Free Roll Ticket concedido!<br>Fragmentos restantes: <b>${currentUser.fragments}</b><br><br>O roll será ativado automaticamente...`,
            'success');
        setTimeout(() => {
            if (typeof executeHardwareRoll === 'function') executeHardwareRoll(false);
        }, 1800);
    } else if (type === 'item') {
        if (frags < ITEM_COST) {
            showCyberAlert('FRAGMENTOS INSUFICIENTES', `Você precisa de ${ITEM_COST} fragmentos. Atual: ${frags}.`, 'warn');
            return;
        }
        currentUser.fragments -= ITEM_COST;
        await updateProfileInSupabase(currentUser.id, { fragments: currentUser.fragments });
        // Concede Poeira de Silício
        if (typeof grantInventoryItem === 'function') {
            await grantInventoryItem(currentUser.id, 'poeira_silicio', 2);
        }
        showCyberAlert('🧩 ITEM RESGATADO!',
            `2x Poeira de Silício adicionada ao inventário!<br>Fragmentos restantes: <b>${currentUser.fragments}</b>`,
            'success');
    }

    // Atualiza display de fragmentos na loja se visível
    const fragDisplay = document.getElementById('lojaFragsDisplay');
    if (fragDisplay) fragDisplay.innerText = String(currentUser.fragments);
    // Re-renderiza aba de fragmentos
    const fragTab = document.getElementById('lojaTabFragmentos');
    if (fragTab) fragTab.innerHTML = lojaFragmentosTabMarkup();
}

// ── FILTRO HORIZONTAL DE CATEGORIAS DA ABA COSMÉTICOS ──
// Alterna visibilidade das seções de categoria dentro de #lojaTabCosmeticos
// sem afetar as abas Contratos/Fragmentos nem o restante do markup da Loja.
function lojaFilterCategory(cat) {
    const map = {
        molduras: 'lojaCatMolduras',
        subnet: 'lojaCatSubnet',
        fundo: 'lojaCatFundo',
        adereco: 'lojaCatAdereco',
        estante: 'lojaCatEstante',
        emoticon: 'lojaCatEmoticon'
    };
    document.querySelectorAll('.loja-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.lojaCat === cat);
    });
    Object.entries(map).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = (cat === 'todos' || cat === key) ? '' : 'none';
    });
}

function lojaSwitchTab(tab) {
    try {
    const contratosPanel   = document.getElementById('lojaTabContratos');
    const cosmeticosPanel  = document.getElementById('lojaTabCosmeticos');
    const fragmentosPanel  = document.getElementById('lojaTabFragmentos');
    const btnContratos     = document.getElementById('lojaTabBtnContratos');
    const btnCosmeticos    = document.getElementById('lojaTabBtnCosmeticos');
    const btnFragmentos    = document.getElementById('lojaTabBtnFragmentos');
    if (!contratosPanel || !cosmeticosPanel) return;

    const activeBtnClasses   = ['bg-amber-500', 'text-black', 'border-amber-500'];
    const inactiveBtnClasses = ['bg-transparent', 'text-amber-800', 'border-transparent'];

    // Oculta tudo
    [contratosPanel, cosmeticosPanel, fragmentosPanel].forEach(p => p && p.classList.add('hidden'));
    [btnContratos, btnCosmeticos, btnFragmentos].forEach(b => {
        if (!b) return;
        b.classList.remove(...activeBtnClasses);
        b.classList.add(...inactiveBtnClasses);
        b.style.color = '';
    });

    if (tab === 'contratos') {
        contratosPanel.classList.remove('hidden');
        if (btnContratos) { btnContratos.classList.remove(...inactiveBtnClasses); btnContratos.classList.add(...activeBtnClasses); }
    } else if (tab === 'fragmentos') {
        if (fragmentosPanel) fragmentosPanel.classList.remove('hidden');
        if (btnFragmentos) {
            btnFragmentos.classList.remove(...inactiveBtnClasses);
            btnFragmentos.style.background = '#00ffcc22';
            btnFragmentos.style.color = '#00ffcc';
            btnFragmentos.style.borderColor = '#00ffcc';
        }
    } else {
        cosmeticosPanel.classList.remove('hidden');
        if (btnCosmeticos) { btnCosmeticos.classList.remove(...inactiveBtnClasses); btnCosmeticos.classList.add(...activeBtnClasses); }
    }
    } catch(e) { console.warn('lojaSwitchTab error:', e); }
}

// ── HANDLERS ESTRUTURADOS — INTEGRAÇÃO SUPABASE ──
async function lojaHandlePurchase(itemId) {
    const item = LOJA_ALL_ITEMS.find(i => i.id === itemId);
    if (!item) return;
    console.log('[LOJA] Tentativa de compra:', item.id, 'por', item.price, 'B$');

    if (!currentUser || !currentUser.loggedIn || !currentUser.id) {
        console.log('[LOJA] Compra recusada: usuário não autenticado.');
        if (typeof showCyberAlert === 'function') {
            showCyberAlert('ACESSO NEGADO', 'Você precisa estar conectado pra negociar com o ZRK.', 'error');
        }
        return;
    }

    if (!Array.isArray(currentUser.cosmetics)) currentUser.cosmetics = [];

    if (currentUser.cosmetics.includes(item.id)) {
        console.log('[LOJA] Compra recusada: item já está no inventário.');
        return;
    }

    const balance = currentUser.bumps || 0;
    if (balance < item.price) {
        console.log('[LOJA] Compra recusada: saldo insuficiente.');
        // TODO SUPABASE: chamar openDepositModal() ou showCyberAlert('FUNDOS INSUFICIENTES', ...)
        return;
    }

    // Débito + grant de cosmético: persistidos juntos numa única chamada,
    // pra nunca ficar um estado "pagou mas não recebeu o item" (ou
    // vice-versa) se a conexão cair no meio do caminho.
    const newBumps = balance - item.price;
    const newCosmetics = [...currentUser.cosmetics, item.id];

    console.log(`Supabase Update -> profiles set cosmetics = ${JSON.stringify(newCosmetics)}, bumps = ${newBumps} where id = ${currentUser.id}`);

    const { error } = await sb.from('profiles')
        .update({ cosmetics: newCosmetics, bumps: newBumps })
        .eq('id', currentUser.id);

    if (error) {
        console.error('[LOJA] Falha ao persistir compra no Supabase:', error.message);
        if (typeof showCyberAlert === 'function') {
            showCyberAlert('FALHA NA TRANSAÇÃO', 'O nó central recusou a gravação. Tenta novamente.', 'error');
        }
        return; // não atualiza estado local se o banco não confirmou
    }

    currentUser.bumps = newBumps;
    currentUser.cosmetics = newCosmetics;
    console.log('[LOJA] Compra confirmada:', item.id);
    renderLoja(); // re-renderiza pra atualizar saldo e estado "ATIVO"
    if (selectedProfileUser === currentUser.username) {
        renderEquipmentInventory(true); // sincroniza o bloco de equipamentos no Perfil, se estiver aberto
        renderRelicInventoryModal();    // sincroniza o modal de relíquias, se estiver aberto
        renderFrameSelectorRow(currentFrameFilter); // libera a moldura no seletor, se for o caso
    }
}

function lojaHandleAcceptContract(contractId) {
    console.log('[LOJA] Tentativa de aceitar contrato:', contractId);
    // TODO SUPABASE: validar card alocado, criar registro de empréstimo, travar card no cofre, ex:
    //   await createLoanContract({ userId: currentUser.id, contractId, cardId, expiresAt });
    console.log('[LOJA] Contrato ainda não habilitado nesta build (mock).');
}

// =========================================================
// PONTO 2 — MODAL [ INVENTÁRIO DE RELÍQUIAS ]
// Versão em modal do bloco de equipamentos: lista Acessórios de Vitrine,
// Cores de Fundo Neon e Cyber_Emoticons comprados, cada um com botão
// [ EQUIPAR / ATIVAR ] que persiste no Supabase e aplica o efeito na hora.
// =========================================================
function openRelicInventoryModal() {
    // Trava de usuário logado (camada extra além do display:none aplicado em
    // viewTargetUserCollection): nunca abre pra quem não é o dono do perfil.
    if (!currentUser.loggedIn || selectedProfileUser !== currentUser.username) return;
    const modal = document.getElementById('relicInventoryModal');
    if (!modal) return;
    ensureTailwindLoaded(() => {
        modal.style.display = 'flex';
        renderRelicInventoryModal();
    });
}

function closeRelicInventoryModal() {
    const modal = document.getElementById('relicInventoryModal');
    if (modal) modal.style.display = 'none';
}

function renderRelicInventoryModal() {
    // [ESCOPO 1] Slots visuais de hardware/artefatos cyberpunk — sem colchetes
    const grid = document.getElementById('relicInventoryGrid');
    if (!grid) return;

    const inv = getUserInventory();
    const equipped = currentUser.equippedCosmetics || {};
    const ownedCosmetics = Array.isArray(currentUser.cosmetics) ? currentUser.cosmetics : [];

    // Cosméticos comprados na loja (molduras, fundos, adereços, estantes, emoticons)
    const lojaItems = LOJA_ALL_ITEMS.filter(item => ownedCosmetics.includes(item.id));

    // Itens de inventário (catalisadores, núcleos, etc.)
    const invItems = inv.filter(i => i && i.templateId && ITEMS_DB[i.templateId]);

    grid.innerHTML = '';

    if (lojaItems.length === 0 && invItems.length === 0) {
        grid.innerHTML = `<div class="relic-slot relic-slot-empty">
            <div class="relic-slot-icon">◻</div>
            <div class="relic-slot-name">NENHUMA RELÍQUIA DETECTADA</div>
            <div class="relic-slot-desc">Visite o MERCADO NEGRO (Spike Store) para adquirir cosméticos de ostentação.</div>
        </div>`;
        return;
    }

    // Renderiza cosméticos da loja como slots de hardware cyberpunk
    lojaItems.forEach(item => {
        const slot = document.createElement('div');
        slot.className = 'relic-slot';
        const cat = item.category || '';
        const slotKey = cat === 'fundo' ? 'background' : cat === 'adereco' ? 'prop' : cat === 'estante' ? 'shelf' : cat === 'emoticon' ? 'emoticon' : null;
        const isEquipped = slotKey
            ? (equipped[slotKey] === item.id)
            : (currentUser.avatarFrame === item.id);

        const rarityLabel = item.rarity ? item.rarity.toUpperCase() : 'ITEM';
        const accentColor = item.accent || '#00ffff';

        slot.innerHTML = `
            <div class="relic-slot-header">
                <span class="relic-slot-type" style="color:${accentColor};">${rarityLabel} // ${cat.toUpperCase()}</span>
                ${isEquipped ? '<span class="relic-slot-equipped-badge">EQUIPADO</span>' : ''}
            </div>
            <div class="relic-slot-icon" style="color:${accentColor};">${item.rarity === 'ancestral' ? '☠' : item.rarity === 'lendario' ? '◈' : '⬡'}</div>
            <div class="relic-slot-name" style="color:${accentColor};">${item.name.toUpperCase()}</div>
            <div class="relic-slot-desc">${item.tagline || ''}</div>
            <div class="relic-slot-data-lines">
                <div class="relic-data-line"><span class="rdl-key">CATEGORIA</span><span class="rdl-val">${cat.toUpperCase()}</span></div>
                <div class="relic-data-line"><span class="rdl-key">SLOT</span><span class="rdl-val">${slotKey ? slotKey.toUpperCase() : 'MOLDURA'}</span></div>
                <div class="relic-data-line"><span class="rdl-key">STATUS</span><span class="rdl-val" style="color:${isEquipped ? '#00ff66' : '#888899'}">${isEquipped ? 'ATIVO' : 'INATIVO'}</span></div>
            </div>
            <button class="btn-action relic-equip-btn" style="border-color:${accentColor};color:${accentColor};margin-top:auto;"
                onclick="lojaEquipItem('${item.id}','${item.category}')">
                ${isEquipped ? '✓ DESATIVAR' : '▶ EQUIPAR'}
            </button>
        `;
        grid.appendChild(slot);
    });

    // Renderiza itens de inventário de fusão como slots secundários
    invItems.forEach(item => {
        const tpl = ITEMS_DB[item.templateId];
        if (!tpl) return;
        const slot = document.createElement('div');
        slot.className = 'relic-slot relic-slot-item';
        slot.innerHTML = `
            <div class="relic-slot-header">
                <span class="relic-slot-type" style="color:#ffaa00;">${tpl.category}</span>
                <span class="relic-slot-qty">x${item.qty || 1}</span>
            </div>
            <div class="relic-slot-icon">⚗</div>
            <div class="relic-slot-name">${tpl.name.toUpperCase()}</div>
            <div class="relic-slot-desc">${tpl.nameEN}</div>
            <div class="relic-slot-data-lines">
                <div class="relic-data-line"><span class="rdl-key">EFEITO</span><span class="rdl-val">${tpl.effect.type}</span></div>
                <div class="relic-data-line"><span class="rdl-key">USO</span><span class="rdl-val">FUSÃO / ALQUIMIA</span></div>
                <div class="relic-data-line"><span class="rdl-key">QTD</span><span class="rdl-val" style="color:#ffaa00;">${item.qty || 1}</span></div>
            </div>
        `;
        grid.appendChild(slot);
    });
}


function renderEquipmentInventory(isOwner) {
    const target = document.getElementById(EQUIPMENT_INVENTORY_TARGET_ID);
    if (!target) return;

    if (!isOwner || !currentUser.loggedIn) {
        target.innerHTML = '';
        target.style.display = 'none';
        return;
    }
    target.style.display = 'block';

    const owned = Array.isArray(currentUser.cosmetics) ? currentUser.cosmetics : [];
    const ownedItems = LOJA_ALL_ITEMS.filter(i => owned.includes(i.id));

    if (ownedItems.length === 0) {
        target.innerHTML = `
            <h4 class="equip-inv-title">[ INVENTÁRIO DE EQUIPAMENTOS ]</h4>
            <p class="equip-inv-empty">Nenhum cosmético comprado ainda. Visite o MERCADO_NEGRO_DO_ZRK na Loja.</p>
        `;
        return;
    }

    target.innerHTML = `
        <h4 class="equip-inv-title">[ INVENTÁRIO DE EQUIPAMENTOS ]</h4>
        <div class="equip-inv-list">
            ${ownedItems.map(equipmentInventoryItemMarkup).join('')}
        </div>
    `;
}

// Equipar uma moldura comprada na Loja (reaproveita setAvatarFrame, que já
// atualiza a UI do avatar e persiste em profiles.avatar_frame).
async function lojaEquipFrame(itemId) {
    if (!currentUser || !currentUser.loggedIn) return;
    if (itemId !== FRAME_DEFAULT_ID && (!Array.isArray(currentUser.cosmetics) || !currentUser.cosmetics.includes(itemId))) {
        console.log('[LOJA] Equipar recusado: moldura não pertence ao inventário do usuário.', itemId);
        return;
    }
    console.log('[LOJA] Equipando moldura:', itemId);
    await setAvatarFrame(itemId);
    renderEquipmentInventory(true);
    renderRelicInventoryModal();
    renderFrameSelectorRow(currentFrameFilter);
}

// =========================================================
// PONTO 3 — ATIVAÇÃO REAL DOS EFEITOS (FRONT-END), AGORA POR SLOT
// As três funções abaixo recebem o objeto `equippedCosmetics` do PERFIL
// QUE ESTÁ SENDO EXIBIDO (não necessariamente currentUser — ver
// viewTargetUserCollection) — isso é o que garante que o cosmético do
// usuário A nunca "vaze" pro perfil do usuário B: cada chamada usa
// estritamente os dados de quem está na tela.
// =========================================================

// Luz Neon de Fundo: injeta classes Tailwind reais de glow/gradiente em
// .profile-main-box (#profileMainBox) conforme LOJA_BACKGROUND_ITEMS.
function applyEquippedAccessoryEffect(equippedCosmetics) {
    const box = document.getElementById('profileMainBox');
    if (!box) return;
    const eq = equippedCosmetics || { background: null };

    ensureTailwindLoaded(() => {
        box.classList.remove(...NEON_BG_TAILWIND_ALL_CLASSES);

        const item = eq.background && LOJA_BACKGROUND_ITEMS.find(i => i.id === eq.background);
        if (!item || !item.colorKey) {
            box.dataset.neonActive = '';
            return;
        }
        const classes = NEON_BG_TAILWIND_CLASSES[item.colorKey];
        if (classes && classes.length) {
            box.classList.add(...classes);
            box.dataset.neonActive = item.colorKey;
        }
    });
}

// Adereços de Card: injeta o glifo (chapéu/peruca/óculos) num elemento
// absoluto sobreposto exatamente acima da PFP do avatar (#avatarFrameWrap).
function applyEquippedPropEffect(equippedCosmetics) {
    const wrap = document.getElementById('avatarFrameWrap');
    if (!wrap) return;

    let layer = document.getElementById('avatarPropLayer');
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'avatarPropLayer';
        layer.className = 'avatar-prop-layer';
        wrap.appendChild(layer);
    }

    const eq = equippedCosmetics || { prop: null };
    const item = eq.prop && LOJA_PROP_ITEMS.find(i => i.id === eq.prop);
    layer.innerHTML = item
        ? `<span class="avatar-prop-glyph" style="filter: drop-shadow(0 0 6px ${item.accent});" title="${item.name}">${item.glyph}</span>`
        : '';
}

// Estantes/Expositores: troca o container temático do grid de vitrine
// (#showcaseGrid), mudando a borda/fundo de cada slot individual de card.
function applyEquippedShelfEffect(equippedCosmetics) {
    const grid = document.getElementById('showcaseGrid');
    if (!grid) return;
    grid.classList.remove('shelf-mainframe', 'shelf-neon');

    const eq = equippedCosmetics || { shelf: null };
    if (eq.shelf === 'shelf-suporte-mainframe') grid.classList.add('shelf-mainframe');
    else if (eq.shelf === 'shelf-estante-neon') grid.classList.add('shelf-neon');
}

// Aplica os 3 efeitos de uma vez só — chamada central usada tanto ao abrir
// um perfil (próprio ou de terceiros) quanto após equipar/ativar algo no
// modal de relíquias.
function applyAllEquippedEffects(equippedCosmetics) {
    applyEquippedAccessoryEffect(equippedCosmetics);
    applyEquippedPropEffect(equippedCosmetics);
    applyEquippedShelfEffect(equippedCosmetics);
}

// Ativa/desativa um cosmético de slot único (fundo neon, adereço de card,
// estante ou pack de emoticons) comprado na Loja. Apenas um item por slot
// fica ativo por vez (clicar no que já está ativo desativa). O objeto
// inteiro é persistido junto em profiles.equipped_cosmetics (jsonb).
async function lojaToggleCosmeticSlot(itemId) {
    if (!currentUser || !currentUser.loggedIn) return;
    if (!Array.isArray(currentUser.cosmetics) || !currentUser.cosmetics.includes(itemId)) return;

    const item = LOJA_ALL_ITEMS.find(i => i.id === itemId);
    const slot = item && cosmeticSlotForCategory(item.category);
    if (!slot) return;

    if (!currentUser.equippedCosmetics) currentUser.equippedCosmetics = { background: null, prop: null, shelf: null, emoticon: null };
    const newEquipped = { ...currentUser.equippedCosmetics };
    newEquipped[slot] = newEquipped[slot] === itemId ? null : itemId;

    console.log('[LOJA] Ativando cosmético de slot:', slot, '->', newEquipped[slot] || '(nenhum)');

    const ok = await updateProfileInSupabase(currentUser.id, { equippedCosmetics: newEquipped });
    if (!ok) {
        console.error('[LOJA] Falha ao persistir cosmético ativo.');
        if (typeof showCyberAlert === 'function') {
            showCyberAlert('FALHA NA TRANSAÇÃO', 'O nó central recusou a gravação do equipamento. Tenta novamente.', 'error');
        }
        return;
    }
    currentUser.equippedCosmetics = newEquipped;
    renderEquipmentInventory(true);
    renderRelicInventoryModal();
    applyAllEquippedEffects(currentUser.equippedCosmetics); // aplica/retira o efeito na hora, sem precisar de F5
}

// ── PONTO 1 — Efeito Sonoro "Ding-Dong Cyberpunk" tocado quando a Loja é
// aberta (não em re-renderizações internas pós-compra). Usa dois osciladores
// em sequência via AudioContext (sem dependência de link de áudio externo,
// que poderia cair/quebrar CORS) simulando o clássico sino de loja antiga
// com um timbre mais robótico (onda quadrada + decaimento rápido).
function playLojaChime() {
    try {
        initAudio();
        const now = audioCtx.currentTime;

        // "Ding" — nota mais aguda primeiro
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'square';
        osc1.frequency.setValueAtTime(1046.5, now); // C6
        gain1.gain.setValueAtTime(0.0001, now);
        gain1.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc1.connect(gain1); gain1.connect(audioCtx.destination);
        osc1.start(now); osc1.stop(now + 0.35);

        // "Dong" — nota mais grave logo em seguida, robótica (sawtooth leve)
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(783.99, now + 0.16); // G5
        gain2.gain.setValueAtTime(0.0001, now + 0.16);
        gain2.gain.exponentialRampToValueAtTime(0.1, now + 0.18);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc2.connect(gain2); gain2.connect(audioCtx.destination);
        osc2.start(now + 0.16); osc2.stop(now + 0.55);
    } catch (e) { /* AudioContext bloqueado até primeira interação — silenciosamente ignora */ }
}

// ── VOZ SINTETIZADA DO ZRK (ET PUNK) ──
// Usa a mesma API nativa já utilizada em speakPhrase/speakRandom (Web
// Speech API — SpeechSynthesisUtterance). Pitch baixo + rate levemente
// acelerado pra soar mais "robótico-alienígena" e destacar do narrador
// padrão do sistema (CYBER_VOICES). Silenciosamente ignora se o
// navegador não suportar (mesmo padrão defensivo do resto do código).
function speakZrkLine(forcedText) {
    if (!('speechSynthesis' in window)) return;
    const text = forcedText || SPIKE_LINES_LOJA[Math.floor(Math.random() * SPIKE_LINES_LOJA.length)];

    // Sincroniza a fala com a frase já exibida na caixa de texto do ZRK,
    // pra não mostrar uma frase na tela e falar outra diferente.
    const lineBox = document.getElementById('lojaSpikeLine');
    if (lineBox && !forcedText) lineBox.innerHTML = `▸ ${text}`;

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR'; // Voz da Loja fixa em PT-BR, independente do toggle global de idioma.
    u.rate = 1.15;   // levemente acelerado — cadência "nervosa" de hacker
    u.pitch = 0.35;  // bem grave — timbre alienígena/distorcido
    u.volume = 0.85;
    window.speechSynthesis.speak(u);

    // Pequeno feedback visual: avatar do ZRK "pulsa" enquanto fala.
    const avatar = document.getElementById('lojaEtAvatar');
    if (avatar) {
        avatar.classList.add('zrk-speaking');
        u.onend = () => avatar.classList.remove('zrk-speaking');
        u.onerror = () => avatar.classList.remove('zrk-speaking');
    }
}

// ── PONTO DE ENTRADA ──
// playChime=true toca o ding-dong (só ao NAVEGAR pra Loja, ver navigateTo).
// Re-renders internos pós-compra/equip chamam renderLoja() sem argumento,
// então o som/fala nunca repetem a cada clique — só na entrada real na tela.
function renderLoja(playChime) {
    const target = document.getElementById(LOJA_TARGET_ID);
    if (!target) {
        console.warn(`[LOJA] Elemento #${LOJA_TARGET_ID} não encontrado no DOM. Ajuste LOJA_TARGET_ID para o id da sua div de tela.`);
        return;
    }
    ensureTailwindLoaded(() => {
        target.innerHTML = lojaBuildMarkup();
        // [ESCOPO 2] Sincroniza com o sistema de abas externo (lojaTabBar)
        const activeTabOnLoad = _currentLojaTab || 'all';
        if (activeTabOnLoad !== 'all') {
            _applyLojaTabFilter(activeTabOnLoad);
        } else {
            lojaSwitchTab('cosmeticos');
        }
        if (playChime) {
            playLojaChime();
            // Pequeno atraso pro "ding-dong" tocar primeiro e não se
            // sobrepor à fala do ZRK — soa como o sininho da porta de
            // uma loja física tocando antes do vendedor falar.
            setTimeout(() => speakZrkLine(), 650);
        }
    });
}

/* ════════════════════════════════════════════════════════════════════
   MÓDULO: BROADCAST AÉREO (OVNI) + CHAT GLOBAL FLUTUANTE
   ────────────────────────────────────────────────────────────────────
   Segue o MESMO padrão já usado em eventos_globais/pushLedger/
   initGlobalRealtime: tabela pública no Supabase + canal Realtime
   (postgres_changes) assinado incondicionalmente no boot, pra qualquer
   aba — logada ou anônima — ver os mesmos eventos instantaneamente.

   Custo em Bumps é debitado de forma ATÔMICA via RPC debit_bumps
   (ver schema.sql), que faz "bumps = bumps - custo WHERE bumps >= custo"
   em uma única instrução no Postgres — evita o saldo ficar negativo por
   corrida entre abas/cliques rápidos, ao contrário do padrão antigo de
   "currentUser.bumps -= x; updateProfileInSupabase(...)" usado em outras
   partes do app.
   ════════════════════════════════════════════════════════════════════ */

// ── DÉBITO ATÔMICO DE BUMPS ──
// Retorna o novo saldo em caso de sucesso, ou null se falhar (saldo
// insuficiente, não logado, erro de rede). Em caso de sucesso, já
// sincroniza currentUser.bumps e qualquer label de saldo visível na tela
// (perfil, loja), pra nunca dessincronizar do banco.
async function debitBumpsAtomic(valor) {
    if (!currentUser || !currentUser.loggedIn || !currentUser.id) {
        showCyberAlert('ACESSO NEGADO', 'Você precisa estar conectado pra usar esta função.', 'error');
        return null;
    }
    if ((currentUser.bumps || 0) < valor) {
        showCyberAlert('FUNDOS INSUFICIENTES', `Saldo atual: <b>${currentUser.bumps} B$</b><br>Custo: <b>${valor} B$</b><br><br>Carregue o saldo no teu perfil.`, 'warn');
        return null;
    }
    try {
        const { data, error } = await sb.rpc('debit_bumps', { p_user: currentUser.id, p_valor: valor });
        if (error) {
            console.error('debitBumpsAtomic:', error.message);
            showCyberAlert('FUNDOS INSUFICIENTES', 'Saldo atual insuficiente ou recusado pela rede. Tente novamente.', 'warn');
            return null;
        }
        currentUser.bumps = data;
        const profBumpsEl = document.getElementById('profBumps'); if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
        const lojaBalanceEl = document.getElementById('lojaBalanceDisplay'); if (lojaBalanceEl) lojaBalanceEl.innerText = `${currentUser.bumps.toLocaleString('pt-BR')} B$`;
        return data;
    } catch (e) {
        console.error('debitBumpsAtomic:', e);
        return null;
    }
}

/* ─────────────────────────────────────────────────────────────────────
   BROADCAST AÉREO — OVNI puxando faixa de texto pra rede inteira
   ───────────────────────────────────────────────────────────────────── */
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
    const { data, error } = await sb.from('chat_global')
        .select('*')
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
