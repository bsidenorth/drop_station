// =========================================================
// dr0p_station — MÓDULO: market-social-db.js
// SUPABASE — CRUD de mercado (listar/comprar) + sistema de seguidores (follow)
//
// Parte 12 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================

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
    // ANTI-EGRESS: mesma lista explícita de colunas usada em
    // loadCardsFromSupabase (rowToCard não muda entre as duas leituras).
    // Limite de 200 itens — o mercado P2P é uma vitrine pública pega por
    // QUALQUER visitante (logado ou não), então sem teto aqui o egress
    // escala com o número de visitas, não com o número de usuários reais.
    const { data, error } = await sb.from('cards')
        .select('id, display_id, rarity_type, rarity_name, rarity_name_en, style_name, style_name_en, creator, registered, exposed, for_sale, is_listed, price, img_src, tags, is_fused, fusion_count, elite_eligible, genetic_history, parent_ids, provenance_hash, provenance_timestamp, provenance_origin, is_tokenized, qr_code_hash, qr_payload_url, watermark_color, filter_style, resolutions, is_purged, purged_at, purged_reason, is_animated, animated_mime, created_at')
        .eq('for_sale', true)
        .eq('is_listed', true)
        .order('created_at', { ascending: false })
        .limit(200);
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

