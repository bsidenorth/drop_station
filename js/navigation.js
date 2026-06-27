// =========================================================
// dr0p_station — MÓDULO: navigation.js
// NAVEGAÇÃO — navigateTo, render loop principal, utilidades de UI (faq, idade, idioma)
//
// Parte 5 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================

    // [FIX MINT BOX] resizeCanvases media a largura do target-box só uma
    // vez (150ms após load) e só re-media em window.resize de fato. Isso
    // deixava canvas.width (resolução interna) preso a um valor capturado
    // antes do layout mobile/CSS terminar de assentar (fonte clamp(),
    // reflow do header, etc.) — o canvas.width ficava menor que a largura
    // real do .target-box. Como o elemento <canvas> é width:100% em CSS,
    // ele continuava ocupando o espaço todo, mas o conteúdo desenhado
    // (fillRect/drawImage feitos em função de canvas.width/height) parava
    // de cobrir 100% da área visível — sobrava fundo escuro do .target-box
    // por trás, criando a listra preta, com o texto/imagem desenhados
    // fora de centro porque foram centralizados num canvas.width menor.
    //
    // Fix: usa clientWidth (não getBoundingClientRect, que distorce com
    // zoom de página) e ResizeObserver no próprio target-box, que detecta
    // QUALQUER mudança de tamanho real (CSS, layout, orientação, fonte
    // carregando) — não só window.resize. Evita também resoluções
    // fracionárias/desatualizadas no canvas.
    function resizeCanvases() {
        if (!canvas || !targetContainer) return;
        const size = Math.round(targetContainer.clientWidth) || 400;
        if (canvas.width !== size || canvas.height !== size) {
            canvas.width = size;
            canvas.height = size;
        }
    }
    window.addEventListener('resize', resizeCanvases);
    setTimeout(resizeCanvases, 150);
    // Re-mede sempre que o tamanho real do target-box mudar (cobre casos
    // que window.resize não dispara: fonte carregando, reflow tardio,
    // troca de tela, orientação em alguns navegadores).
    if (typeof ResizeObserver !== 'undefined' && targetContainer) {
        new ResizeObserver(() => resizeCanvases()).observe(targetContainer);
    }

    function toggleFaq(el) {
        const ans = el.nextElementSibling;
        ans.style.display = (ans.style.display === 'block') ? 'none' : 'block';
    }

    // =========================================================
    // [FIX ANTI-CRASH] safeNavigationRouter — navigateTo blindada com
    // try/catch estruturado em TODOS os pontos críticos. Impede o
    // crash intermitente que redirecionava o usuário para a Home.
    // =========================================================
    function navigateTo(screenId, skipProfileReload) {
        // [safeNavigationRouter] Guarda de tipo: screenId deve ser string
        try {
            if (!screenId || typeof screenId !== 'string') {
                console.error('[safeNavigationRouter] screenId inválido:', screenId);
                return;
            }
        } catch(routeGuardErr) {
            console.error('[safeNavigationRouter] Erro no guard de tipo:', routeGuardErr);
            return;
        }

        try { playSynthSound('click'); } catch(e) {}

        // Limpa estado anterior do drop ao sair do engine
        try {
            if (downloadBtn) downloadBtn.disabled = false;
        } catch(e) {}

        // Troca de tela SPA
        try {
            document.querySelectorAll('.spa-screen').forEach(s => s.classList.remove('active'));
            const t = document.getElementById('screen-' + screenId);
            if (t) {
                t.classList.add('active');
            } else {
                console.warn('[safeNavigationRouter] Tela não encontrada no DOM:', 'screen-' + screenId);
                // [anti-crash] NÃO redireciona para Home automaticamente — apenas loga o aviso
                return;
            }
        } catch(screenSwitchErr) {
            console.error('[safeNavigationRouter] Erro ao trocar tela:', screenSwitchErr);
            return; // aborta navegação sem redirecionar
        }

        // Inicialização específica por tela — cada bloco isolado
        try {
            if (screenId === 'engine') {
                setTimeout(resizeCanvases, 50);
                renderDailyDropButton();
                renderDailyMissions();
                renderDropStyleFilters();
            }
        } catch(e) { console.warn('[safeNavigationRouter] engine init:', e); }

        try { if (screenId === 'leaderboard') renderLeaderboard(); }
        catch(e) { console.warn('[safeNavigationRouter] leaderboard:', e); }

        try { if (screenId === 'vault') renderVaultGrid(); }
        catch(e) { console.warn('[safeNavigationRouter] vault:', e); }

        try {
            if (screenId === 'market') { renderMarketGrid(); renderMarketLedger(); }
            else { stopLedgerAutoScroll(); }
        } catch(e) { console.warn('[safeNavigationRouter] market:', e); }

        try {
            if (screenId === 'messages') { renderChatThreads(); renderGlobalOffers('offersContainer'); }
        } catch(e) { console.warn('[safeNavigationRouter] messages:', e); }

        // [safeNavigationRouter] Carregamento do perfil — protegido contra
        // redirecionamento fantasma causado por exceção em viewTargetUserCollection.
        try {
            if (screenId === 'profile' && !skipProfileReload) {
                if (!currentUser || !currentUser.loggedIn) {
                    // Usuário deslogado tentando acessar perfil — redireciona para auth
                    // de forma controlada (não como crash)
                    navigateTo('auth');
                    return;
                }
                viewTargetUserCollection(
                    currentUser.username,
                    currentUser.code,
                    currentUser.bio,
                    currentUser.avatar,
                    currentUser.banner,
                    true
                );
            }
        } catch(profileErr) {
            console.error('[safeNavigationRouter] Erro ao carregar perfil:', profileErr);
            // [anti-crash] NÃO redireciona para Home — mantém tela atual visível
        }

        try { if (screenId === 'contracts') renderContractsScreen(); }
        catch(e) { console.warn('[safeNavigationRouter] contracts:', e); }

        try { if (screenId === 'loja') renderLoja(true); }
        catch(e) { console.warn('[safeNavigationRouter] loja:', e); }
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
            // BUGFIX TELA DE REGISTRO: setar style.display = '' apenas remove o
            // override INLINE — sem override, o elemento volta a cair na regra
            // de classe ".register-only { display: none; }" do CSS (mesma
            // especificidade, declarada depois no arquivo, então ela ganha e
            // os campos continuam escondidos mesmo na aba "Registrar Nó").
            // Setando um valor explícito por tipo de elemento (inline sempre
            // vence a folha de estilos externa), o formulário de cadastro
            // volta a aparecer corretamente.
            registerOnlyEls.forEach(el => {
                el.style.display = el.classList.contains('auth-checkbox-row') ? 'flex' : 'block';
            });
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
        // PERF FIX (travadeira geral): antes este loop rodava a 60fps pra
        // sempre, em QUALQUER tela do app (perfil, loja, chat, etc.), mesmo
        // com o canvas do drop fora de tela. Agora só redesenha de fato
        // quando a tela #screen-engine (onde o canvas vive) está ativa.
        // Nas outras telas, vira um polling bem mais leve (a cada 500ms)
        // só pra saber quando o usuário volta — sem gastar CPU/GPU à toa.
        const engineScreen = document.getElementById('screen-engine');
        const isEngineActive = engineScreen && engineScreen.classList.contains('active');

        if (!isEngineActive) {
            setTimeout(masterRenderLoop, 500);
            return;
        }

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

