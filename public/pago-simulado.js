const $ = (s) => document.querySelector(s);
const id = new URLSearchParams(location.search).get('checkout');
let token = null;
try { token = sessionStorage.getItem('t'); } catch (e) { /* sin almacenamiento */ }
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const er = new Error(j.error || 'Ocurrió un error.'); er.campos = j.campos; throw er; }
  return j;
}
const CAMPOS = ['titular', 'numero', 'vence', 'cvv'];
const limpiarErrores = () => { $('#err').textContent = ''; CAMPOS.forEach((c) => { $('#e-' + c).textContent = ''; $('#' + c).removeAttribute('aria-invalid'); }); };
const marcar = (c, msg) => { $('#e-' + c).textContent = msg; $('#' + c).setAttribute('aria-invalid', 'true'); };

// Formato mientras se escribe: "4242 4242 4242 4242" y "MM/AA"
$('#numero').addEventListener('input', (ev) => { const d = ev.target.value.replace(/\D/g, '').slice(0, 19); ev.target.value = d.replace(/(.{4})/g, '$1 ').trim(); });
$('#vence').addEventListener('input', (ev) => { const d = ev.target.value.replace(/\D/g, '').slice(0, 4); ev.target.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; });
$('#cvv').addEventListener('input', (ev) => { ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 4); });

// Revisión rápida en el navegador (el servidor vuelve a validar todo)
function revisar() {
  limpiarErrores(); let ok = true;
  if ($('#titular').value.trim().length < 3) { marcar('titular', 'Escribe el nombre como aparece en la tarjeta.'); ok = false; }
  if ($('#numero').value.replace(/\D/g, '').length < 13) { marcar('numero', 'El número de tarjeta está incompleto.'); ok = false; }
  if (!/^\d{2}\/\d{2}$/.test($('#vence').value)) { marcar('vence', 'Escribe la fecha como MM/AA.'); ok = false; }
  if ($('#cvv').value.length < 3) { marcar('cvv', 'Escribe el código de seguridad.'); ok = false; }
  return ok;
}

(async () => {
  if (!id || !token) { $('#err').textContent = 'Inicia sesión en el sitio y vuelve a intentar el pago.'; return; }
  try {
    const { checkout } = await api('/pedidos/checkout/' + encodeURIComponent(id));
    $('#total').textContent = 'Total a pagar: ' + Number(checkout.total).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    $('#aprobar').disabled = $('#rechazar').disabled = checkout.estado !== 'creado';
    if (checkout.estado !== 'creado') $('#err').textContent = 'Este pago ya fue procesado.';
  } catch (e) { $('#err').textContent = e.message; return; }
  try {
    const { tarjetas } = await api('/pagos/simulado/tarjetas-prueba');
    const cuerpo = $('#pruebas tbody');
    tarjetas.forEach((t) => { const tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td'); a.textContent = t.numero; b.textContent = t.resultado; tr.append(a, b); cuerpo.append(tr); });
  } catch (e) { /* la lista es solo una ayuda */ }

  $('#form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!revisar()) return;
    $('#aprobar').disabled = true; $('#aprobar').textContent = 'Procesando…';
    try {
      await api(`/pagos/simulado/${id}/aprobar`, 'POST', { tarjeta: { titular: $('#titular').value, numero: $('#numero').value, vence: $('#vence').value, cvv: $('#cvv').value } });
      $('#cvv').value = ''; $('#numero').value = '';
      location.assign('/?checkout=' + id);
    } catch (e) {
      if (e.campos) { Object.entries(e.campos).forEach(([c, m]) => CAMPOS.includes(c) && marcar(c, m)); }
      $('#err').textContent = e.message;
      $('#aprobar').disabled = false; $('#aprobar').textContent = 'Pagar (simulado)'; $('#cvv').value = '';
    }
  });
  $('#rechazar').onclick = async () => { try { await api(`/pagos/simulado/${id}/rechazar`, 'POST'); location.assign('/?cancelado=' + id); } catch (e) { $('#err').textContent = e.message; } };
})();
