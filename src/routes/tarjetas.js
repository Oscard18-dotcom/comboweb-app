// Mi cuenta → Mis tarjetas. Solo se guarda marca, últimos 4, titular y vencimiento (jamás el número completo ni el CVV).
const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, paramId } = require('../util');
const tarjeta = require('../services/tarjeta');
const svc = require('../services/pedidos');

router.use(auth, roles('cliente'));
const MAX = 5;
const venceNorm = (v) => { const m = String(v).trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/); return m ? `${m[1].padStart(2, '0')}/${m[2].slice(-2)}` : null; };
const pub = (r) => ({ id: r.id, marca: r.marca, ultimos4: r.ultimos4, titular: r.titular, vence: r.vence, etiqueta: `${r.marca} •••• ${r.ultimos4}` });

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT id,marca,ultimos4,titular,vence FROM tarjetas_guardadas WHERE usuario_id=$1 ORDER BY id', [req.user.id]);
  res.json({ tarjetas: rows.map(pub) });
}));

router.post('/', wrap(async (req, res) => {
  const t = (req.body || {}).tarjeta || req.body || {};
  const v = tarjeta.validar(t, svc.todayMX());
  if (v.errores) return res.status(400).json({ error: 'Revisa los datos de la tarjeta.', campos: v.errores });
  if (v.rechazo) return res.status(402).json({ error: v.rechazo });
  if ((await db.query('SELECT count(*)::int n FROM tarjetas_guardadas WHERE usuario_id=$1', [req.user.id])).rows[0].n >= MAX) return res.status(409).json({ error: `Puedes guardar hasta ${MAX} tarjetas. Elimina una para agregar otra.` });
  try {
    const { rows } = await db.query('INSERT INTO tarjetas_guardadas(usuario_id,marca,ultimos4,titular,vence) VALUES($1,$2,$3,$4,$5) RETURNING id,marca,ultimos4,titular,vence',
      [req.user.id, v.marca, v.ultimos4, String(t.titular).trim().replace(/\s+/g, ' '), venceNorm(t.vence)]);
    res.status(201).json({ tarjeta: pub(rows[0]) });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Esa tarjeta ya está guardada.' }); throw e; }
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const r = await db.query('DELETE FROM tarjetas_guardadas WHERE id=$1 AND usuario_id=$2', [id, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Tarjeta no encontrada.' });
  res.json({ eliminada: true });
}));

module.exports = router;
