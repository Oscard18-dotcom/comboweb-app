const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { wrap, isEmail, isPassword, isText } = require('../util');
const mail = require('../mail');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 20, // intentos por 15 minutos (se puede ajustar con AUTH_RATE_LIMIT)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
});
// "Olvidé mi contraseña": pocos intentos por IP (se puede ajustar con AUTH_RATE_LIMIT_OLVIDE)
const limiterOlvide = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_OLVIDE) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
});
const sign = (u) => jwt.sign({ id: u.id, v: u.token_version || 0 }, process.env.JWT_SECRET, { expiresIn: '8h' });
const priv = require('../services/privacidad');
const pub = (u) => ({ id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol, privacidad_pendiente: priv.pendiente(u) });
// Hash de relleno: evita que el tiempo de respuesta revele si el correo existe
const DUMMY_HASH = bcrypt.hashSync('relleno-no-es-una-contraseña', 12);

// Registro público: SIEMPRE crea clientes. El personal lo da de alta el administrador.
router.post('/register', limiter, wrap(async (req, res) => {
  const { nombre, correo, password, acepta_privacidad } = req.body || {};
  if (acepta_privacidad !== true) return res.status(400).json({ error: 'Para crear tu cuenta debes aceptar el Aviso de privacidad.' });
  if (!isText(nombre, 2, 80)) return res.status(400).json({ error: 'Escribe tu nombre completo.' });
  if (!isEmail(correo)) return res.status(400).json({ error: 'Escribe un correo válido.' });
  if (!isPassword(password)) return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 72 caracteres.' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await db.query(
      "INSERT INTO usuarios(nombre,correo,password_hash,rol,privacidad_version,privacidad_aceptada_en) VALUES($1,$2,$3,'cliente',$4,now()) RETURNING id,nombre,correo,rol,token_version,privacidad_version",
      [nombre.trim(), correo.trim().toLowerCase(), hash, priv.VERSION]);
    res.status(201).json({ token: sign(rows[0]), usuario: pub(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una cuenta con este correo. Inicia sesión.' });
    throw e;
  }
}));

router.post('/login', limiter, wrap(async (req, res) => {
  const { correo, password } = req.body || {};
  const { rows } = await db.query(
    'SELECT id,nombre,correo,rol,activo,password_hash,token_version,privacidad_version FROM usuarios WHERE lower(correo)=lower($1)', [String(correo || '')]);
  const u = rows[0];
  const ok = await bcrypt.compare(String(password || ''), u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok || !u.activo) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  res.json({ token: sign(u), usuario: pub(u) });
}));

// Cambiar la propia contraseña: cierra todas las demás sesiones y devuelve un token nuevo para esta
router.post('/cambiar-password', limiter, auth, wrap(async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!isPassword(nueva)) return res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 72 caracteres.' });
  if (actual === nueva) return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual.' });
  const { rows } = await db.query('SELECT password_hash FROM usuarios WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(actual || ''), rows[0].password_hash))) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  const { rows: [u] } = await db.query('UPDATE usuarios SET password_hash=$2, token_version=token_version+1 WHERE id=$1 RETURNING id,nombre,correo,rol,token_version',
    [req.user.id, await bcrypt.hash(nueva, 12)]);
  res.json({ ok: true, token: sign(u) });
}));

/* ---- Mi cuenta (derechos ARCO) ----
   Acceder: GET /perfil · Rectificar: PUT /perfil y /cambiar-password · Cancelar/Oponerse: POST /eliminar-cuenta */
router.get('/perfil', auth, wrap(async (req, res) => {
  const { rows: [u] } = await db.query('SELECT id,nombre,correo,rol,creado_en,privacidad_version,privacidad_aceptada_en FROM usuarios WHERE id=$1', [req.user.id]);
  res.json({ perfil: { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol, creado_en: u.creado_en, privacidad_version: u.privacidad_version, privacidad_aceptada_en: u.privacidad_aceptada_en } });
}));

// Cambiar nombre y/o correo. Cambiar el correo exige la contraseña actual y cierra las demás sesiones.
router.put('/perfil', limiter, auth, wrap(async (req, res) => {
  const b = req.body || {};
  const { rows: [u] } = await db.query('SELECT id,nombre,correo,rol,password_hash,token_version,privacidad_version FROM usuarios WHERE id=$1', [req.user.id]);
  const nombre = b.nombre === undefined ? u.nombre : b.nombre, correo = b.correo === undefined ? u.correo : String(b.correo).trim().toLowerCase();
  if (!isText(nombre, 2, 80)) return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
  if (!isEmail(correo)) return res.status(400).json({ error: 'Escribe un correo válido.' });
  const cambiaCorreo = correo !== u.correo.toLowerCase();
  if (cambiaCorreo && !(await bcrypt.compare(String(b.password || ''), u.password_hash))) return res.status(400).json({ error: 'Para cambiar tu correo escribe tu contraseña actual (y debe ser correcta).' });
  try {
    const { rows: [n] } = await db.query('UPDATE usuarios SET nombre=$2, correo=$3, token_version=token_version+$4 WHERE id=$1 RETURNING id,nombre,correo,rol,token_version,privacidad_version',
      [u.id, nombre.trim(), correo, cambiaCorreo ? 1 : 0]);
    res.json({ usuario: pub(n), token: cambiaCorreo ? sign(n) : undefined });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Ese correo ya está registrado con otra cuenta.' }); throw e; }
}));

/* Eliminar mi cuenta (cancelación y oposición). Solo clientes: las cuentas del personal las administra el administrador.
   Se borran datos personales, tarjetas guardadas y avisos; el historial de ventas se conserva sin datos que identifiquen a la persona. */
router.post('/eliminar-cuenta', limiter, auth, wrap(async (req, res) => {
  if (req.user.rol !== 'cliente') return res.status(403).json({ error: 'Las cuentas del personal las elimina el administrador desde Usuarios.' });
  const { rows: [u] } = await db.query('SELECT id,password_hash FROM usuarios WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String((req.body || {}).password || ''), u.password_hash))) return res.status(400).json({ error: 'La contraseña no es correcta.' });
  if ((req.body || {}).confirmar !== true) return res.status(400).json({ error: 'Confirma que quieres eliminar tu cuenta.' });
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const pend = (await c.query("SELECT count(*)::int n FROM pedidos WHERE cliente_id=$1 AND estatus <> 'Entregado'", [u.id])).rows[0].n;
    if (pend > 0) { await c.query('ROLLBACK'); return res.status(409).json({ error: 'Tienes pedidos que aún no se entregan. Podrás eliminar tu cuenta cuando los recibas.' }); }
    await c.query('DELETE FROM tarjetas_guardadas WHERE usuario_id=$1', [u.id]);
    await c.query('DELETE FROM notificaciones WHERE cliente_id=$1', [u.id]);
    await c.query('DELETE FROM recuperaciones_password WHERE usuario_id=$1', [u.id]);
    await c.query("UPDATE checkouts SET payload='{}'::jsonb WHERE cliente_id=$1", [u.id]);
    await c.query('UPDATE pedidos SET dedicatoria=NULL,dir_cp=NULL,dir_colonia=NULL,dir_calle=NULL,dir_num_ext=NULL,dir_num_int=NULL,dir_municipio=NULL,dir_estado=NULL,dir_referencias=NULL WHERE cliente_id=$1', [u.id]);
    await c.query(`UPDATE usuarios SET nombre='Cuenta eliminada', correo=$2, telefono=NULL, password_hash=$3, activo=false, token_version=token_version+1, eliminado_en=now(),
                    privacidad_version=NULL, privacidad_aceptada_en=NULL WHERE id=$1`, [u.id, `eliminada-${u.id}@eliminada.invalid`, await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)]);
    await c.query('COMMIT');
    res.json({ eliminada: true });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}));

// ---- Recuperar la contraseña por correo ----
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MENSAJE_OLVIDE = 'Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña. Revisa también tu carpeta de spam. El enlace vence en 1 hora.';
const MAX_ENLACES_POR_HORA = 3;

// Siempre responde lo mismo (exista o no el correo) para no revelar quién tiene cuenta.
router.post('/olvide', limiterOlvide, wrap(async (req, res) => {
  const correo = String((req.body || {}).correo || '').trim().toLowerCase();
  if (!isEmail(correo)) return res.status(400).json({ error: 'Escribe un correo válido.' });
  await db.query("DELETE FROM recuperaciones_password WHERE creado_en < now() - interval '1 day'");
  const { rows: [u] } = await db.query('SELECT id,nombre,correo,activo FROM usuarios WHERE lower(correo)=$1', [correo]);
  if (u && u.activo) {
    const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM recuperaciones_password WHERE usuario_id=$1 AND creado_en > now() - interval '1 hour'", [u.id]);
    if (n < MAX_ENLACES_POR_HORA) {
      const token = crypto.randomBytes(32).toString('hex');
      await db.query("UPDATE recuperaciones_password SET usado_en=now() WHERE usuario_id=$1 AND usado_en IS NULL", [u.id]);
      await db.query("INSERT INTO recuperaciones_password(usuario_id,token_hash,expira_en) VALUES($1,$2,now() + interval '1 hour')", [u.id, hashToken(token)]);
      const base = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
      const enlace = `${base}/?reset=${token}`;
      const empresa = process.env.EMPRESA_NOMBRE || 'EN COMBO';
      // No se espera el envío: así la respuesta tarda igual exista o no la cuenta
      mail.obtener().enviar({
        a: u.correo, asunto: `Restablece tu contraseña de ${empresa}`,
        texto: `Hola ${u.nombre},\n\nRecibimos una solicitud para crear una nueva contraseña. Abre este enlace (vence en 1 hora):\n${enlace}\n\nSi no fuiste tú, ignora este correo: tu contraseña no cambia.\n\n${empresa}`,
        html: `<p>Hola ${esc(u.nombre)},</p><p>Recibimos una solicitud para crear una nueva contraseña. El enlace vence en 1 hora.</p><p><a href="${esc(enlace)}">Crear mi nueva contraseña</a></p><p>Si no fuiste tú, ignora este correo: tu contraseña no cambia.</p><p>${esc(empresa)}</p>`,
      }).catch((e) => console.error('No se pudo enviar el correo de recuperación:', e.message));
    }
  }
  res.json({ ok: true, mensaje: MENSAJE_OLVIDE });
}));

router.post('/restablecer', limiter, wrap(async (req, res) => {
  const { token, nueva } = req.body || {};
  if (!/^[0-9a-f]{64}$/.test(String(token || ''))) return res.status(400).json({ error: 'El enlace no es válido. Pide uno nuevo.' });
  if (!isPassword(nueva)) return res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 72 caracteres.' });
  const hash = await bcrypt.hash(nueva, 12);
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    // Un solo uso: el UPDATE solo funciona si el enlace no se ha usado y no ha vencido
    const { rows: [t] } = await c.query('UPDATE recuperaciones_password SET usado_en=now() WHERE token_hash=$1 AND usado_en IS NULL AND expira_en > now() RETURNING usuario_id', [hashToken(String(token))]);
    if (!t) { await c.query('ROLLBACK'); return res.status(400).json({ error: 'El enlace venció o ya se usó. Pide uno nuevo.' }); }
    const { rowCount } = await c.query('UPDATE usuarios SET password_hash=$2, token_version=token_version+1 WHERE id=$1 AND activo', [t.usuario_id, hash]);
    if (!rowCount) { await c.query('ROLLBACK'); return res.status(400).json({ error: 'El enlace venció o ya se usó. Pide uno nuevo.' }); }
    await c.query('UPDATE recuperaciones_password SET usado_en=now() WHERE usuario_id=$1 AND usado_en IS NULL', [t.usuario_id]);
    await c.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}));

// Quien ya tenía cuenta (o el aviso cambió) lo acepta aquí; queda guardada la versión y la fecha
router.post('/aceptar-privacidad', auth, wrap(async (req, res) => {
  if ((req.body || {}).acepto !== true) return res.status(400).json({ error: 'Debes aceptar el Aviso de privacidad para continuar.' });
  const { rows } = await db.query('UPDATE usuarios SET privacidad_version=$2, privacidad_aceptada_en=now() WHERE id=$1 RETURNING id,nombre,correo,rol,privacidad_version', [req.user.id, priv.VERSION]);
  res.json({ usuario: pub(rows[0]) });
}));
router.get('/me', auth, (req, res) => res.json({ usuario: pub(req.user) }));

module.exports = router;
