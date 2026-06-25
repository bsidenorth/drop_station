// =========================================================
// dr0p_station — MÓDULO: auth.js
// AUTH — login, registro, logout (continuação dos blocos de sessão/perfil definidos em config.js)
//
// Parte 2 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
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
