// Corte de caja (solo administrador): con cuánto se abre, lo cobrado en el periodo y con cuánto se cierra.
const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, paramId } = require('../util');
const svc = require('../services/pedidos');

router.use(auth, roles('admin'));

const TZ = "'America/Mexico_City'";
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const folio = (id) => `CC-${String(id).padStart(4, '0')}`;

function periodo(src, res) {
  const hoy = svc.todayMX();
  const hasta = src.hasta || hoy, desde = src.desde || hasta;
  if (typeof desde !== 'string' || typeof hasta !== 'string' || !svc.fechaValida(desde) || !svc.fechaValida(hasta)) { res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' }); return null; }
  if (desde > hasta) { res.status(400).json({ error: 'La fecha inicial debe ser anterior o igual a la final.' }); return null; }
  if (hasta > hoy) { res.status(400).json({ error: 'El corte no puede llegar a una fecha futura.' }); return null; }
  if ((Date.parse(hasta) - Date.parse(desde)) / 864e5 > 92) { res.status(400).json({ error: 'Un corte puede abarcar como máximo 3 meses.' }); return null; }
  return { desde, hasta };
}

// Pagos aprobados del periodo, agrupados por método (marca de la tarjeta)
async function calcular(q, desde, hasta) {
  const { rows } = await q.query(
    `SELECT CASE WHEN g.tarjeta IS NOT NULL THEN split_part(g.tarjeta, ' ••••', 1)
                 WHEN g.proveedor = 'stripe' THEN 'Tarjeta (Stripe)' ELSE 'Tarjeta' END AS metodo,
            count(*)::int AS pedidos, coalesce(sum(g.monto), 0) AS monto
       FROM pagos g WHERE g.estado = 'aprobado' AND (g.creado_en AT TIME ZONE ${TZ})::date BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY 3 DESC, 1`, [desde, hasta]);
  const desglose = rows.map((x) => ({ metodo: x.metodo, pedidos: x.pedidos, monto: r2(x.monto) }));
  return { desde, hasta, pedidos: desglose.reduce((a, x) => a + x.pedidos, 0), ventas: r2(desglose.reduce((a, x) => a + x.monto, 0)), desglose };
}

// Importe en pesos: número con hasta 2 decimales y no negativo
const dinero = (v) => (v === '' || v == null ? null : (typeof v === 'number' || typeof v === 'string') && /^\d{1,8}(\.\d{1,2})?$/.test(String(v).trim()) ? Number(v) : NaN);
const fila = (x) => ({ id: x.id, folio: folio(x.id), desde: x.desde, hasta: x.hasta, fondo_inicial: Number(x.fondo_inicial), ventas: Number(x.ventas), pedidos: x.pedidos, desglose: x.desglose,
  saldo_final: Number(x.saldo_final), contado: x.contado == null ? null : Number(x.contado), diferencia: x.diferencia == null ? null : Number(x.diferencia), notas: x.notas, creado_en: x.creado_en, hecho_por: x.hecho_por || null });
const COLS = `c.id, c.desde::text AS desde, c.hasta::text AS hasta, c.fondo_inicial, c.ventas, c.pedidos, c.desglose, c.saldo_final, c.contado, c.diferencia, c.notas, c.creado_en, u.nombre AS hecho_por`;

router.get('/resumen', wrap(async (req, res) => {
  const p = periodo(req.query, res); if (!p) return;
  res.json(await calcular(db, p.desde, p.hasta));
}));

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT ${COLS} FROM cortes_caja c LEFT JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.id DESC LIMIT 50`);
  res.json({ cortes: rows.map(fila) });
}));

router.get('/:id', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const { rows } = await db.query(`SELECT ${COLS} FROM cortes_caja c LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE c.id=$1`, [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Corte no encontrado.' });
  res.json({ corte: fila(rows[0]) });
}));

// Guarda el corte. Las ventas se vuelven a calcular en el servidor: lo que mande el navegador solo cuenta para el fondo y el monto contado.
router.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const p = periodo(b, res); if (!p) return;
  const fondo = dinero(b.fondo_inicial);
  if (fondo == null || Number.isNaN(fondo)) return res.status(400).json({ error: 'Escribe con cuánto dinero inicias (0 o más, con máximo 2 decimales).' });
  const contado = dinero(b.contado);
  if (Number.isNaN(contado)) return res.status(400).json({ error: 'El monto contado al cierre no es válido.' });
  if (b.notas != null && (typeof b.notas !== 'string' || b.notas.length > 200)) return res.status(400).json({ error: 'Las notas no pueden pasar de 200 caracteres.' });
  const notas = b.notas ? b.notas.trim() : null;
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const r = await calcular(c, p.desde, p.hasta);
    const saldo = r2(fondo + r.ventas);
    const dif = contado == null ? null : r2(contado - saldo);
    const { rows: [n] } = await c.query(
      `INSERT INTO cortes_caja(desde,hasta,fondo_inicial,ventas,pedidos,desglose,saldo_final,contado,diferencia,notas,usuario_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [p.desde, p.hasta, fondo, r.ventas, r.pedidos, JSON.stringify(r.desglose), saldo, contado, dif, notas || null, req.user.id]);
    await c.query('COMMIT');
    const { rows } = await db.query(`SELECT ${COLS} FROM cortes_caja c LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE c.id=$1`, [n.id]);
    res.status(201).json({ corte: fila(rows[0]) });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}));

module.exports = router;
