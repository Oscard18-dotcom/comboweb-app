// Endpoints de la pasarela SIMULADA (solo desarrollo; responden 404 si no está activa o en producción)
const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap } = require('../util');
const svc = require('../services/pedidos');
const pagos = require('../payments');
const tarjeta = require('../services/tarjeta');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.use((req, res, next) => (pagos.simuladoPermitido() ? next() : res.status(404).json({ error: 'Ruta no encontrada.' })), auth, roles('cliente'));

async function propio(req, res) {
  if (!UUID.test(req.params.id)) { res.status(400).json({ error: 'Identificador inválido.' }); return null; }
  const { rows } = await db.query('SELECT id,total FROM checkouts WHERE id=$1 AND cliente_id=$2 AND proveedor=$3', [req.params.id, req.user.id, 'simulado']);
  if (!rows[0]) { res.status(404).json({ error: 'Pago no encontrado.' }); return null; }
  return rows[0];
}
// Pago con tarjeta SIMULADA: pide los datos, los valida y decide. El número y el CVV no se guardan: solo "Visa •••• 4242".
router.post('/simulado/:id/aprobar', wrap(async (req, res) => {
  const ck = await propio(req, res); if (!ck) return;
  const estado = (await db.query('SELECT estado FROM checkouts WHERE id=$1', [ck.id])).rows[0].estado;
  if (estado !== 'creado') return res.json(await svc.confirmarPago(ck.id, { proveedor: 'simulado', referencia: 'sim_' + ck.id, monto: ck.total }));
  const b = req.body || {};
  let t = b.tarjeta;
  if (b.tarjeta_guardada_id !== undefined) {
    // Tarjeta guardada en Mi cuenta: solo se pide el CVV (nunca se guarda)
    const g = (await db.query('SELECT marca,ultimos4,titular,vence FROM tarjetas_guardadas WHERE id=$1 AND usuario_id=$2', [Number.parseInt(b.tarjeta_guardada_id, 10) || 0, req.user.id])).rows[0];
    if (!g) return res.status(404).json({ error: 'Esa tarjeta ya no está guardada.' });
    const hoy = svc.todayMX(), [mm, aa] = g.vence.split('/').map(Number), anio = 2000 + aa;
    if (anio < Number(hoy.slice(0, 4)) || (anio === Number(hoy.slice(0, 4)) && mm < Number(hoy.slice(5, 7)))) return res.status(400).json({ error: 'La tarjeta guardada está vencida. Elimínala y agrega una nueva.', campos: { vence: 'La tarjeta está vencida.' } });
    const amex = g.marca === 'American Express';
    if (typeof b.cvv !== 'string' || !(amex ? /^\d{4}$/ : /^\d{3}$/).test(b.cvv)) return res.status(400).json({ error: 'Revisa los datos de la tarjeta.', campos: { cvv: amex ? 'El código de seguridad tiene 4 dígitos.' : 'El código de seguridad tiene 3 dígitos.' } });
    return res.json(await svc.confirmarPago(ck.id, { proveedor: 'simulado', referencia: 'sim_' + ck.id, monto: ck.total, tarjeta: `${g.marca} •••• ${g.ultimos4}` }));
  }
  const v = tarjeta.validar(t, svc.todayMX());
  if (v.errores) return res.status(400).json({ error: 'Revisa los datos de la tarjeta.', campos: v.errores });
  if (v.rechazo) return res.status(402).json({ error: v.rechazo, estado: 'declinado' });
  if (b.guardar === true) {
    // Opcional: guardarla en Mi cuenta (solo marca, últimos 4, titular y vencimiento). Si falla, el pago no se afecta.
    const m = String(t.vence).trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
    await db.query(`INSERT INTO tarjetas_guardadas(usuario_id,marca,ultimos4,titular,vence) SELECT $1,$2,$3,$4,$5
                     WHERE (SELECT count(*) FROM tarjetas_guardadas WHERE usuario_id=$1) < 5 ON CONFLICT DO NOTHING`,
      [req.user.id, v.marca, v.ultimos4, String(t.titular).trim().replace(/\s+/g, ' '), `${m[1].padStart(2, '0')}/${m[2].slice(-2)}`]).catch(() => {});
  }
  res.json(await svc.confirmarPago(ck.id, { proveedor: 'simulado', referencia: 'sim_' + ck.id, monto: ck.total, tarjeta: `${v.marca} •••• ${v.ultimos4}` }));
}));
router.post('/simulado/:id/rechazar', wrap(async (req, res) => {
  const ck = await propio(req, res); if (!ck) return;
  await db.query("UPDATE checkouts SET estado='rechazado' WHERE id=$1 AND estado='creado'", [ck.id]);
  res.json({ estado: 'rechazado' });
}));

module.exports = router;
