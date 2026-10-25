// Servidor do sistema contábil - sem dependências externas (Node 18+)
// Uso: node server.js   -> App cliente: http://localhost:3000/   Painel admin: http://localhost:3000/admin
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
// carrega .env (sem dependências)
try {
  for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { }
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const USE_SB = !!(SB_URL && SB_KEY);
const BUCKET = 'uploads';
const sbH = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
const TABLES = ['clientes', 'boletos', 'arquivos', 'chamados'];
const DATA_DIR = path.join(ROOT, 'data');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(UP_DIR, { recursive: true });

// ---------- util ----------
const hash = (pw, salt = crypto.randomBytes(8).toString('hex')) =>
  salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const check = (pw, h) => { const [s] = h.split(':'); return hash(pw, s) === h; };
const uid = () => crypto.randomBytes(6).toString('hex');
const digits = s => String(s || '').replace(/\D/g, '');
const now = () => new Date().toISOString();

function validaCNPJ(c) {
  c = digits(c);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = n => { let s = 0, p = n - 7;
    for (let i = 0; i < n; i++) { s += c[i] * p--; if (p < 2) p = 9; }
    const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) == c[12] && calc(13) == c[13];
}

// ---------- banco ----------
let db;
const snap = {}; // tabela -> Map(id -> json) último estado gravado no Supabase
async function sb(pathq, opt = {}) {
  const r = await fetch(SB_URL + pathq, { ...opt, headers: { ...sbH, ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r;
}
async function sbSelect(table) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const rows = await (await sb(`/rest/v1/${table}?select=id,data`, { headers: { Range: `${off}-${off + 999}`, 'Range-Unit': 'items' } })).json();
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}
async function init() {
  if (USE_SB) {
    db = { admin: null, clientes: [], boletos: [], arquivos: [], chamados: [] };
    for (const t of TABLES) { const rows = await sbSelect(t); db[t] = rows.map(r => r.data); snap[t] = new Map(rows.map(r => [r.id, JSON.stringify(r.data)])); }
    const cfg = await sbSelect('config'); const a = cfg.find(r => r.id === 'admin');
    snap.config = new Map(cfg.map(r => [r.id, JSON.stringify(r.data)]));
    db.admin = a ? a.data : { usuario: 'admin', senha: hash(process.env.ADMIN_PASSWORD || 'admin123') };
    if (!a) save();
    console.log('  Banco: Supabase conectado');
    return;
  }
  if (fs.existsSync(DB_FILE)) { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); console.log('  Banco: arquivo local (data/db.json)'); return; }
  db = { admin: { usuario: 'admin', senha: hash(process.env.ADMIN_PASSWORD || 'admin123') }, clientes: [], boletos: [], arquivos: [], chamados: [] };
  save();
  console.log('  Banco: arquivo local (data/db.json)');
}
let chain = Promise.resolve();
function save() {
  if (!USE_SB) {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
    return;
  }
  chain = chain.then(persist).catch(e => console.error('Falha ao gravar no Supabase:', e.message));
}
async function persist() {
  const sets = { ...Object.fromEntries(TABLES.map(t => [t, db[t]])), config: [{ id: 'admin', ...db.admin }] };
  for (const [t, list] of Object.entries(sets)) {
    const old = snap[t] || (snap[t] = new Map()), cur = new Map();
    const up = [];
    for (const o of list) {
      const id = o.id, js = JSON.stringify(o); cur.set(id, js);
      if (old.get(id) !== js) up.push({ id, data: o });
    }
    const del = [...old.keys()].filter(id => !cur.has(id));
    for (let i = 0; i < up.length; i += 200)
      await sb(`/rest/v1/${t}?on_conflict=id`, { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(up.slice(i, i + 200)) });
    for (let i = 0; i < del.length; i += 100)
      await sb(`/rest/v1/${t}?id=in.(${del.slice(i, i + 100).join(',')})`, { method: 'DELETE' });
    snap[t] = cur;
  }
}
const ready = init();

// ---------- arquivos (Supabase Storage ou disco) ----------
async function putFile(name, buf, mime) {
  if (!USE_SB) return fs.writeFileSync(path.join(UP_DIR, name), buf);
  await sb(`/storage/v1/object/${BUCKET}/${name}`, { method: 'POST', headers: { 'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'true' }, body: buf });
}

// ---------- sessões ----------
const sessions = new Map(); // token -> {role, id, exp}
function newSession(role, id) {
  const t = crypto.randomBytes(24).toString('hex');
  sessions.set(t, { role, id, exp: Date.now() + 12 * 3600e3 });
  return t;
}
function auth(req, url, role) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  const s = sessions.get(t);
  if (!s || s.exp < Date.now() || s.role !== role) return null;
  return s;
}

// ---------- http helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };
const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const readBody = req => new Promise((ok, no) => {
  const chunks = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > 30e6) { no(new Error('Arquivo muito grande')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch (e) { no(e); } });
});

const pubCliente = c => { const { senha, ...r } = c; return r; };
const statusBoleto = b => b.status === 'pago' ? 'pago' : (b.vencimento < new Date().toISOString().slice(0, 10) ? 'vencido' : 'pendente');
const withStatus = b => { const { anexo, ...r } = b; return { ...r, situacao: statusBoleto(b), anexo: anexo ? { nome: anexo.nome } : null }; };
async function saveAnexo(a) {
  if (!a || !a.base64 || !a.nome) return null;
  const buf = Buffer.from(a.base64, 'base64');
  const id = uid(), ext = path.extname(a.nome).slice(0, 10).replace(/[^\w.]/g, '');
  await putFile(id + ext, buf, a.mime || 'application/pdf');
  return { arquivo: id + ext, nome: a.nome, mime: a.mime || 'application/pdf' };
}
const pubArq = a => { const { arquivo, ...r } = a; return r; };

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  let body = {};
  if (m === 'POST' || m === 'PUT' || m === 'PATCH') body = await readBody(req);
  let mt;

  // ===== login =====
  if (p === '/api/login' && m === 'POST') {
    const c = db.clientes.find(x => x.cnpj === digits(body.cnpj));
    if (!c || !c.ativo || !check(String(body.senha || ''), c.senha)) return send(res, 401, { erro: 'CNPJ ou senha inválidos' });
    return send(res, 200, { token: newSession('cliente', c.id), cliente: pubCliente(c), trocarSenha: !!c.senhaProvisoria });
  }
  if (p === '/api/admin/login' && m === 'POST') {
    if (body.usuario !== db.admin.usuario || !check(String(body.senha || ''), db.admin.senha)) return send(res, 401, { erro: 'Usuário ou senha inválidos' });
    return send(res, 200, { token: newSession('admin', 'admin') });
  }

  // ===== CLIENTE (só enxerga os próprios dados: id vem da sessão) =====
  if (p.startsWith('/api/cliente/')) {
    const s = auth(req, url, 'cliente');
    if (!s) return send(res, 401, { erro: 'Sessão expirada' });
    const me = db.clientes.find(c => c.id === s.id);
    if (!me) return send(res, 401, { erro: 'Sessão inválida' });
    const r = p.slice(13);

    if (r === 'perfil' && m === 'GET') return send(res, 200, pubCliente(me));
    if (r === 'resumo' && m === 'GET') {
      const bs = db.boletos.filter(b => b.clienteId === me.id).map(withStatus);
      return send(res, 200, {
        aVencer: bs.filter(b => b.situacao === 'pendente').length,
        vencidos: bs.filter(b => b.situacao === 'vencido').length,
        totalAberto: bs.filter(b => b.situacao !== 'pago').reduce((t, b) => t + b.valor, 0),
        arquivos: db.arquivos.filter(a => a.clienteId === me.id).length,
        chamadosAbertos: db.chamados.filter(c => c.clienteId === me.id && c.status !== 'Concluído').length
      });
    }
    if (r === 'boletos' && m === 'GET')
      return send(res, 200, db.boletos.filter(b => b.clienteId === me.id).map(withStatus).sort((a, b) => a.vencimento.localeCompare(b.vencimento)));
    if ((mt = r.match(/^boletos\/(\w+)\/download$/)) && m === 'GET') {
      const b = db.boletos.find(x => x.id === mt[1] && x.clienteId === me.id);
      if (!b || !b.anexo) return send(res, 404, { erro: 'Boleto sem anexo' });
      return sendFile(res, b.anexo);
    }
    if (r === 'arquivos' && m === 'GET')
      return send(res, 200, db.arquivos.filter(a => a.clienteId === me.id).map(pubArq).sort((a, b) => b.data.localeCompare(a.data)));
    if (r === 'arquivos' && m === 'POST') {
      if (!body.nome || !body.base64) return send(res, 400, { erro: 'Arquivo ausente' });
      const buf = Buffer.from(body.base64, 'base64');
      if (buf.length > 20e6) return send(res, 400, { erro: 'Arquivo acima de 20 MB' });
      const id = uid(), ext = path.extname(body.nome).slice(0, 10).replace(/[^\w.]/g, '');
      await putFile(id + ext, buf, body.mime);
      const a = { id, clienteId: me.id, nome: body.nome, categoria: body.categoria || 'Outros', origem: 'cliente',
        mime: body.mime || 'application/octet-stream', tamanho: buf.length, data: now(), arquivo: id + ext };
      db.arquivos.push(a); save();
      return send(res, 201, pubArq(a));
    }
    if ((mt = r.match(/^arquivos\/(\w+)$/)) && m === 'DELETE') {
      const a = db.arquivos.find(x => x.id === mt[1] && x.clienteId === me.id && x.origem === 'cliente');
      if (!a) return send(res, 404, { erro: 'Só é possível excluir arquivos enviados por você' });
      rmFile(a); db.arquivos = db.arquivos.filter(x => x !== a); save();
      return send(res, 200, { ok: true });
    }
    if ((mt = r.match(/^arquivos\/(\w+)\/download$/)) && m === 'GET') {
      const a = db.arquivos.find(x => x.id === mt[1] && x.clienteId === me.id);
      if (!a) return send(res, 404, { erro: 'Não encontrado' });
      return sendFile(res, a);
    }
    if (r === 'chamados' && m === 'GET')
      return send(res, 200, db.chamados.filter(c => c.clienteId === me.id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)));
    if (r === 'chamados' && m === 'POST') {
      if (!body.assunto || !body.descricao) return send(res, 400, { erro: 'Informe assunto e descrição' });
      const c = { id: uid(), protocolo: 'CH' + String(db.chamados.length + 1).padStart(5, '0'), clienteId: me.id,
        assunto: String(body.assunto).slice(0, 120), categoria: body.categoria || 'Outros',
        descricao: String(body.descricao).slice(0, 4000), status: 'Aberto', observacao: '',
        historico: [{ data: now(), status: 'Aberto', texto: 'Chamado aberto pelo cliente' }],
        criadoEm: now(), atualizadoEm: now() };
      db.chamados.push(c); save();
      return send(res, 201, c);
    }
    if ((mt = r.match(/^chamados\/(\w+)\/comentar$/)) && m === 'POST') {
      const c = db.chamados.find(x => x.id === mt[1] && x.clienteId === me.id);
      if (!c) return send(res, 404, { erro: 'Não encontrado' });
      if (c.status === 'Concluído') return send(res, 400, { erro: 'Chamado já concluído' });
      c.historico.push({ data: now(), status: c.status, texto: 'Cliente: ' + String(body.texto || '').slice(0, 2000) });
      if (c.status === 'Aguardando cliente') c.status = 'Em análise';
      c.atualizadoEm = now(); save();
      return send(res, 200, c);
    }
    if (r === 'senha' && m === 'POST') {
      if (!check(String(body.atual || ''), me.senha)) return send(res, 400, { erro: 'Senha atual incorreta' });
      if (String(body.nova || '').length < 6) return send(res, 400, { erro: 'A nova senha precisa ter 6+ caracteres' });
      if (body.nova === '123456') return send(res, 400, { erro: 'Escolha uma senha diferente da provisória' });
      me.senha = hash(body.nova); me.senhaProvisoria = false; save();
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { erro: 'Rota inexistente' });
  }

  // ===== ADMIN =====
  if (p.startsWith('/api/admin/')) {
    const s = auth(req, url, 'admin');
    if (!s) return send(res, 401, { erro: 'Sessão expirada' });
    const r = p.slice(11);

    if (r === 'dashboard' && m === 'GET') {
      const bs = db.boletos.map(withStatus);
      return send(res, 200, {
        clientes: db.clientes.length,
        porRegime: db.clientes.reduce((o, c) => (o[c.regime] = (o[c.regime] || 0) + 1, o), {}),
        boletosPendentes: bs.filter(b => b.situacao === 'pendente').length,
        boletosVencidos: bs.filter(b => b.situacao === 'vencido').length,
        valorAberto: bs.filter(b => b.situacao !== 'pago').reduce((t, b) => t + b.valor, 0),
        valorRecebido: bs.filter(b => b.situacao === 'pago').reduce((t, b) => t + b.valor, 0),
        chamadosAbertos: db.chamados.filter(c => c.status === 'Aberto').length,
        chamadosAndamento: db.chamados.filter(c => ['Em análise', 'Aguardando cliente'].includes(c.status)).length,
        chamadosConcluidos: db.chamados.filter(c => c.status === 'Concluído').length
      });
    }

    // clientes
    if (r === 'clientes' && m === 'GET') return send(res, 200, db.clientes.map(pubCliente));
    if (r === 'clientes' && m === 'POST') {
      const cnpj = digits(body.cnpj);
      if (!validaCNPJ(cnpj)) return send(res, 400, { erro: 'CNPJ inválido' });
      if (db.clientes.some(c => c.cnpj === cnpj)) return send(res, 400, { erro: 'CNPJ já cadastrado' });
      if (!body.razaoSocial) return send(res, 400, { erro: 'Informe a razão social' });
      const c = { id: uid(), cnpj, razaoSocial: body.razaoSocial, nomeFantasia: body.nomeFantasia || '',
        regime: body.regime || 'MEI', responsavel: body.responsavel || '', email: body.email || '',
        telefone: body.telefone || '', honorario: Number(body.honorario) || 0, ativo: true,
        senha: hash('123456'), senhaProvisoria: true, criadoEm: now() };
      db.clientes.push(c); save();
      return send(res, 201, pubCliente(c));
    }
    if ((mt = r.match(/^clientes\/(\w+)$/))) {
      const c = db.clientes.find(x => x.id === mt[1]);
      if (!c) return send(res, 404, { erro: 'Não encontrado' });
      if (m === 'PUT') {
        for (const k of ['razaoSocial', 'nomeFantasia', 'regime', 'responsavel', 'email', 'telefone']) if (k in body) c[k] = body[k];
        if ('honorario' in body) c.honorario = Number(body.honorario) || 0;
        if ('ativo' in body) c.ativo = !!body.ativo;
        save(); return send(res, 200, pubCliente(c));
      }
      if (m === 'DELETE') {
        db.arquivos.filter(a => a.clienteId === c.id).forEach(rmFile);
        db.clientes = db.clientes.filter(x => x !== c);
        db.boletos = db.boletos.filter(b => b.clienteId !== c.id);
        db.arquivos = db.arquivos.filter(a => a.clienteId !== c.id);
        db.chamados = db.chamados.filter(h => h.clienteId !== c.id);
        save(); return send(res, 200, { ok: true });
      }
    }
    if ((mt = r.match(/^clientes\/(\w+)\/resetsenha$/)) && m === 'POST') {
      const c = db.clientes.find(x => x.id === mt[1]);
      if (!c) return send(res, 404, { erro: 'Não encontrado' });
      c.senha = hash('123456'); c.senhaProvisoria = true; save();
      return send(res, 200, { ok: true });
    }

    // boletos
    if (r === 'boletos' && m === 'GET') return send(res, 200, db.boletos.map(withStatus).sort((a, b) => a.vencimento.localeCompare(b.vencimento)));
    if (r === 'boletos' && m === 'POST') {
      if (!db.clientes.some(c => c.id === body.clienteId)) return send(res, 400, { erro: 'Cliente inválido' });
      if (!body.descricao || !body.vencimento || !(Number(body.valor) > 0)) return send(res, 400, { erro: 'Informe descrição, valor e vencimento' });
      const b = { id: uid(), clienteId: body.clienteId, descricao: body.descricao, competencia: body.competencia || '',
        valor: Number(body.valor), vencimento: body.vencimento, linhaDigitavel: body.linhaDigitavel || '', pix: body.pix || '',
        anexo: await saveAnexo(body.anexo),
        status: 'pendente', pagoEm: null, criadoEm: now() };
      db.boletos.push(b); save();
      return send(res, 201, withStatus(b));
    }
    if ((mt = r.match(/^boletos\/(\w+)\/download$/)) && m === 'GET') {
      const b = db.boletos.find(x => x.id === mt[1]);
      if (!b || !b.anexo) return send(res, 404, { erro: 'Boleto sem anexo' });
      return sendFile(res, b.anexo);
    }
    if ((mt = r.match(/^boletos\/(\w+)$/))) {
      const b = db.boletos.find(x => x.id === mt[1]);
      if (!b) return send(res, 404, { erro: 'Não encontrado' });
      if (m === 'PUT') {
        if (body.status) { b.status = body.status === 'pago' ? 'pago' : 'pendente'; b.pagoEm = b.status === 'pago' ? now() : null; }
        for (const k of ['descricao', 'competencia', 'vencimento', 'linhaDigitavel', 'pix']) if (k in body) b[k] = body[k];
        if ('valor' in body) b.valor = Number(body.valor);
        if (body.anexo) { if (b.anexo) rmFile(b.anexo); b.anexo = await saveAnexo(body.anexo); }
        if (body.removerAnexo && b.anexo) { rmFile(b.anexo); b.anexo = null; }
        save(); return send(res, 200, withStatus(b));
      }
      if (m === 'DELETE') { if (b.anexo) rmFile(b.anexo); db.boletos = db.boletos.filter(x => x !== b); save(); return send(res, 200, { ok: true }); }
    }

    // arquivos
    if (r === 'arquivos' && m === 'GET') return send(res, 200, db.arquivos.map(pubArq).sort((a, b) => b.data.localeCompare(a.data)));
    if (r === 'arquivos' && m === 'POST') {
      if (!db.clientes.some(c => c.id === body.clienteId)) return send(res, 400, { erro: 'Cliente inválido' });
      if (!body.nome || !body.base64) return send(res, 400, { erro: 'Arquivo ausente' });
      const id = uid(), ext = path.extname(body.nome).slice(0, 10).replace(/[^\w.]/g, '');
      const buf = Buffer.from(body.base64, 'base64');
      await putFile(id + ext, buf, body.mime);
      const a = { id, clienteId: body.clienteId, nome: body.nome, categoria: body.categoria || 'Outros', origem: 'escritorio',
        mime: body.mime || 'application/octet-stream', tamanho: buf.length, data: now(), arquivo: id + ext };
      db.arquivos.push(a); save();
      return send(res, 201, pubArq(a));
    }
    if ((mt = r.match(/^arquivos\/(\w+)(\/download)?$/))) {
      const a = db.arquivos.find(x => x.id === mt[1]);
      if (!a) return send(res, 404, { erro: 'Não encontrado' });
      if (mt[2] && m === 'GET') return sendFile(res, a);
      if (m === 'DELETE') { rmFile(a); db.arquivos = db.arquivos.filter(x => x !== a); save(); return send(res, 200, { ok: true }); }
    }

    // chamados
    if (r === 'chamados' && m === 'GET') return send(res, 200, db.chamados.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)));
    if ((mt = r.match(/^chamados\/(\w+)$/)) && m === 'PUT') {
      const c = db.chamados.find(x => x.id === mt[1]);
      if (!c) return send(res, 404, { erro: 'Não encontrado' });
      const validos = ['Aberto', 'Em análise', 'Aguardando cliente', 'Concluído'];
      const mudouStatus = body.status && validos.includes(body.status) && body.status !== c.status;
      const mudouObs = 'observacao' in body && body.observacao !== c.observacao;
      if (mudouStatus) c.status = body.status;
      if (mudouObs) c.observacao = String(body.observacao).slice(0, 4000);
      if (mudouStatus || mudouObs)
        c.historico.push({ data: now(), status: c.status, texto: 'Escritório: ' + (c.observacao || 'Status atualizado') });
      c.atualizadoEm = now(); save();
      return send(res, 200, c);
    }
    if (r === 'senha' && m === 'POST') {
      if (!check(String(body.atual || ''), db.admin.senha)) return send(res, 400, { erro: 'Senha atual incorreta' });
      if (String(body.nova || '').length < 6) return send(res, 400, { erro: 'Mínimo de 6 caracteres' });
      db.admin.senha = hash(body.nova); save();
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { erro: 'Rota inexistente' });
  }
  return send(res, 404, { erro: 'Rota inexistente' });
}

function rmFile(a) {
  if (USE_SB) return void sb(`/storage/v1/object/${BUCKET}/${a.arquivo}`, { method: 'DELETE' }).catch(() => { });
  try { fs.unlinkSync(path.join(UP_DIR, a.arquivo)); } catch { }
}
async function sendFile(res, a) {
  const head = { 'Content-Type': a.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.nome)}` };
  if (USE_SB) {
    const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${a.arquivo}`, { headers: sbH });
    if (!r.ok) return send(res, 404, { erro: 'Arquivo ausente no armazenamento' });
    res.writeHead(200, head); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const f = path.join(UP_DIR, a.arquivo);
  if (!fs.existsSync(f)) return send(res, 404, { erro: 'Arquivo ausente no disco' });
  res.writeHead(200, head);
  fs.createReadStream(f).pipe(res);
}

// ---------- estáticos ----------
function serveStatic(res, dir, rel) {
  let f = path.normalize(path.join(ROOT, dir, rel === '/' || rel === '' ? 'index.html' : rel));
  if (!f.startsWith(path.join(ROOT, dir))) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Não encontrado'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) return await api(req, res, url);
    if (p === '/admin') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
    if (p.startsWith('/admin/')) return serveStatic(res, 'painel Admin', p.slice(6));
    return serveStatic(res, 'app_usuario', p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { erro: e.message || 'Erro interno' });
  }
});
ready.then(() => server.listen(PORT, () => {
  console.log(`\n  App do cliente : http://localhost:${PORT}/`);
  console.log(`  Painel Admin   : http://localhost:${PORT}/admin/\n`);
})).catch(e => { console.error('\nFalha ao iniciar:', e.message); process.exit(1); });
