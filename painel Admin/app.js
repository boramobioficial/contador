const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dt = d => new Date(d).toLocaleDateString('pt-BR', { timeZone: d.length === 10 ? 'UTC' : undefined });
const dthr = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const fmtCnpj = v => { v = String(v).replace(/\D/g, '').slice(0, 14);
  return v.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2'); };
const tam = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB';
const REGIMES = ['MEI', 'Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'Outros'];
const STATUS = ['Aberto', 'Em análise', 'Aguardando cliente', 'Concluído'];

let token = sessionStorage.getItem('tk_admin'), clientes = [];
async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { logout(); throw new Error('Sessão expirada'); }
  if (!r.ok) throw new Error(j.erro || 'Erro');
  return j;
}
function toast(msg, bad) { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 3200); }
function modal(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`; document.body.append(bg);
  bg.addEventListener('mousedown', e => { if (e.target === bg) bg.remove(); });
  bg.close = () => bg.remove(); onMount && onMount(bg); return bg;
}
const cliNome = id => { const c = clientes.find(x => x.id === id); return c ? esc(c.nomeFantasia || c.razaoSocial) : '—'; };
const opts = (arr, sel) => arr.map(a => `<option ${a === sel ? 'selected' : ''}>${a}</option>`).join('');
const cliOpts = sel => clientes.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.razaoSocial)} — ${fmtCnpj(c.cnpj)}</option>`).join('');
const head = (t, s, extra = '') => `<div class="top"><div><h2>${t}</h2><div class="mut">${s}</div></div>${extra}</div>`;
const confirmar = msg => confirm(msg);

// login
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  try { const r = await api('admin/login', 'POST', { usuario: $('#usr').value, senha: $('#pwd').value });
    token = r.token; sessionStorage.setItem('tk_admin', token); start(); } catch (err) { $('#login-err').textContent = err.message; }
});
function logout() { sessionStorage.removeItem('tk_admin'); token = null; $('#app-view').classList.add('hidden'); $('#login-view').classList.remove('hidden'); $('#pwd').value = ''; }
$('#sair').onclick = logout;
async function start() {
  $('#login-view').classList.add('hidden'); $('#app-view').classList.remove('hidden');
  clientes = await api('admin/clientes'); go('dashboard');
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.p); });
async function go(p) {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.p === p));
  $('#main').onclick = null; $('#main').innerHTML = '<p class="mut">Carregando…</p>';
  try { clientes = await api('admin/clientes'); await pages[p](); badge(); } catch (e) { $('#main').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function badge() {
  const d = await api('admin/dashboard'), b = $('#bd-ch');
  b.textContent = d.chamadosAbertos; b.classList.toggle('hidden', !d.chamadosAbertos);
}

const pages = {
  async dashboard() {
    const d = await api('admin/dashboard'), tot = d.clientes || 1;
    $('#main').innerHTML = head('Visão geral', 'Resumo do escritório em tempo real') + `<div class="grid">
      <div class="card stat"><div class="ic">🏢</div><div class="v">${d.clientes}</div><div class="l">Clientes ativos</div></div>
      <div class="card stat warn"><div class="ic">💰</div><div class="v">${brl(d.valorAberto)}</div><div class="l">A receber</div></div>
      <div class="card stat"><div class="ic">✅</div><div class="v">${brl(d.valorRecebido)}</div><div class="l">Recebido</div></div>
      <div class="card stat bad"><div class="ic">⏰</div><div class="v">${d.boletosVencidos}</div><div class="l">Boletos vencidos</div></div>
      <div class="card stat warn"><div class="ic">🎧</div><div class="v">${d.chamadosAbertos}</div><div class="l">Chamados novos</div></div></div>
      <div class="two"><div class="card"><div class="sec-t">Clientes por regime</div><div class="bars">${REGIMES.map(r => `<div class="bar"><span>${r}</span><span><i style="width:${(d.porRegime[r] || 0) / tot * 100}%"></i></span><b>${d.porRegime[r] || 0}</b></div>`).join('')}</div></div>
      <div class="card"><div class="sec-t">Chamados</div><div class="bars">${[['Abertos', d.chamadosAbertos], ['Em andamento', d.chamadosAndamento], ['Concluídos', d.chamadosConcluidos]].map(([l, v]) => `<div class="bar"><span>${l}</span><span></span><b>${v}</b></div>`).join('')}</div></div></div>`;
  },

  async clientes() {
    const draw = () => {
      const q = $('#q').value.toLowerCase(), r = $('#fr').value;
      const l = clientes.filter(c => (!r || c.regime === r) && (c.razaoSocial + c.nomeFantasia + c.cnpj).toLowerCase().includes(q.replace(/[./-]/g, '')));
      $('#lst').innerHTML = l.length ? `<table class="tbl"><thead><tr><th>Empresa</th><th>CNPJ</th><th>Regime</th><th>Honorário</th><th>Acesso</th><th></th></tr></thead><tbody>${l.map(c => `<tr>
        <td><b>${esc(c.razaoSocial)}</b><div class="mut" style="font-size:12px">${esc(c.responsavel)} ${c.email ? '• ' + esc(c.email) : ''}</div></td>
        <td>${fmtCnpj(c.cnpj)}</td><td><span class="pill ${c.regime}">${c.regime}</span></td><td>${brl(c.honorario)}</td>
        <td>${c.ativo ? (c.senhaProvisoria ? '<span class="pill pendente">Senha provisória</span>' : '<span class="pill pago">Ativo</span>') : '<span class="pill vencido">Bloqueado</span>'}</td>
        <td class="acts"><button class="btn ghost sm" data-e="${c.id}">Editar</button><button class="btn ghost sm" data-ac="${c.id}">Acesso</button><button class="btn ghost sm" data-r="${c.id}">Resetar senha</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty"><div class="e">🏢</div>Nenhum cliente.</div>';
    };
    $('#main').innerHTML = head('Clientes', `${clientes.length} empresas cadastradas`, '<button class="btn" id="add">＋ Novo cliente</button>') +
      `<div class="filters"><input id="q" placeholder="Buscar por nome ou CNPJ"><select id="fr"><option value="">Todos os regimes</option>${opts(REGIMES)}</select></div><div class="card scroll" id="lst"></div>`;
    $('#q').oninput = draw; $('#fr').onchange = draw; draw();
    $('#add').onclick = () => go('novo');
    $('#lst').onclick = async e => {
      const ac = e.target.closest('[data-ac]');
      if (ac) { const c = clientes.find(x => x.id === ac.dataset.ac); modal(`<div id="ac-b">${acessoHtml(c)}</div><div class="foot"><button class="btn ghost" id="ac-x">Fechar</button></div>`, m => { $('#ac-x', m).onclick = m.close; ligaAcesso($('#ac-b', m), c); }); return; }
      const ed = e.target.closest('[data-e]'), rs = e.target.closest('[data-r]');
      if (ed) clienteForm(clientes.find(c => c.id === ed.dataset.e));
      if (rs && confirmar('Redefinir a senha deste cliente para 123456?')) { await api(`admin/clientes/${rs.dataset.r}/resetsenha`, 'POST'); toast('Senha redefinida para 123456'); go('clientes'); }
    };
  },

  async boletos() {
    const bs = await api('admin/boletos');
    const draw = () => {
      const c = $('#fc').value, s = $('#fs').value, l = bs.filter(b => (!c || b.clienteId === c) && (!s || b.situacao === s));
      $('#lst').innerHTML = l.length ? `<table class="tbl"><thead><tr><th>Cliente</th><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>${l.map(b => `<tr>
        <td>${cliNome(b.clienteId)}</td><td>${esc(b.descricao)}<div class="mut" style="font-size:12px">${esc(b.competencia)}</div></td><td>${dt(b.vencimento)}</td><td><b>${brl(b.valor)}</b></td>
        <td><span class="pill ${b.situacao}">${{ pago: 'Pago', vencido: 'Vencido', pendente: 'A vencer' }[b.situacao]}</span></td>
        <td class="acts"><button class="btn ghost sm" data-ed="${b.id}">Editar</button>${b.situacao === 'pago' ? `<button class="btn ghost sm" data-u="${b.id}">Desfazer</button>` : `<button class="btn sm ok" data-p="${b.id}">Marcar pago</button>`}<button class="btn danger sm" data-d="${b.id}">Excluir</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty"><div class="e">💳</div>Nenhum boleto.</div>';
    };
    $('#main').innerHTML = head('Boletos', 'Cobranças e guias dos clientes', '<button class="btn" id="add">＋ Novo boleto</button>') +
      `<div class="filters"><select id="fc"><option value="">Todos os clientes</option>${cliOpts()}</select><select id="fs"><option value="">Todas situações</option><option value="pendente">A vencer</option><option value="vencido">Vencidos</option><option value="pago">Pagos</option></select></div><div class="card scroll" id="lst"></div>`;
    $('#fc').onchange = draw; $('#fs').onchange = draw; draw();
    $('#add').onclick = () => boletoForm();
    $('#lst').onclick = async e => {
      const t = e.target.closest('button'); if (!t) return;
      try {
        if (t.dataset.ed) return boletoForm(bs.find(x => x.id === t.dataset.ed));
        if (t.dataset.p) await api('admin/boletos/' + t.dataset.p, 'PUT', { status: 'pago' });
        else if (t.dataset.u) await api('admin/boletos/' + t.dataset.u, 'PUT', { status: 'pendente' });
        else if (t.dataset.d && confirmar('Excluir boleto?')) await api('admin/boletos/' + t.dataset.d, 'DELETE');
        else return; go('boletos');
      } catch (er) { toast(er.message, true); }
    };
  },

  async arquivos() {
    const as = await api('admin/arquivos');
    const draw = () => {
      const c = $('#fc').value, l = as.filter(a => !c || a.clienteId === c);
      $('#lst').innerHTML = l.length ? `<table class="tbl"><thead><tr><th>Cliente</th><th>Arquivo</th><th>Categoria</th><th>Origem</th><th>Data</th><th>Tamanho</th><th></th></tr></thead><tbody>${l.map(a => `<tr>
        <td>${cliNome(a.clienteId)}</td><td>📄 ${esc(a.nome)}</td><td>${esc(a.categoria)}</td><td>${a.origem === 'cliente' ? '<span class="pill Aberto">Cliente</span>' : 'Escritório'}</td><td>${dt(a.data)}</td><td>${tam(a.tamanho)}</td>
        <td class="acts"><button class="btn ghost sm" data-dl="${a.id}" data-n="${esc(a.nome)}">⬇</button><button class="btn danger sm" data-d="${a.id}">Excluir</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty"><div class="e">📁</div>Nenhum arquivo.</div>';
    };
    $('#main').innerHTML = head('Arquivos', 'Documentos enviados aos clientes', '<button class="btn" id="add">⬆ Enviar arquivo</button>') +
      `<div class="filters"><select id="fc"><option value="">Todos os clientes</option>${cliOpts()}</select></div><div class="card scroll" id="lst"></div>`;
    $('#fc').onchange = draw; draw(); $('#add').onclick = arquivoForm;
    $('#lst').onclick = async e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.d && confirmar('Excluir arquivo?')) { await api('admin/arquivos/' + t.dataset.d, 'DELETE'); go('arquivos'); }
      if (t.dataset.dl) {
        const r = await fetch(`/api/admin/arquivos/${t.dataset.dl}/download`, { headers: { Authorization: 'Bearer ' + token } });
        const u = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = u; a.download = t.dataset.n; a.click(); URL.revokeObjectURL(u);
      }
    };
  },

  async chamados() {
    const cs = await api('admin/chamados');
    const draw = () => {
      const s = $('#fs').value, c = $('#fc').value, l = cs.filter(x => (!s || x.status === s) && (!c || x.clienteId === c));
      $('#lst').innerHTML = l.length ? l.map(x => `<div class="card ticket" data-id="${x.id}"><div class="h"><div><b>${esc(x.assunto)}</b><div class="mut" style="font-size:13px">#${x.protocolo} • ${cliNome(x.clienteId)} • ${esc(x.categoria)} • ${dthr(x.criadoEm)}</div></div><span class="pill ${x.status}">${x.status}</span></div>
        ${x.observacao ? `<div class="obs">${esc(x.observacao)}</div>` : ''}</div>`).join('') : '<div class="card empty"><div class="e">🎧</div>Nenhum chamado.</div>';
    };
    $('#main').innerHTML = head('Chamados', 'Solicitações dos clientes') + `<div class="filters"><select id="fs"><option value="">Todos os status</option>${opts(STATUS)}</select><select id="fc"><option value="">Todos os clientes</option>${cliOpts()}</select></div><div id="lst"></div>`;
    $('#fs').onchange = draw; $('#fc').onchange = draw; draw();
    $('#lst').onclick = e => { const t = e.target.closest('.ticket'); if (t) chamadoForm(cs.find(x => x.id === t.dataset.id)); };
  },

  async novo() {
    $('#main').innerHTML = head('Cadastrar usuário', 'Cadastre a empresa e envie o acesso ao cliente') + `<div class="two" style="align-items:start"><div class="card">
      <label>CNPJ (será o login)</label><input id="n-cnpj" maxlength="18" inputmode="numeric" placeholder="00.000.000/0000-00">
      <label>Razão social</label><input id="n-rs"><label>Nome fantasia</label><input id="n-nf">
      <div class="row2"><div><label>Regime</label><select id="n-rg">${opts(REGIMES)}</select></div><div><label>Honorário mensal</label><input id="n-h" type="number" step="0.01"></div></div>
      <div class="row2"><div><label>Responsável</label><input id="n-resp"></div><div><label>Telefone / WhatsApp</label><input id="n-tel" inputmode="tel"></div></div>
      <label>E-mail</label><input id="n-em"><div class="err" id="n-err"></div>
      <button class="btn block" id="n-ok">Cadastrar e gerar acesso</button></div>
      <div id="n-res" class="card"><div class="empty"><div class="e">🔑</div>Após cadastrar, os dados de acesso para enviar ao cliente aparecem aqui.</div></div></div>`;
    $('#n-cnpj').oninput = e => e.target.value = fmtCnpj(e.target.value);
    $('#n-ok').onclick = async () => {
      try {
        const c = await api('admin/clientes', 'POST', { cnpj: $('#n-cnpj').value, razaoSocial: $('#n-rs').value, nomeFantasia: $('#n-nf').value, regime: $('#n-rg').value,
          honorario: $('#n-h').value, responsavel: $('#n-resp').value, telefone: $('#n-tel').value, email: $('#n-em').value });
        toast('Usuário cadastrado!'); $('#n-err').textContent = '';
        $('#n-res').innerHTML = acessoHtml(c);
        ligaAcesso($('#n-res'), c);
        document.querySelectorAll('.card input:not([type=file]),.card textarea').forEach(i => { if (i.id.startsWith('n-')) i.value = ''; });
      } catch (e) { $('#n-err').textContent = e.message; }
    };
  },

  async config() {
    $('#main').innerHTML = head('Configurações', 'Segurança do painel') + `<div class="card" style="max-width:420px"><h3>Alterar senha do admin</h3>
      <label>Senha atual</label><input id="a" type="password"><label>Nova senha</label><input id="n" type="password"><div class="err" id="err"></div><button class="btn block" id="ok">Salvar</button></div>`;
    $('#ok').onclick = async () => { try { await api('admin/senha', 'POST', { atual: $('#a').value, nova: $('#n').value }); toast('Senha alterada'); $('#a').value = $('#n').value = ''; } catch (e) { $('#err').textContent = e.message; } };
  }
};

const APP_URL = () => location.origin + '/';
function msgAcesso(c) {
  return `Olá, ${c.responsavel || c.razaoSocial}! Seu acesso ao Portal do Cliente da nossa contabilidade:\n\n🔗 Link: ${APP_URL()}\n👤 Login (CNPJ): ${fmtCnpj(c.cnpj)}\n🔑 Senha provisória: 123456\n\nNo primeiro acesso, recomendamos trocar a senha.`;
}
function acessoHtml(c) {
  const prov = c.senhaProvisoria !== false;
  const lin = (l, v) => `<div style="margin-top:12px"><div class="mut" style="font-size:12px">${l}</div><div class="copy" style="font-size:15px;color:var(--txt)">${esc(v)}</div></div>`;
  return `<h3>✅ Acesso de ${esc(c.nomeFantasia || c.razaoSocial)}</h3>${lin('Link do app', APP_URL())}${lin('Login (CNPJ)', fmtCnpj(c.cnpj))}${lin('Senha', prov ? '123456 (provisória)' : 'O cliente já alterou a senha. Use "Resetar senha" para voltar a 123456.')}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px"><button class="btn" data-a="copy">📋 Copiar mensagem</button>${prov ? `<button class="btn ghost" data-a="wa">💬 WhatsApp</button>` : ''}</div>
    ${prov ? `<pre class="copy" style="white-space:pre-wrap;margin-top:16px;padding:12px;background:#0a1324;border-radius:12px">${esc(msgAcesso(c))}</pre>` : ''}`;
}
function ligaAcesso(el, c) {
  el.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'copy') {
      try { await navigator.clipboard.writeText(msgAcesso(c)); } catch { const t = document.createElement('textarea'); t.value = msgAcesso(c); document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
      toast('Mensagem copiada!');
    } else {
      const tel = String(c.telefone || '').replace(/\D/g, '');
      window.open(`https://wa.me/${tel ? (tel.length <= 11 ? '55' + tel : tel) : ''}?text=${encodeURIComponent(msgAcesso(c))}`, '_blank');
    }
  };
}

function clienteForm(c) {
  const n = !c; c = c || { regime: 'MEI', ativo: true };
  modal(`<h3>${n ? 'Novo cliente' : 'Editar cliente'}</h3>${n ? '<p class="mut">A senha inicial será <b>123456</b> (login = CNPJ).</p>' : ''}
    <label>CNPJ</label><input id="f-cnpj" value="${fmtCnpj(c.cnpj || '')}" ${n ? '' : 'disabled'} maxlength="18">
    <label>Razão social</label><input id="f-rs" value="${esc(c.razaoSocial)}"><label>Nome fantasia</label><input id="f-nf" value="${esc(c.nomeFantasia)}">
    <div class="row2"><div><label>Regime</label><select id="f-rg">${opts(REGIMES, c.regime)}</select></div><div><label>Honorário mensal</label><input id="f-h" type="number" step="0.01" value="${c.honorario || ''}"></div></div>
    <div class="row2"><div><label>Responsável</label><input id="f-resp" value="${esc(c.responsavel)}"></div><div><label>Telefone</label><input id="f-tel" value="${esc(c.telefone)}"></div></div>
    <label>E-mail</label><input id="f-em" value="${esc(c.email)}">
    ${n ? '' : `<label>Acesso</label><select id="f-at"><option value="1" ${c.ativo ? 'selected' : ''}>Ativo</option><option value="0" ${c.ativo ? '' : 'selected'}>Bloqueado</option></select>`}
    <div class="err" id="f-err"></div><div class="foot">${n ? '' : '<button class="btn danger" id="f-del" style="margin-right:auto">Excluir</button>'}<button class="btn ghost" id="f-x">Cancelar</button><button class="btn" id="f-ok">Salvar</button></div>`, m => {
    $('#f-cnpj', m).oninput = e => e.target.value = fmtCnpj(e.target.value);
    $('#f-x', m).onclick = m.close;
    const del = $('#f-del', m);
    if (del) del.onclick = async () => { if (confirmar('Excluir cliente e TODOS os seus boletos, arquivos e chamados?')) { await api('admin/clientes/' + c.id, 'DELETE'); m.close(); go('clientes'); } };
    $('#f-ok', m).onclick = async () => {
      const b = { cnpj: $('#f-cnpj', m).value, razaoSocial: $('#f-rs', m).value, nomeFantasia: $('#f-nf', m).value, regime: $('#f-rg', m).value, honorario: $('#f-h', m).value, responsavel: $('#f-resp', m).value, telefone: $('#f-tel', m).value, email: $('#f-em', m).value };
      if (!n) b.ativo = $('#f-at', m).value === '1';
      try { await (n ? api('admin/clientes', 'POST', b) : api('admin/clientes/' + c.id, 'PUT', b)); m.close(); toast('Salvo!'); go('clientes'); } catch (e) { $('#f-err', m).textContent = e.message; }
    };
  });
}
function boletoForm(b) {
  if (!clientes.length) return toast('Cadastre um cliente primeiro', true);
  const n = !b || !b.id; b = b || {};
  modal(`<h3>${n ? 'Novo boleto' : 'Editar boleto'}</h3><label>Cliente</label><select id="b-c" ${n ? '' : 'disabled'}>${cliOpts(b.clienteId)}</select>
    <label>Descrição</label><input id="b-d" value="${esc(b.descricao)}" placeholder="Ex.: Honorários, DAS, DARF…">
    <div class="row2"><div><label>Competência</label><input id="b-comp" value="${esc(b.competencia)}" placeholder="10/2026"></div><div><label>Valor (R$)</label><input id="b-v" type="number" step="0.01" value="${b.valor || ''}"></div></div>
    <label>Vencimento</label><input id="b-venc" type="date" value="${esc(b.vencimento)}">
    <label>Código de barras / linha digitável (opcional)</label><input id="b-l" value="${esc(b.linhaDigitavel)}">
    <label>PIX copia e cola (opcional)</label><textarea id="b-pix" style="min-height:70px">${esc(b.pix)}</textarea>
    <label>Anexar boleto em PDF/imagem (opcional)${b.anexo ? ' — atual: ' + esc(b.anexo.nome) : ''}</label><input id="b-f" type="file" accept=".pdf,image/*">
    ${b.anexo ? '<label style="text-transform:none"><input type="checkbox" id="b-rm" style="width:auto"> Remover anexo atual</label>' : ''}
    <div class="err" id="b-err"></div><div class="foot"><button class="btn ghost" id="b-x">Cancelar</button><button class="btn" id="b-ok">${n ? 'Criar' : 'Salvar'}</button></div>`, m => {
    $('#b-x', m).onclick = m.close;
    $('#b-ok', m).onclick = async () => {
      const body = { clienteId: $('#b-c', m).value, descricao: $('#b-d', m).value, competencia: $('#b-comp', m).value, valor: $('#b-v', m).value, vencimento: $('#b-venc', m).value, linhaDigitavel: $('#b-l', m).value.trim(), pix: $('#b-pix', m).value.trim() };
      const f = $('#b-f', m).files[0];
      if (f) {
        if (f.size > 20e6) return $('#b-err', m).textContent = 'Arquivo acima de 20 MB';
        const base64 = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.readAsDataURL(f); });
        body.anexo = { nome: f.name, mime: f.type, base64 };
      }
      if ($('#b-rm', m) && $('#b-rm', m).checked) body.removerAnexo = true;
      try { await (n ? api('admin/boletos', 'POST', body) : api('admin/boletos/' + b.id, 'PUT', body));
        m.close(); toast('Boleto salvo'); go('boletos'); } catch (e) { $('#b-err', m).textContent = e.message; }
    };
  });
}
function arquivoForm() {
  if (!clientes.length) return toast('Cadastre um cliente primeiro', true);
  modal(`<h3>Enviar arquivo</h3><label>Cliente</label><select id="a-c">${cliOpts()}</select>
    <label>Categoria</label><select id="a-cat">${opts(['Guia de impostos', 'Declaração', 'Contrato', 'Folha de pagamento', 'Certidão', 'Balanço/Relatório', 'Outros'])}</select>
    <label>Arquivo (até 20 MB)</label><input id="a-f" type="file"><div class="err" id="a-err"></div>
    <div class="foot"><button class="btn ghost" id="a-x">Cancelar</button><button class="btn" id="a-ok">Enviar</button></div>`, m => {
    $('#a-x', m).onclick = m.close;
    $('#a-ok', m).onclick = async () => {
      const f = $('#a-f', m).files[0]; if (!f) return $('#a-err', m).textContent = 'Selecione um arquivo';
      if (f.size > 20e6) return $('#a-err', m).textContent = 'Arquivo acima de 20 MB';
      const base64 = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.readAsDataURL(f); });
      try { await api('admin/arquivos', 'POST', { clienteId: $('#a-c', m).value, categoria: $('#a-cat', m).value, nome: f.name, mime: f.type, base64 }); m.close(); toast('Arquivo enviado'); go('arquivos'); } catch (e) { $('#a-err', m).textContent = e.message; }
    };
  });
}
function chamadoForm(x) {
  modal(`<h3>${esc(x.assunto)}</h3><div class="mut">#${x.protocolo} • ${cliNome(x.clienteId)} • ${esc(x.categoria)}</div>
    <p style="margin:14px 0;white-space:pre-wrap">${esc(x.descricao)}</p>
    <label>Status</label><select id="t-s">${opts(STATUS, x.status)}</select>
    <label>Observação (visível ao cliente)</label><textarea id="t-o">${esc(x.observacao)}</textarea>
    <div class="timeline">${[...x.historico].reverse().map(h => `<div class="it"><small>${dthr(h.data)} • ${h.status}</small>${esc(h.texto)}</div>`).join('')}</div>
    <div class="foot"><button class="btn ghost" id="t-x">Fechar</button><button class="btn" id="t-ok">Salvar</button></div>`, m => {
    $('#t-x', m).onclick = m.close;
    $('#t-ok', m).onclick = async () => { try { await api('admin/chamados/' + x.id, 'PUT', { status: $('#t-s', m).value, observacao: $('#t-o', m).value }); m.close(); toast('Atualizado'); go('chamados'); } catch (e) { toast(e.message, true); } };
  });
}

if (token) start().catch(logout);

// rótulos das colunas para o layout em cartões no celular
new MutationObserver(() => document.querySelectorAll('table.tbl:not([data-l])').forEach(t => {
  const h = [...t.querySelectorAll('thead th')].map(x => x.textContent.trim());
  t.querySelectorAll('tbody tr').forEach(r => [...r.children].forEach((td, i) => td.dataset.label = h[i] || ''));
  t.dataset.l = 1;
})).observe(document.body, { childList: true, subtree: true });
