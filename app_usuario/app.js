const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dt = d => new Date(d).toLocaleDateString('pt-BR', { timeZone: d.length === 10 ? 'UTC' : undefined });
const dthr = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const fmtCnpj = v => { v = v.replace(/\D/g, '').slice(0, 14);
  return v.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2'); };
const tam = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB';

let token = sessionStorage.getItem('tk'), cliente = null, page = 'inicio';

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

// ---- login ----
$('#cnpj').addEventListener('input', e => e.target.value = fmtCnpj(e.target.value));
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault(); $('#login-err').textContent = '';
  try {
    const r = await api('login', 'POST', { cnpj: $('#cnpj').value, senha: $('#senha').value });
    token = r.token; sessionStorage.setItem('tk', token); cliente = r.cliente;
    await start(); if (r.trocarSenha) senhaModal(true);
  } catch (err) { $('#login-err').textContent = err.message; }
});
function logout() { sessionStorage.removeItem('tk'); token = null; $('#app-view').classList.add('hidden'); $('#login-view').classList.remove('hidden'); $('#senha').value = ''; }
$('#sair').onclick = logout;

async function start() {
  if (!cliente) cliente = await api('cliente/perfil');
  $('#login-view').classList.add('hidden'); $('#app-view').classList.remove('hidden');
  $('#who-nome').textContent = cliente.nomeFantasia || cliente.razaoSocial; $('#who-cnpj').textContent = fmtCnpj(cliente.cnpj);
  go('inicio');
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.p); });
async function go(p) {
  page = p; document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.p === p));
  $('#main').innerHTML = '<p class="mut">Carregando…</p>';
  try { await pages[p](); } catch (e) { $('#main').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
const head = (t, s, extra = '') => `<div class="top"><div><h2>${t}</h2><div class="mut">${s}</div></div>${extra}</div>`;

const pages = {
  async inicio() {
    const [r, bs] = await Promise.all([api('cliente/resumo'), api('cliente/boletos')]);
    const prox = bs.filter(b => b.situacao !== 'pago').slice(0, 4);
    $('#main').innerHTML = head(`Olá, ${esc((cliente.responsavel || cliente.razaoSocial).split(' ')[0])} 👋`, esc(cliente.razaoSocial)) +
      (r.vencidos ? `<div class="alert">⚠️ Você tem ${r.vencidos} boleto(s) vencido(s). Regularize para evitar multas.</div>` : '') + `
      <div class="grid">
        <div class="card stat"><div class="ic">💳</div><div class="v">${r.aVencer}</div><div class="l">Boletos a vencer</div></div>
        <div class="card stat bad"><div class="ic">⏰</div><div class="v">${r.vencidos}</div><div class="l">Vencidos</div></div>
        <div class="card stat warn"><div class="ic">💰</div><div class="v">${brl(r.totalAberto)}</div><div class="l">Total em aberto</div></div>
        <div class="card stat"><div class="ic">📁</div><div class="v">${r.arquivos}</div><div class="l">Documentos</div></div>
        <div class="card stat"><div class="ic">🎧</div><div class="v">${r.chamadosAbertos}</div><div class="l">Chamados em andamento</div></div>
      </div>
      <div class="sec-t">Próximos vencimentos <button class="btn ghost sm" onclick="go('boletos')">Ver todos</button></div>
      <div class="card scroll">${prox.length ? boletosTbl(prox) : '<div class="empty"><div class="e">🎉</div>Nenhum boleto em aberto!</div>'}</div>`;
  },
  async boletos() {
    const bs = await api('cliente/boletos');
    $('#main').innerHTML = head('Boletos', 'Honorários, guias e taxas') +
      `<div class="card scroll">${bs.length ? boletosTbl(bs) : '<div class="empty"><div class="e">💳</div>Sem boletos por aqui.</div>'}</div>`;
  },
  async arquivos() {
    const as = await api('cliente/arquivos');
    const cats = [...new Set(as.map(a => a.categoria))];
    $('#main').innerHTML = head('Arquivos', 'Documentos trocados com o escritório', '<button class="btn" id="up">⬆ Enviar arquivo</button>') +
      `<div class="filters"><select id="fcat"><option value="">Todas as categorias</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="card scroll" id="alist"></div>`;
    const draw = () => {
      const f = $('#fcat').value, l = as.filter(a => !f || a.categoria === f);
      $('#alist').innerHTML = l.length ? `<table class="tbl"><thead><tr><th>Arquivo</th><th>Categoria</th><th>Origem</th><th>Data</th><th>Tamanho</th><th></th></tr></thead><tbody>${l.map(a =>
        `<tr><td>📄 ${esc(a.nome)}</td><td>${esc(a.categoria)}</td><td>${a.origem === 'cliente' ? 'Enviado por você' : 'Escritório'}</td><td>${dt(a.data)}</td><td>${tam(a.tamanho)}</td><td class="acts"><button class="btn sm" data-dl="${a.id}" data-n="${esc(a.nome)}">⬇ Baixar</button>${a.origem === 'cliente' ? `<button class="btn danger sm" data-del="${a.id}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><div class="e">📁</div>Nenhum arquivo.</div>';
    };
    $('#fcat').onchange = draw; draw();
    $('#up').onclick = uploadModal;
    $('#alist').onclick = async e => {
      const x = e.target.closest('[data-del]');
      if (x && confirm('Excluir este arquivo?')) { try { await api('cliente/arquivos/' + x.dataset.del, 'DELETE'); go('arquivos'); } catch (er) { toast(er.message, true); } return; }
      const b = e.target.closest('[data-dl]'); if (!b) return;
      const r = await fetch(`/api/cliente/arquivos/${b.dataset.dl}/download`, { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) return toast('Falha ao baixar', true);
      const u = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = u; a.download = b.dataset.n; a.click(); URL.revokeObjectURL(u);
    };
  },
  async chamados() {
    const cs = await api('cliente/chamados');
    $('#main').innerHTML = head('Chamados', 'Abra solicitações e acompanhe o andamento', '<button class="btn" id="novo">＋ Novo chamado</button>') +
      (cs.length ? cs.map(c => `<div class="card ticket" data-id="${c.id}"><div class="h"><div><b>${esc(c.assunto)}</b><div class="mut" style="font-size:13px">#${c.protocolo} • ${esc(c.categoria)} • ${dthr(c.criadoEm)}</div></div><span class="pill ${c.status}">${c.status}</span></div>
        ${c.observacao ? `<div class="obs"><b>Observação do escritório:</b><br>${esc(c.observacao)}</div>` : ''}</div>`).join('')
        : '<div class="card empty"><div class="e">🎧</div>Nenhum chamado aberto. Precisa de algo? Clique em “Novo chamado”.</div>');
    $('#novo').onclick = novoChamado;
    $('#main').onclick = e => { const t = e.target.closest('.ticket'); if (t) detalhe(cs.find(c => c.id === t.dataset.id)); };
  },
  async perfil() {
    const c = cliente = await api('cliente/perfil');
    const row = (l, v) => `<div><div class="mut" style="font-size:12px">${l}</div><div>${esc(v) || '—'}</div></div>`;
    $('#main').innerHTML = head('Meu perfil', 'Dados cadastrais da empresa') + `<div class="card"><div class="grid" style="margin:0">
      ${row('Razão social', c.razaoSocial)}${row('Nome fantasia', c.nomeFantasia)}${row('CNPJ', fmtCnpj(c.cnpj))}
      ${row('Regime', c.regime)}${row('Responsável', c.responsavel)}${row('E-mail', c.email)}${row('Telefone', c.telefone)}${row('Honorário mensal', brl(c.honorario))}</div></div>
      <br><button class="btn ghost" onclick="senhaModal()">🔒 Alterar senha</button>`;
  }
};

function boletosTbl(bs) {
  return `<table class="tbl"><thead><tr><th>Descrição</th><th>Competência</th><th>Vencimento</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>${bs.map(b =>
    `<tr><td>${esc(b.descricao)}</td><td>${esc(b.competencia) || '—'}</td><td>${dt(b.vencimento)}</td><td><b>${brl(b.valor)}</b></td><td><span class="pill ${b.situacao}">${b.situacao === 'pago' ? 'Pago' : b.situacao === 'vencido' ? 'Vencido' : 'A vencer'}</span></td>
    <td class="acts">${b.situacao !== 'pago' && (b.pix || b.linhaDigitavel || b.anexo) ? `<button class="btn sm" onclick="pagarModal('${b.id}')">💳 Pagar</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

async function baixarBoleto(id, nome) {
  const r = await fetch(`/api/cliente/boletos/${id}/download`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) return toast('Falha ao baixar', true);
  const u = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = u; a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
}
async function abrirBoleto(id) {
  const r = await fetch(`/api/cliente/boletos/${id}/download`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) return toast('Falha ao abrir', true);
  window.open(URL.createObjectURL(await r.blob()), '_blank');
}
async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); } catch { const t = document.createElement('textarea'); t.value = txt; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('Copiado!');
}
async function pagarModal(id) {
  const b = (await api('cliente/boletos')).find(x => x.id === id); if (!b) return;
  const box = (t, k, v) => `<div class="card" style="margin-top:14px"><b>${t}</b><div class="copy" style="margin:10px 0">${esc(v)}</div><button class="btn sm" data-c="${k}">📋 Copiar</button></div>`;
  modal(`<h3>${esc(b.descricao)}</h3><div class="mut">Vencimento ${dt(b.vencimento)} • <b style="color:var(--txt)">${brl(b.valor)}</b></div>
    <p class="mut" style="margin-top:10px">Escolha como pagar:</p>
    ${b.pix ? box('⚡ PIX copia e cola', 'pix', b.pix) : ''}
    ${b.linhaDigitavel ? box('🔢 Código de barras', 'cod', b.linhaDigitavel) : ''}
    ${b.anexo ? `<div class="card" style="margin-top:14px"><b>📄 Boleto</b><div class="mut" style="margin:10px 0">${esc(b.anexo.nome)}</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-v="1">👁 Visualizar</button><button class="btn ghost sm" data-b="1">⬇ Baixar</button></div></div>` : ''}
    <div class="foot"><button class="btn ghost" id="p-x">Fechar</button></div>`, m => {
    $('#p-x', m).onclick = m.close;
    m.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.c) copiar(t.dataset.c === 'pix' ? b.pix : b.linhaDigitavel);
      if (t.dataset.v) abrirBoleto(b.id);
      if (t.dataset.b) baixarBoleto(b.id, b.anexo.nome);
    });
  });
}

function uploadModal() {
  modal(`<h3>Enviar arquivo ao escritório</h3><label>Categoria</label><select id="u-cat"><option>Nota fiscal</option><option>Extrato bancário</option><option>Documento pessoal</option><option>Comprovante</option><option>Contrato</option><option>Outros</option></select>
    <label>Arquivo (até 20 MB)</label><input id="u-f" type="file"><div class="err" id="u-err"></div>
    <div class="foot"><button class="btn ghost" id="u-x">Cancelar</button><button class="btn" id="u-ok">Enviar</button></div>`, m => {
    $('#u-x', m).onclick = m.close;
    $('#u-ok', m).onclick = async () => {
      const f = $('#u-f', m).files[0]; if (!f) return $('#u-err', m).textContent = 'Selecione um arquivo';
      if (f.size > 20e6) return $('#u-err', m).textContent = 'Arquivo acima de 20 MB';
      $('#u-ok', m).disabled = true;
      const base64 = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.readAsDataURL(f); });
      try { await api('cliente/arquivos', 'POST', { categoria: $('#u-cat', m).value, nome: f.name, mime: f.type, base64 }); m.close(); toast('Arquivo enviado!'); go('arquivos'); }
      catch (e) { $('#u-err', m).textContent = e.message; $('#u-ok', m).disabled = false; }
    };
  });
}
function novoChamado() {
  modal(`<h3>Novo chamado</h3><p class="mut">Descreva o que precisa. Acompanhe pelo status.</p>
    <label>Categoria</label><select id="c-cat"><option>Fiscal</option><option>Folha de pagamento</option><option>Abertura/Alteração</option><option>Certidões</option><option>Financeiro</option><option>Outros</option></select>
    <label>Assunto</label><input id="c-ass" maxlength="120"><label>Descrição</label><textarea id="c-desc"></textarea>
    <div class="err" id="c-err"></div><div class="foot"><button class="btn ghost" id="c-x">Cancelar</button><button class="btn" id="c-ok">Enviar</button></div>`, m => {
    $('#c-x', m).onclick = m.close;
    $('#c-ok', m).onclick = async () => {
      try { await api('cliente/chamados', 'POST', { categoria: $('#c-cat', m).value, assunto: $('#c-ass', m).value, descricao: $('#c-desc', m).value });
        m.close(); toast('Chamado aberto!'); go('chamados'); } catch (e) { $('#c-err', m).textContent = e.message; }
    };
  });
}
function detalhe(c) {
  modal(`<h3>${esc(c.assunto)}</h3><div class="mut">#${c.protocolo} • ${esc(c.categoria)}</div>
    <p style="margin:14px 0"><span class="pill ${c.status}">${c.status}</span></p><p style="white-space:pre-wrap">${esc(c.descricao)}</p>
    ${c.observacao ? `<div class="obs"><b>Observação do escritório:</b><br>${esc(c.observacao)}</div>` : ''}
    <div class="timeline">${[...c.historico].reverse().map(h => `<div class="it"><small>${dthr(h.data)} • ${h.status}</small>${esc(h.texto)}</div>`).join('')}</div>
    ${c.status !== 'Concluído' ? `<label>Adicionar informação</label><textarea id="d-txt" style="min-height:70px"></textarea>` : ''}
    <div class="foot"><button class="btn ghost" id="d-x">Fechar</button>${c.status !== 'Concluído' ? '<button class="btn" id="d-ok">Enviar</button>' : ''}</div>`, m => {
    $('#d-x', m).onclick = m.close;
    const ok = $('#d-ok', m);
    if (ok) ok.onclick = async () => {
      const t = $('#d-txt', m).value.trim(); if (!t) return;
      try { await api(`cliente/chamados/${c.id}/comentar`, 'POST', { texto: t }); m.close(); toast('Enviado'); go('chamados'); } catch (e) { toast(e.message, true); }
    };
  });
}
function senhaModal(forcado) {
  modal(`<h3>${forcado ? 'Defina sua nova senha' : 'Alterar senha'}</h3><p class="mut">${forcado ? 'Você está usando a senha provisória. Recomendamos trocá-la agora.' : ''}</p>
    <label>Senha atual</label><input id="s-a" type="password"><label>Nova senha</label><input id="s-n" type="password" placeholder="mínimo 6 caracteres">
    <div class="err" id="s-err"></div><div class="foot"><button class="btn ghost" id="s-x">${forcado ? 'Depois' : 'Cancelar'}</button><button class="btn" id="s-ok">Salvar</button></div>`, m => {
    $('#s-x', m).onclick = m.close;
    $('#s-ok', m).onclick = async () => {
      try { await api('cliente/senha', 'POST', { atual: $('#s-a', m).value, nova: $('#s-n', m).value }); m.close(); toast('Senha alterada!'); } catch (e) { $('#s-err', m).textContent = e.message; }
    };
  });
}

if (token) start().catch(logout);

// rótulos das colunas para o layout em cartões no celular
new MutationObserver(() => document.querySelectorAll('table.tbl:not([data-l])').forEach(t => {
  const h = [...t.querySelectorAll('thead th')].map(x => x.textContent.trim());
  t.querySelectorAll('tbody tr').forEach(r => [...r.children].forEach((td, i) => td.dataset.label = h[i] || ''));
  t.dataset.l = 1;
})).observe(document.body, { childList: true, subtree: true });
