/* Minhas finanças: app estático conectado ao Supabase.
   Todo o acesso aos dados é protegido pelo RLS do banco (só o seu e-mail lê e escreve). */
(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById('app');

  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('SEU-PROJETO')) {
    app.innerHTML = '<div class="login"><div class="login-card"><h1>Falta configurar</h1>' +
      '<p>Preencha o arquivo config.js com a URL e a chave anon do seu projeto Supabase.</p></div></div>';
    return;
  }

  // A biblioteca acrescenta /rest/v1 e /auth/v1 sozinha: aceita a URL mesmo que venha com esses sufixos.
  const urlBase = String(cfg.SUPABASE_URL).trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '');
  const sb = window.supabase.createClient(urlBase, cfg.SUPABASE_ANON_KEY);

  const state = {
    user: null,
    contas: [],
    categorias: [],
    posicao: [],
    meses: [],
    filtros: { mes: null, conta: '', categoriaNome: '' },
    mostrarEncerrados: false
  };

  // ---------- Utilidades ----------
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmt = (v, moeda) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: moeda || 'BRL', minimumFractionDigits: 2
  }).format(Number(v) || 0);

  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mesNome = (iso) => MESES[Number(iso.slice(5, 7)) - 1] + '/' + iso.slice(2, 4);
  const mesLongo = (iso) => {
    const s = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const diaLongo = (iso) => {
    const s = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  // Datas sempre no fuso do aparelho (toISOString usaria UTC e, depois das 21h, marcaria o dia seguinte).
  const isoLocal = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const proximoMes = (iso) => {
    const d = new Date(iso + 'T12:00:00');
    d.setMonth(d.getMonth() + 1, 1);
    return isoLocal(d);
  };
  const hoje = () => isoLocal(new Date());

  const iniciais = (nome) => nome.replace(/[^\p{L}\p{N} ]/gu, '').split(' ')
    .filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  const CORES = ['#3A6EA5', '#2F8F6B', '#8A5A9E', '#B8663D', '#4F7C8A', '#9E4F5C', '#6B7F3A', '#5A5FA8'];
  const corDe = (nome) => {
    let h = 5381;
    for (const ch of nome) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    return CORES[h % CORES.length];
  };

  const conta = (id) => state.contas.find((c) => c.id === id);
  const categoria = (id) => state.categorias.find((c) => c.id === id);

  function toast(texto) {
    const el = document.getElementById('toast');
    el.textContent = texto;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw new Error(error.message);
    return data;
  }

  // ---------- Dados ----------
  async function carregarBase() {
    const [contas, categorias, posicao, fluxo] = await Promise.all([
      q(sb.from('contas').select('*').order('nome')),
      q(sb.from('categorias').select('*').order('nome')),
      q(sb.from('v_posicao_contas').select('*')),
      q(sb.from('v_fluxo_mensal').select('mes').order('mes', { ascending: false }))
    ]);
    state.contas = contas;
    state.categorias = categorias;
    state.posicao = posicao;
    state.meses = [...new Set(fluxo.map((f) => f.mes))];
    if (!state.filtros.mes) state.filtros.mes = state.meses[0] || hoje().slice(0, 8) + '01';
  }

  // ---------- Login ----------
  function renderLogin(msg) {
    app.innerHTML = `
      <div class="login"><div class="login-card">
        <h1>Minhas finanças</h1>
        <p>Entre com o seu e-mail. Você vai receber um link para acessar.</p>
        <form id="login-form">
          <label for="email">E-mail</label>
          <input id="email" type="email" required autocomplete="email">
          <button class="btn" type="submit">Enviar link de acesso</button>
        </form>
        <div class="msg" id="login-msg">${esc(msg || '')}</div>
      </div></div>`;
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const out = document.getElementById('login-msg');
      out.textContent = 'Enviando...';
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false }
      });
      out.textContent = error
        ? 'Não foi possível enviar o link: ' + error.message
        : 'Link enviado. Abra o e-mail neste mesmo aparelho e clique nele.';
    });
  }

  // ---------- Estrutura ----------
  const CANAIS = [
    { id: 'painel', nome: 'painel', topico: 'Patrimônio, saldos e o resultado dos últimos meses' },
    { id: 'transacoes', nome: 'transações', topico: 'Tudo o que entrou e saiu, dia a dia' },
    { id: 'cartoes', nome: 'cartões', topico: 'Fatura em aberto e compras de cada cartão' },
    { id: 'investimentos', nome: 'investimentos', topico: 'Quanto você aplicou, quanto rendeu e quanto vale hoje' }
  ];

  function rotaAtual() {
    const id = (location.hash.replace('#/', '') || 'painel').split('?')[0];
    return CANAIS.find((c) => c.id === id) || CANAIS[0];
  }

  function renderShell() {
    const canal = rotaAtual();
    const contasLado = state.posicao
      .filter((p) => p.ativo && ['corrente', 'carteira_digital', 'cartao_credito', 'poupanca'].includes(p.tipo))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    app.innerHTML = `
      <div class="shell" id="shell">
        <aside class="sidebar" aria-label="Navegação">
          <div class="workspace">
            <div class="ws-name">Minhas finanças</div>
            <div class="ws-sub">${esc(state.user.email)}</div>
          </div>
          <div class="side-scroll">
            <div class="side-group">
              <div class="side-title">Canais</div>
              ${CANAIS.map((c) => `
                <a class="side-item" href="#/${c.id}" ${c.id === canal.id ? 'aria-current="page"' : ''}>
                  <span class="hash">#</span><span class="grow">${esc(c.nome)}</span>
                </a>`).join('')}
            </div>
            <div class="side-group">
              <div class="side-title">Contas</div>
              ${contasLado.map((p) => {
                const cls = p.tipo === 'cartao_credito' ? (p.valor_atual < 0 ? 'debt' : '') : (p.valor_atual > 0 ? 'on' : '');
                return `
                <button class="side-item" data-conta="${esc(p.conta_id)}" type="button">
                  <span class="dot ${cls}"></span><span class="grow">${esc(p.nome)}</span>
                  <span class="val num">${esc(fmt(p.valor_atual, p.moeda))}</span>
                </button>`;
              }).join('')}
            </div>
          </div>
          <div class="side-foot"><button type="button" id="sair">Sair</button></div>
        </aside>
        <main class="main">
          <header class="channel-header">
            <button class="menu-btn" type="button" id="menu" aria-label="Abrir menu">☰</button>
            <div>
              <h1># ${esc(canal.nome)}</h1>
              <p class="topic">${esc(canal.topico)}</p>
            </div>
          </header>
          <section class="channel-body" id="body"><div class="empty">Carregando...</div></section>
          <footer class="composer">
            <button class="composer-box" type="button" id="novo">
              <span class="plus">+</span><span>Registrar um lançamento em #${esc(canal.nome)}</span>
            </button>
          </footer>
        </main>
      </div>`;

    document.getElementById('sair').onclick = () => sb.auth.signOut();
    document.getElementById('novo').onclick = () => abrirForm();
    document.getElementById('menu').onclick = () => document.getElementById('shell').classList.toggle('nav-open');
    app.querySelectorAll('[data-conta]').forEach((b) => b.addEventListener('click', () => {
      state.filtros.conta = b.dataset.conta;
      state.filtros.categoriaNome = '';
      location.hash = '#/transacoes';
      if (rotaAtual().id === 'transacoes') renderRota();
    }));
    app.querySelectorAll('.side-item[href]').forEach((a) => a.addEventListener('click', () => {
      document.getElementById('shell').classList.remove('nav-open');
    }));
    renderCanal(canal.id);
  }

  async function renderCanal(id) {
    const body = document.getElementById('body');
    try {
      if (id === 'painel') await renderPainel(body);
      else if (id === 'transacoes') await renderTransacoes(body);
      else if (id === 'cartoes') await renderCartoes(body);
      else await renderInvestimentos(body);
    } catch (err) {
      body.innerHTML = `<div class="empty">Não foi possível carregar os dados: ${esc(err.message)}. Recarregue a página; se continuar, saia e entre de novo.</div>`;
    }
  }

  function renderRota() { renderShell(); }

  // ---------- Gráficos do painel (barras empilhadas por categoria) ----------
  // Gastos: visão "compras" (data da compra, inclusive no cartão) ou "caixa" (o que saiu das contas;
  // o cartão entra como "Faturas de cartão" no mês em que a fatura foi paga).
  // Entradas: receitas por categoria, com opção de incluir as extraordinárias (Doação, Herança).
  // Só considera lançamentos em reais e ignora categorias internas (transferências, repasses, saldo inicial).
  const FATURAS = 'Faturas de cartão';
  const DEMAIS = 'Demais categorias';
  const CORES_GRAF = ['#2F6FED', '#1C9A6C', '#E0A63B', '#8A5AC2', '#D8594C', '#2BA3B8', '#C2569B', '#7A8F2E'];
  const COR_FATURAS = '#4A5866';
  const COR_DEMAIS = '#A7B0B9';
  const EXTRAORDINARIAS = ['Doação', 'Herança'];
  const MAX_SERIES = 7;

  const addMeses = (iso, n) => {
    const d = new Date(iso.slice(0, 7) + '-01T12:00:00');
    d.setMonth(d.getMonth() + n, 1);
    return isoLocal(d);
  };
  const compacto = (v) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: v < 1000 ? 0 : 1 }).format(v);
  // Cada categoria mantém a mesma cor em todos os gráficos e visões durante a sessão.
  const coresFixas = new Map();
  function corDaCategoria(nome) {
    if (nome === FATURAS) return COR_FATURAS;
    if (nome === DEMAIS) return COR_DEMAIS;
    if (!coresFixas.has(nome)) coresFixas.set(nome, CORES_GRAF[coresFixas.size % CORES_GRAF.length]);
    return coresFixas.get(nome);
  }

  const cacheTransacoes = new Map();
  async function transacoesDoPeriodo(de, ate) {
    const chave = de + '|' + ate;
    if (cacheTransacoes.has(chave)) return cacheTransacoes.get(chave);
    const tudo = [];
    const LOTE = 1000;   // o Supabase devolve no máximo 1.000 linhas por consulta
    for (let i = 0; ; i += LOTE) {
      const lote = await q(sb.from('transacoes')
        .select('conta_id, categoria_id, data_competencia, valor, tipo')
        .eq('moeda', 'BRL')
        .gte('data_competencia', de).lt('data_competencia', proximoMes(ate))
        .order('data_competencia', { ascending: true }).order('id', { ascending: true })
        .range(i, i + LOTE - 1));
      tudo.push(...lote);
      if (lote.length < LOTE) break;
    }
    cacheTransacoes.set(chave, tudo);
    return tudo;
  }

  // Categoria de nível mais alto (agrupa subcategorias no pai).
  function grupoDe(k) {
    let p = k;
    for (let i = 0; i < 5 && p && p.pai_id; i++) p = categoria(p.pai_id) || null;
    return (p || k).nome;
  }
  const ehExtra = (k) => k.extraordinaria === true || EXTRAORDINARIAS.includes(grupoDe(k)) || EXTRAORDINARIAS.includes(k.nome);

  function classificar(t, chave, g) {
    const c = conta(t.conta_id);
    const k = categoria(t.categoria_id);
    if (!c || !k) return null;
    const cartao = c.tipo === 'cartao_credito';
    if (chave === 'gastos') {
      if (g.visao === 'caixa' && cartao) {
        return t.tipo === 'entrada' && k.nome === CAT_TRANSF ? FATURAS : null;
      }
      return t.tipo === 'saida' && !k.interna ? grupoDe(k) : null;
    }
    if (t.tipo !== 'entrada' || k.interna) return null;
    if (!g.extra && ehExtra(k)) return null;
    return grupoDe(k);
  }

  function mesesDisponiveis() {
    const ms = state.meses.slice().sort();
    if (!ms.length) return [hoje().slice(0, 8) + '01'];
    const lista = [];
    for (let m = ms[0]; m <= ms[ms.length - 1]; m = addMeses(m, 1)) lista.push(m);
    return lista;
  }

  function estadoGrafico(chave) {
    state.graf = state.graf || {};
    if (!state.graf[chave]) {
      const todos = mesesDisponiveis();
      const ate = todos[todos.length - 1];
      state.graf[chave] = { ate, de: addMeses(ate, -11) < todos[0] ? todos[0] : addMeses(ate, -11),
        visao: 'compras', extra: false, ocultar: false, sel: null };
    }
    return state.graf[chave];
  }

  async function montarGrafico(el, chave) {
    if (!el || !el.isConnected) return;
    const g = estadoGrafico(chave);
    const todos = mesesDisponiveis();
    if (g.de > g.ate) [g.de, g.ate] = [g.ate, g.de];
    const titulo = chave === 'gastos' ? 'Gastos por mês' : 'Entradas por mês';

    const vez = (el._vez = (el._vez || 0) + 1);   // descarta respostas de cliques anteriores
    let lista;
    try {
      const card = el.querySelector('.chart-card');
      if (card) card.classList.add('loading');
      else el.innerHTML = `<div class="chart-card"><h2>${titulo}</h2><div class="empty">Carregando...</div></div>`;
      lista = await transacoesDoPeriodo(g.de, g.ate);
    } catch (err) {
      if (vez !== el._vez) return;
      el.innerHTML = `<div class="chart-card"><h2>${titulo}</h2><div class="empty">Não foi possível carregar: ${esc(err.message)}</div></div>`;
      return;
    }
    if (!el.isConnected || vez !== el._vez) return;

    // Meses do período e totais por mês e categoria
    const meses = [];
    for (let m = g.de; m <= g.ate; m = addMeses(m, 1)) meses.push(m);
    const porMes = new Map(meses.map((m) => [m, new Map()]));
    const totalCat = new Map();
    for (const t of lista) {
      const grupo = classificar(t, chave, g);
      if (!grupo) continue;
      const m = t.data_competencia.slice(0, 8) + '01';
      const mapa = porMes.get(m);
      if (!mapa) continue;
      const v = Number(t.valor) || 0;
      mapa.set(grupo, (mapa.get(grupo) || 0) + v);
      totalCat.set(grupo, (totalCat.get(grupo) || 0) + v);
    }

    // Séries: as maiores categorias do período; o resto vai para "Demais categorias".
    const ordenadas = [...totalCat.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    let principais = ordenadas.filter((n) => n !== FATURAS).slice(0, MAX_SERIES);
    if (totalCat.has(FATURAS)) principais = [FATURAS, ...principais.slice(0, MAX_SERIES - 1)];
    const temDemais = ordenadas.some((n) => !principais.includes(n));
    const series = [...principais, ...(temDemais ? [DEMAIS] : [])];
    // Cores: evita repetir cor dentro do mesmo gráfico quando há mais categorias do que cores.
    const cor = new Map();
    const usadas = new Set();
    for (const n of series) {
      let c = corDaCategoria(n);
      if (usadas.has(c)) c = CORES_GRAF.find((x) => !usadas.has(x)) || c;
      usadas.add(c); cor.set(n, c);
    }

    const dados = meses.map((m) => {
      const valores = new Map(series.map((n) => [n, 0]));
      for (const [n, v] of porMes.get(m)) {
        const alvo = principais.includes(n) ? n : DEMAIS;
        valores.set(alvo, valores.get(alvo) + v);
      }
      const total = [...valores.values()].reduce((s, v) => s + v, 0);
      return { mes: m, valores, total };
    });
    const totalPeriodo = dados.reduce((s, d) => s + d.total, 0);
    const media = meses.length ? totalPeriodo / meses.length : 0;
    const maxTotal = Math.max(1, ...dados.map((d) => d.total));
    if (!g.sel || !meses.includes(g.sel)) g.sel = meses[meses.length - 1];
    const selecionado = dados.find((d) => d.mes === g.sel);

    const ALTURA = 190;   // px da área das barras
    const mostrar = !g.ocultar;
    const colunas = dados.map((d) => {
      const hTotal = (d.total / maxTotal) * ALTURA;
      const segs = series.filter((n) => d.valores.get(n) > 0).map((n) => {
        const v = d.valores.get(n);
        const h = d.total ? (v / d.total) * hTotal : 0;
        return `<div class="seg-bar" style="height:${h.toFixed(1)}px;background:${cor.get(n)}" title="${esc(n)}: ${esc(fmt(v))}">
          ${mostrar && h >= 16 ? `<span>${esc(compacto(v))}</span>` : ''}</div>`;
      }).join('');
      return `
        <button type="button" class="col ${d.mes === g.sel ? 'sel' : ''}" data-mes="${d.mes}"
          aria-label="${esc(mesLongo(d.mes))}: ${esc(fmt(d.total))}" aria-pressed="${d.mes === g.sel}">
          <div class="col-area">
            ${mostrar && d.total > 0 ? `<div class="col-total num">${esc(compacto(d.total))}</div>` : ''}
            <div class="stack">${segs}</div>
          </div>
          <div class="col-label">${esc(mesNome(d.mes))}</div>
        </button>`;
    }).join('');

    const detalhe = selecionado && selecionado.total > 0
      ? series.filter((n) => selecionado.valores.get(n) > 0)
        .sort((a, b) => selecionado.valores.get(b) - selecionado.valores.get(a))
        .map((n) => {
          const v = selecionado.valores.get(n);
          return `<div class="row"><span class="dot" style="background:${cor.get(n)}"></span>
            <div class="grow">${esc(n)}</div>
            <div class="muted num">${Math.round((v / selecionado.total) * 100)}%</div>
            <div class="num" style="min-width:110px;text-align:right">${esc(fmt(v))}</div></div>`;
        }).join('')
      : '<div class="row muted">Nada registrado neste mês.</div>';

    const opcoesMes = (sel) => todos.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${esc(mesNome(m))}</option>`).join('');
    const presets = [[6, '6m'], [12, '12m'], [24, '24m'], [0, 'Tudo']];
    const presetAtivo = (n) => (n === 0
      ? g.de === todos[0] && g.ate === todos[todos.length - 1]
      : g.ate === todos[todos.length - 1] && g.de === addMeses(g.ate, -(n - 1)));

    const alternador = chave === 'gastos'
      ? `<div class="seg seg-sm" role="radiogroup" aria-label="Visão">
          <label><input type="radio" name="visao-${chave}" value="compras" ${g.visao === 'compras' ? 'checked' : ''}><span>Compras</span></label>
          <label><input type="radio" name="visao-${chave}" value="caixa" ${g.visao === 'caixa' ? 'checked' : ''}><span>Caixa</span></label>
        </div>`
      : `<label class="check"><input type="checkbox" data-extra ${g.extra ? 'checked' : ''}> Incluir extraordinárias</label>`;

    const explicacao = chave === 'gastos'
      ? (g.visao === 'compras'
        ? 'Pela data da compra, inclusive as feitas no cartão.'
        : 'Pelo que saiu das contas: o cartão aparece como fatura, no mês em que foi paga.')
      : (g.extra ? 'Todas as receitas, inclusive doações e herança.' : 'Receitas do dia a dia, sem doações e herança.');

    el.innerHTML = `
      <div class="chart-card">
        <div class="chart-head">
          <div>
            <h2>${titulo}</h2>
            <div class="meta muted">${esc(explicacao)}${mostrar ? ` Média no período: <span class="num">${esc(fmt(media))}</span>.` : ''}</div>
          </div>
          <button type="button" class="icon-btn" data-ocultar aria-pressed="${g.ocultar}"
            title="${g.ocultar ? 'Mostrar' : 'Ocultar'} valores no gráfico" aria-label="${g.ocultar ? 'Mostrar' : 'Ocultar'} valores no gráfico">
            ${g.ocultar
              ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.1 6.9C4.1 8.3 2.6 10.3 2 12c1 2.5 5 7 10 7 1.7 0 3.3-.5 4.7-1.3M9.9 10a3 3 0 0 0 4.1 4.1"/></svg>'
              : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'}
          </button>
        </div>
        <div class="chart-controls">
          ${alternador}
          <div class="periodo">
            ${presets.map(([n, r]) => `<button type="button" class="chip-btn ${presetAtivo(n) ? 'on' : ''}" data-preset="${n}">${r}</button>`).join('')}
            <span class="intervalo">
              <select data-de aria-label="Mês inicial">${opcoesMes(g.de)}</select>
              <span class="muted">até</span>
              <select data-ate aria-label="Mês final">${opcoesMes(g.ate)}</select>
            </span>
          </div>
        </div>
        <div class="chart-scroll"><div class="chart" style="--n:${meses.length};grid-template-columns:repeat(${meses.length}, minmax(44px, 1fr))">${colunas}</div></div>
        <div class="chart-legend">
          ${series.map((n) => `<span><i style="background:${cor.get(n)}"></i>${esc(n)}</span>`).join('') || '<span class="muted">Nada registrado no período.</span>'}
        </div>
        <div class="chart-detail">
          <h3>${esc(mesLongo(g.sel))} <span class="num">${esc(fmt(selecionado ? selecionado.total : 0))}</span></h3>
          <div class="rows">${detalhe}</div>
        </div>
      </div>`;

    const scroll = el.querySelector('.chart-scroll');
    const colSel = el.querySelector('.col.sel');
    if (colSel) scroll.scrollLeft = Math.max(0, colSel.offsetLeft - scroll.clientWidth + colSel.offsetWidth + 16);

    const redesenhar = () => montarGrafico(el, chave);
    el.querySelector('[data-ocultar]').onclick = () => { g.ocultar = !g.ocultar; redesenhar(); };
    el.querySelectorAll('.col').forEach((b) => b.addEventListener('click', () => { g.sel = b.dataset.mes; redesenhar(); }));
    el.querySelectorAll(`input[name="visao-${chave}"]`).forEach((r) => r.addEventListener('change', (e) => { g.visao = e.target.value; redesenhar(); }));
    const extra = el.querySelector('[data-extra]');
    if (extra) extra.onchange = (e) => { g.extra = e.target.checked; redesenhar(); };
    el.querySelector('[data-de]').onchange = (e) => { g.de = e.target.value; redesenhar(); };
    el.querySelector('[data-ate]').onchange = (e) => { g.ate = e.target.value; redesenhar(); };
    el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const n = Number(b.dataset.preset);
      g.ate = todos[todos.length - 1];
      g.de = n === 0 ? todos[0] : (addMeses(g.ate, -(n - 1)) < todos[0] ? todos[0] : addMeses(g.ate, -(n - 1)));
      redesenhar();
    }));
  }

  // ---------- # painel ----------
  async function renderPainel(body) {
    const ativos = state.posicao.filter((p) => p.ativo);
    const total = (moeda) => ativos.filter((p) => p.moeda === moeda).reduce((s, p) => s + Number(p.valor_atual), 0);
    const fluxo = await q(sb.from('v_fluxo_mensal').select('*').eq('moeda', 'BRL').order('mes', { ascending: false }).limit(6));
    const ult = fluxo[0];
    const cats = ult ? await q(sb.from('v_categorias_mensal').select('*')
      .eq('moeda', 'BRL').eq('tipo', 'saida').eq('mes', ult.mes).order('total', { ascending: false }).limit(6)) : [];

    const maxBar = Math.max(1, ...fluxo.map((f) => Math.max(Number(f.receitas_recorrentes) || 0, Number(f.gastos) || 0)));
    const porTipo = (tipos) => ativos.filter((p) => tipos.includes(p.tipo) && Number(p.valor_atual) !== 0);

    body.innerHTML = `
      <div class="block chart-block" id="g-gastos"></div>
      <div class="block chart-block" id="g-entradas"></div>

      <div class="intro">
        <div class="big num">${esc(fmt(total('BRL'), 'BRL'))}</div>
        <div class="sub">de patrimônio, mais <span class="num">${esc(fmt(total('USD'), 'USD'))}</span> em dólar</div>
      </div>

      <div class="block">
        <h2>Receitas e gastos dos últimos meses</h2>
        <div class="legend"><span class="l-in">Receitas do dia a dia</span><span class="l-out">Gastos</span></div>
        <div class="rows">
          ${fluxo.length ? fluxo.slice().reverse().map((f) => {
            const rec = Number(f.receitas_recorrentes) || 0;
            const gas = Number(f.gastos) || 0;
            const extra = Number(f.receitas_extraordinarias) || 0;
            const res = rec - gas;
            return `
            <div class="flow-row">
              <div>${esc(mesNome(f.mes))}</div>
              <div class="bars" title="Receitas ${esc(fmt(rec))}, gastos ${esc(fmt(gas))}">
                <div class="bar in" style="width:${(rec / maxBar) * 100}%"></div>
                <div class="bar out" style="width:${(gas / maxBar) * 100}%"></div>
              </div>
              <div class="num ${res >= 0 ? 'pos' : 'neg'}" style="text-align:right">
                ${esc(fmt(res))}${extra ? `<div class="muted" style="font-size:12px">+ ${esc(fmt(extra))} extra</div>` : ''}
              </div>
            </div>`;
          }).join('') : '<div class="row">Nenhum lançamento ainda.</div>'}
        </div>
      </div>

      ${ult ? `
      <div class="block">
        <h2>Onde o dinheiro foi em ${esc(mesLongo(ult.mes).toLowerCase())}</h2>
        <div class="rows">
          ${cats.map((c) => `
            <div class="row"><div class="grow"><div class="title">${esc(c.categoria)}</div>
            <div class="meta">${c.qtd} lançamento${c.qtd > 1 ? 's' : ''}</div></div>
            <div class="num">${esc(fmt(c.total))}</div></div>`).join('') || '<div class="row">Sem gastos neste mês.</div>'}
        </div>
      </div>` : ''}

      <div class="block">
        <h2>Contas</h2>
        <div class="rows">
          ${porTipo(['corrente', 'carteira_digital', 'poupanca', 'cartao_credito']).map(linhaConta).join('') || '<div class="row">Nenhuma conta com saldo.</div>'}
        </div>
      </div>
      <div class="block">
        <h2>Investimentos e bens</h2>
        <div class="rows">
          ${porTipo(['investimento', 'outro']).sort((a, b) => b.valor_atual - a.valor_atual).map(linhaConta).join('')}
        </div>
      </div>`;
    montarGrafico(document.getElementById('g-gastos'), 'gastos');
    montarGrafico(document.getElementById('g-entradas'), 'entradas');
  }

  function linhaConta(p) {
    return `<div class="row">
      <div class="avatar" style="background:${corDe(p.nome)}">${esc(iniciais(p.nome))}</div>
      <div class="grow"><div class="title">${esc(p.nome)}</div><div class="meta">${esc(tipoNome(p.tipo))}</div></div>
      <div class="num ${Number(p.valor_atual) < 0 ? 'neg' : ''}">${esc(fmt(p.valor_atual, p.moeda))}</div>
    </div>`;
  }
  function tipoNome(t) {
    return ({ corrente: 'Conta corrente', carteira_digital: 'Carteira digital', poupanca: 'Poupança',
      investimento: 'Investimento', cartao_credito: 'Cartão de crédito', outro: 'Bem' })[t] || t;
  }

  // ---------- # transações ----------
  async function renderTransacoes(body) {
    const f = state.filtros;
    let consulta = sb.from('transacoes')
      .select('id, conta_id, categoria_id, data_competencia, valor, moeda, descricao, tipo, transferencia_par_id')
      .gte('data_competencia', f.mes).lt('data_competencia', proximoMes(f.mes))
      .order('data_competencia', { ascending: true }).order('criado_em', { ascending: true })
      .limit(1000);
    if (f.conta) consulta = consulta.eq('conta_id', f.conta);
    if (f.categoriaNome) {
      const ids = state.categorias.filter((c) => c.nome === f.categoriaNome).map((c) => c.id);
      consulta = consulta.in('categoria_id', ids);
    }
    const lista = await q(consulta);

    const nomesCat = [...new Map(state.categorias.map((c) => [c.nome, c])).values()]
      .sort((a, b) => a.nome.localeCompare(b.nome));
    const meses = state.meses.includes(f.mes) ? state.meses : [f.mes, ...state.meses];

    let html = `
      <div class="filters">
        <select id="f-mes" aria-label="Mês">${meses.map((m) => `<option value="${m}" ${m === f.mes ? 'selected' : ''}>${esc(mesLongo(m))}</option>`).join('')}</select>
        <select id="f-conta" aria-label="Conta"><option value="">Todas as contas</option>
          ${state.contas.filter((c) => c.ativo || c.id === f.conta).map((c) => `<option value="${c.id}" ${c.id === f.conta ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
        <select id="f-cat" aria-label="Categoria"><option value="">Todas as categorias</option>
          ${nomesCat.map((c) => `<option value="${esc(c.nome)}" ${f.categoriaNome === c.nome ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
      </div>`;

    if (!lista.length) {
      html += '<div class="empty">Nenhum lançamento neste filtro. Use o campo abaixo para registrar um.</div>';
    } else {
      let diaAtual = '';
      for (const t of lista) {
        if (t.data_competencia !== diaAtual) {
          diaAtual = t.data_competencia;
          html += `<div class="day"><span>${esc(diaLongo(diaAtual))}</span></div>`;
        }
        const c = conta(t.conta_id) || { nome: '?' };
        const k = categoria(t.categoria_id) || { nome: '?' };
        const sinal = t.tipo === 'entrada' ? '+' : '−';
        const cls = k.interna ? 'muted' : (t.tipo === 'entrada' ? 'pos' : '');
        html += `
          <button class="msg" type="button" data-id="${t.id}">
            <div class="avatar" style="background:${corDe(c.nome)}">${esc(iniciais(c.nome))}</div>
            <div class="body">
              <div class="head"><span class="who">${esc(c.nome)}</span><span class="chip">${esc(k.nome)}</span></div>
              <div class="text">${esc(t.descricao || 'Sem descrição')}</div>
            </div>
            <div class="amount num ${cls}">${sinal} ${esc(fmt(t.valor, t.moeda))}</div>
          </button>`;
      }
    }
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;   // como numa conversa: o mais recente fica embaixo, perto do campo de registro

    document.getElementById('f-mes').onchange = (e) => { f.mes = e.target.value; renderCanal('transacoes'); };
    document.getElementById('f-conta').onchange = (e) => { f.conta = e.target.value; renderCanal('transacoes'); };
    document.getElementById('f-cat').onchange = (e) => {
      f.categoriaNome = e.target.value;
      renderCanal('transacoes');
    };
    body.querySelectorAll('.msg').forEach((b) => b.addEventListener('click', () => {
      abrirForm(lista.find((t) => t.id === b.dataset.id));
    }));
  }

  // ---------- # cartões ----------
  async function renderCartoes(body) {
    const cartoes = state.posicao.filter((p) => p.tipo === 'cartao_credito' && p.ativo);
    if (!cartoes.length) { body.innerHTML = '<div class="empty">Nenhum cartão cadastrado.</div>'; return; }
    const ids = cartoes.map((c) => c.conta_id);
    const compras = await q(sb.from('transacoes')
      .select('conta_id, data_competencia, valor, moeda, descricao, categoria_id, tipo')
      .in('conta_id', ids).eq('tipo', 'saida')
      .order('data_competencia', { ascending: false }).limit(300));

    body.innerHTML = cartoes.map((p) => {
      const lista = compras.filter((t) => t.conta_id === p.conta_id);
      const mes = lista[0] ? lista[0].data_competencia.slice(0, 8) + '01' : null;
      const doMes = mes ? lista.filter((t) => t.data_competencia >= mes) : [];
      const totalMes = doMes.reduce((s, t) => s + Number(t.valor), 0);
      const aberta = Math.max(0, -Number(p.valor_atual));
      return `
        <div class="block">
          <div class="intro">
            <div class="big num">${esc(fmt(aberta, p.moeda))}</div>
            <div class="sub">em aberto no ${esc(p.nome)}${mes ? `, com ${esc(fmt(totalMes, p.moeda))} em compras em ${esc(mesLongo(mes).toLowerCase())}` : ''}</div>
          </div>
          <h2>Últimas compras</h2>
          <div class="rows">
            ${lista.slice(0, 15).map((t) => `
              <div class="row"><div class="grow">
                <div class="title">${esc(t.descricao || 'Sem descrição')}</div>
                <div class="meta">${esc(new Date(t.data_competencia + 'T12:00:00').toLocaleDateString('pt-BR'))}, ${esc((categoria(t.categoria_id) || {}).nome || '')}</div>
              </div><div class="num">${esc(fmt(t.valor, t.moeda))}</div></div>`).join('') || '<div class="row">Nenhuma compra registrada.</div>'}
          </div>
        </div>`;
    }).join('');
  }

  // ---------- # investimentos ----------
  async function renderInvestimentos(body) {
    const inv = state.posicao.filter((p) => p.tipo === 'investimento' || (p.tipo === 'carteira_digital' && p.moeda === 'USD'));
    const abertos = inv.filter((p) => p.ativo && Math.abs(Number(p.valor_atual)) > 0.005);
    const encerrados = inv.filter((p) => !abertos.includes(p));
    const soma = (moeda, campo) => abertos.filter((p) => p.moeda === moeda).reduce((s, p) => s + Number(p[campo]), 0);

    const linha = (p, fechado) => `
      <tr class="${fechado ? 'closed' : ''}">
        <td>${esc(p.nome)}</td>
        <td class="num">${fechado ? '—' : esc(fmt(p.saldo_transacoes, p.moeda))}</td>
        <td class="num ${Number(p.rendimentos_acumulados) < 0 ? 'neg' : 'pos'}">${esc(fmt(p.rendimentos_acumulados, p.moeda))}</td>
        <td class="num">${esc(fmt(p.valor_atual, p.moeda))}</td>
        <td>${p.ultima_referencia ? esc(new Date(p.ultima_referencia + 'T12:00:00').toLocaleDateString('pt-BR')) : '—'}</td>
      </tr>`;

    body.innerHTML = `
      <div class="intro">
        <div class="big num">${esc(fmt(soma('BRL', 'valor_atual'), 'BRL'))}</div>
        <div class="sub">investidos em reais, com <span class="num">${esc(fmt(soma('BRL', 'rendimentos_acumulados'), 'BRL'))}</span> de rendimento acumulado.
        Em dólar: <span class="num">${esc(fmt(soma('USD', 'valor_atual'), 'USD'))}</span>.</div>
      </div>
      <div class="block" style="max-width:none">
        <div class="table-wrap"><table>
          <thead><tr><th>Investimento</th><th>Aplicado líquido</th><th>Rendimento</th><th>Valor atual</th><th>Atualizado em</th></tr></thead>
          <tbody>
            ${abertos.sort((a, b) => b.valor_atual - a.valor_atual).map((p) => linha(p, false)).join('')}
            ${state.mostrarEncerrados ? encerrados.map((p) => linha(p, true)).join('') : ''}
          </tbody>
        </table></div>
        <p><button class="link" type="button" id="toggle-enc">
          ${state.mostrarEncerrados ? 'Esconder' : 'Mostrar'} investimentos encerrados (${encerrados.length})
        </button></p>
      </div>`;
    document.getElementById('toggle-enc').onclick = () => {
      state.mostrarEncerrados = !state.mostrarEncerrados;
      renderCanal('investimentos');
    };
  }

  // ---------- Formulário de lançamento ----------
  // Transferências: os dois lados ficam ligados por transferencia_par_id (cada um aponta para o outro),
  // e editar ou apagar age sempre no par inteiro.
  const CAT_TRANSF = 'Transferencia entre contas';
  const catTransf = (tipoCat) => (state.categorias.find((c) => c.nome === CAT_TRANSF && c.tipo === tipoCat)
    || state.categorias.find((c) => c.nome === CAT_TRANSF) || {}).id;

  async function abrirForm(t) {
    const editando = !!t;

    // Se for um lado de transferência ligada, busca o outro lado.
    let par = null;
    if (t && t.transferencia_par_id) {
      try {
        const outro = await q(sb.from('transacoes')
          .select('id, conta_id, categoria_id, data_competencia, valor, moeda, descricao, tipo, transferencia_par_id')
          .eq('id', t.transferencia_par_id).maybeSingle());
        if (outro) par = t.tipo === 'saida' ? { saida: t, entrada: outro } : { saida: outro, entrada: t };
      } catch (err) {
        toast('Não foi possível carregar o outro lado da transferência');
        return;
      }
    }
    const editandoTransf = !!par;
    const transfSolta = editando && !par && (categoria(t.categoria_id) || {}).nome === CAT_TRANSF;

    const ativas = state.contas.filter((c) => c.ativo
      || (t && c.id === t.conta_id)
      || (par && (c.id === par.saida.conta_id || c.id === par.entrada.conta_id)));
    const opcoesConta = (sel) => ativas.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)} (${esc(c.moeda)})</option>`).join('');
    const tipoInicial = editandoTransf ? 'transf' : (t ? t.tipo : 'saida');
    const fmtCampo = (v) => (v == null ? '' : String(v).replace('.', ','));

    // Descrição automática não é reaproveitada na edição: é refeita com os nomes das contas escolhidas.
    let descInicial = t ? (t.descricao || '') : '';
    if (editandoTransf) {
      const nomeDestino = (conta(par.entrada.conta_id) || {}).nome;
      descInicial = par.saida.descricao === 'Transferência para ' + nomeDestino ? '' : (par.saida.descricao || '');
    }

    const radios = editandoTransf
      ? '<label><input type="radio" name="tipo" value="transf" checked><span>Transferência</span></label>'
      : `<label><input type="radio" name="tipo" value="saida" ${tipoInicial === 'saida' ? 'checked' : ''}><span>Gasto</span></label>
         <label><input type="radio" name="tipo" value="entrada" ${tipoInicial === 'entrada' ? 'checked' : ''}><span>Receita</span></label>
         ${editando ? '' : '<label><input type="radio" name="tipo" value="transf"><span>Transferência</span></label>'}`;

    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-titulo">
        <header><h2 id="m-titulo">${editandoTransf ? 'Editar transferência' : (editando ? 'Editar lançamento' : 'Novo lançamento')}</h2>
          <button class="close" type="button" aria-label="Fechar">×</button></header>
        <form novalidate>
          <div class="seg" role="radiogroup" aria-label="Tipo">${radios}</div>
          ${transfSolta ? '<p class="muted" style="margin:0;font-size:13px">Este lançamento é um lado de uma transferência antiga, sem ligação com o outro lado. Alterar ou apagar mexe só nele.</p>' : ''}
          <div class="two">
            <div class="field"><label for="m-valor">Valor</label><input id="m-valor" inputmode="decimal" placeholder="0,00" value="${esc(fmtCampo(editandoTransf ? par.saida.valor : (t && t.valor)))}"></div>
            <div class="field"><label for="m-data">Data</label><input id="m-data" type="date" value="${esc(editandoTransf ? par.saida.data_competencia : (t ? t.data_competencia : hoje()))}"></div>
          </div>
          <div class="field" id="w-conta"><label for="m-conta">Conta</label><select id="m-conta">${opcoesConta(t && !editandoTransf ? t.conta_id : '')}</select></div>
          <div class="field" id="w-cat"><label for="m-cat">Categoria</label><select id="m-cat"></select></div>
          <div class="two" id="w-transf" hidden>
            <div class="field"><label for="m-origem">Sai de</label><select id="m-origem">${opcoesConta(editandoTransf ? par.saida.conta_id : '')}</select></div>
            <div class="field"><label for="m-destino">Entra em</label><select id="m-destino">${opcoesConta(editandoTransf ? par.entrada.conta_id : '')}</select></div>
          </div>
          <div class="field" id="w-valor2" hidden><label for="m-valor2">Valor recebido (moeda do destino)</label><input id="m-valor2" inputmode="decimal" placeholder="0,00" value="${esc(editandoTransf ? fmtCampo(par.entrada.valor) : '')}"></div>
          <div class="field"><label for="m-desc">Descrição</label><input id="m-desc" maxlength="200" value="${esc(descInicial)}"></div>
          <div class="form-error" id="m-erro"></div>
          <div class="actions">
            ${editando ? '<button class="btn danger" type="button" id="m-apagar">Apagar</button><span class="spacer"></span>' : ''}
            <button class="btn ghost" type="button" id="m-cancelar">Cancelar</button>
            <button class="btn" type="submit" id="m-salvar">${editando ? 'Salvar alterações' : 'Registrar'}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(back);

    const $ = (sel) => back.querySelector(sel);
    const fechar = () => back.remove();
    $('.close').onclick = fechar;
    $('#m-cancelar').onclick = fechar;
    back.addEventListener('click', (e) => { if (e.target === back) fechar(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });

    const tipo = () => back.querySelector('input[name="tipo"]:checked').value;

    function atualizarCampos() {
      const tp = tipo();
      const transf = tp === 'transf';
      $('#w-conta').hidden = transf;
      $('#w-cat').hidden = transf;
      $('#w-transf').hidden = !transf;
      if (!transf) {
        const cats = state.categorias.filter((c) => c.tipo === tp).sort((a, b) => a.nome.localeCompare(b.nome));
        const sel = t && t.tipo === tp ? t.categoria_id : '';
        $('#m-cat').innerHTML = cats.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
      }
      const o = conta($('#m-origem').value);
      const d = conta($('#m-destino').value);
      $('#w-valor2').hidden = !(transf && o && d && o.moeda !== d.moeda);
    }
    back.querySelectorAll('input[name="tipo"]').forEach((r) => r.addEventListener('change', atualizarCampos));
    if (!editandoTransf && ativas.length > 1) $('#m-destino').selectedIndex = 1;
    $('#m-origem').onchange = atualizarCampos;
    $('#m-destino').onchange = atualizarCampos;
    atualizarCampos();
    setTimeout(() => $('#m-valor').focus(), 30);

    // Aceita "1.234,56", "1234,56", "35.98" e "1.234". Com vírgula, o ponto é milhar;
    // sem vírgula, o ponto é decimal, exceto no formato de milhar (1.234 ou 12.345.678).
    const lerValor = (s) => {
      let txt = String(s).trim().replace(/\s|R\$/g, '');
      if (!txt) return NaN;
      if (txt.includes(',')) txt = txt.replace(/\./g, '').replace(',', '.');
      else if (/^\d{1,3}(\.\d{3})+$/.test(txt)) txt = txt.replace(/\./g, '');
      if (!/^\d+(\.\d+)?$/.test(txt)) return NaN;
      const v = Number(txt);
      return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
    };

    $('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const erro = $('#m-erro');
      erro.textContent = '';
      const valor = lerValor($('#m-valor').value);
      const data = $('#m-data').value;
      const descricao = $('#m-desc').value.trim() || null;
      if (!(valor > 0)) { erro.textContent = 'Informe um valor maior que zero (ex.: 35,98).'; return; }
      if (!data) { erro.textContent = 'Informe a data.'; return; }

      const btn = $('#m-salvar');
      btn.disabled = true;
      try {
        const tp = tipo();
        if (tp === 'transf') {
          const o = conta($('#m-origem').value);
          const d = conta($('#m-destino').value);
          if (!o || !d || o.id === d.id) throw new Error('Escolha duas contas diferentes.');
          let valorDestino = valor;
          if (o.moeda !== d.moeda) {
            valorDestino = lerValor($('#m-valor2').value);
            if (!(valorDestino > 0)) throw new Error('Informe o valor recebido na moeda do destino.');
          }
          if (!catTransf('saida')) throw new Error('A categoria "' + CAT_TRANSF + '" não foi encontrada.');

          const idSaida = editandoTransf ? par.saida.id : crypto.randomUUID();
          const idEntrada = editandoTransf ? par.entrada.id : crypto.randomUUID();
          const linhas = [
            { id: idSaida, transferencia_par_id: idEntrada, conta_id: o.id, categoria_id: catTransf('saida'),
              data_competencia: data, valor, moeda: o.moeda, tipo: 'saida',
              descricao: descricao || 'Transferência para ' + d.nome },
            { id: idEntrada, transferencia_par_id: idSaida, conta_id: d.id, categoria_id: catTransf('entrada'),
              data_competencia: data, valor: valorDestino, moeda: d.moeda, tipo: 'entrada',
              descricao: descricao || 'Transferência de ' + o.nome }
          ];
          // Uma única chamada grava os dois lados juntos: ou os dois entram, ou nenhum.
          if (editandoTransf) {
            await q(sb.from('transacoes').upsert(linhas, { onConflict: 'id' }));
            toast('Transferência atualizada');
          } else {
            await q(sb.from('transacoes').insert(linhas));
            toast('Transferência registrada');
          }
        } else {
          const c = conta($('#m-conta').value);
          const catId = $('#m-cat').value;
          if (!c) throw new Error('Escolha a conta.');
          if (!catId) throw new Error('Escolha a categoria.');
          const registro = { conta_id: c.id, categoria_id: catId, data_competencia: data, valor, moeda: c.moeda, tipo: tp, descricao };
          if (editando) {
            await q(sb.from('transacoes').update(registro).eq('id', t.id));
            toast('Alterações salvas');
          } else {
            await q(sb.from('transacoes').insert(registro));
            toast('Lançamento registrado');
          }
        }
        fechar();
        await recarregar();
      } catch (err) {
        erro.textContent = err.message;
        btn.disabled = false;
      }
    });

    if (editando) {
      $('#m-apagar').onclick = async () => {
        const texto = editandoTransf
          ? 'Apagar esta transferência? Os dois lados (saída e entrada) serão apagados. Não dá para desfazer.'
          : 'Apagar este lançamento? Não dá para desfazer.';
        if (!confirm(texto)) return;
        try {
          const ids = editandoTransf ? [par.saida.id, par.entrada.id] : [t.id];
          await q(sb.from('transacoes').delete().in('id', ids));
          toast(editandoTransf ? 'Transferência apagada' : 'Lançamento apagado');
          fechar();
          await recarregar();
        } catch (err) { $('#m-erro').textContent = err.message; }
      };
    }
  }

  async function recarregar() {
    cacheTransacoes.clear();
    await carregarBase();
    renderShell();
  }

  // ---------- Início ----------
  window.addEventListener('hashchange', () => { if (state.user) renderShell(); });

  // Erro devolvido pelo link do e-mail (ex.: link expirado ou já usado)
  const erroLink = (() => {
    const h = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
    const qs = new URLSearchParams(location.search);
    const msg = h.get('error_description') || qs.get('error_description');
    return msg ? 'O link não funcionou: ' + msg.replace(/\+/g, ' ') + '. Peça um novo link.' : '';
  })();

  async function entrar(user) {
    state.user = user;
    app.innerHTML = '<div class="login"><div class="login-card"><p>Carregando suas finanças...</p></div></div>';
    try {
      await carregarBase();
      if (location.hash.includes('access_token') || location.hash.includes('error')) {
        history.replaceState(null, '', location.pathname + '#/painel');
      }
      renderShell();
    } catch (err) {
      renderLogin('Você entrou, mas os dados não carregaram: ' + err.message +
        '. Confira se este e-mail é o mesmo do script de segurança.');
    }
  }

  // As consultas ficam fora do callback de autenticação para não travar a sessão.
  sb.auth.onAuthStateChange((_evento, session) => {
    const user = session ? session.user : null;
    setTimeout(() => {
      if (user && (!state.user || state.user.id !== user.id)) entrar(user);
      else if (!user) { state.user = null; renderLogin(erroLink); }
    }, 0);
  });
})();
