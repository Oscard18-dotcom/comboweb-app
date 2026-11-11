// Validación de la tarjeta de la pasarela SIMULADA. Nada de esto cobra dinero.
// El número completo y el CVV se revisan en memoria y NUNCA se guardan ni se imprimen: solo la marca y los últimos 4 dígitos.
const MESES = (hoyMX) => ({ anio: Number(hoyMX.slice(0, 4)), mes: Number(hoyMX.slice(5, 7)) });

const luhn = (n) => { let s = 0, alt = false; for (let i = n.length - 1; i >= 0; i--) { let d = Number(n[i]); if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; } return s % 10 === 0; };
const marcaDe = (n) => (/^4/.test(n) ? 'Visa' : /^(5[1-5]|2[2-7])/.test(n) ? 'Mastercard' : /^3[47]/.test(n) ? 'American Express' : 'Tarjeta');

// Tarjetas de prueba (todas válidas por Luhn)
const RECHAZOS = { '4000000000000002': 'El banco rechazó la tarjeta (simulado).', '4000000000009995': 'Fondos insuficientes (simulado).' };
const PRUEBAS = [
  { numero: '4242 4242 4242 4242', resultado: 'Pago aprobado (Visa)' },
  { numero: '5555 5555 5555 4444', resultado: 'Pago aprobado (Mastercard)' },
  { numero: '4000 0000 0000 0002', resultado: 'Tarjeta rechazada por el banco' },
  { numero: '4000 0000 0000 9995', resultado: 'Fondos insuficientes' },
];

// Devuelve { errores: {campo: mensaje} } o { marca, ultimos4, rechazo? }
function validar(t, hoyMX) {
  const errores = {};
  const b = t && typeof t === 'object' ? t : {};
  const titular = typeof b.titular === 'string' ? b.titular.trim().replace(/\s+/g, ' ') : '';
  if (titular.length < 3 || titular.length > 60 || !/^[\p{L}][\p{L} .'-]*$/u.test(titular)) errores.titular = 'Escribe el nombre como aparece en la tarjeta.';
  const numero = typeof b.numero === 'string' ? b.numero.replace(/[\s-]/g, '') : '';
  if (!/^\d{13,19}$/.test(numero) || !luhn(numero)) errores.numero = 'El número de tarjeta no es válido.';
  const m = typeof b.vence === 'string' ? b.vence.trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/) : null;
  if (!m) errores.vence = 'Escribe la fecha como MM/AA.';
  else {
    const mes = Number(m[1]), anio = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    const hoy = MESES(hoyMX);
    if (mes < 1 || mes > 12) errores.vence = 'El mes debe ser de 01 a 12.';
    else if (anio < hoy.anio || (anio === hoy.anio && mes < hoy.mes)) errores.vence = 'La tarjeta está vencida.';
    else if (anio > hoy.anio + 20) errores.vence = 'La fecha de vencimiento no es válida.';
  }
  const amex = /^3[47]/.test(numero);
  if (typeof b.cvv !== 'string' || !(amex ? /^\d{4}$/ : /^\d{3}$/).test(b.cvv)) errores.cvv = amex ? 'El código de seguridad tiene 4 dígitos.' : 'El código de seguridad tiene 3 dígitos.';
  if (Object.keys(errores).length) return { errores };
  return { marca: marcaDe(numero), ultimos4: numero.slice(-4), rechazo: RECHAZOS[numero] || null };
}
module.exports = { validar, luhn, PRUEBAS };
