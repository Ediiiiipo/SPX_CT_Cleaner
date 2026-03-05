// ============================================================
// SPX CT Cleaner — Popup (Lógica Principal)
// ============================================================
const $ = id => document.getElementById(id);
let allCTs = [];       // { id, status, cluster, date }
let filteredCTs = [];
let activeFilter = 'all';

// ---- Logging ----
function log(msg, type = '') {
  const t = new Date().toLocaleTimeString('pt-BR');
  const el = document.createElement('div');
  el.className = `log-entry ${type}`;
  el.innerHTML = `<span class="log-time">[${t}]</span>${msg}`;
  $('logBody').appendChild(el);
  $('logBody').scrollTop = $('logBody').scrollHeight;
}

// ---- Connection Check ----
async function checkConnection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes('spx.shopee.com.br')) {
      $('statusDot').classList.add('ok');
      $('statusText').textContent = 'Conectado ao SPX';
      return true;
    }
  } catch(e) {}
  $('statusDot').classList.remove('ok');
  $('statusText').textContent = 'Abra o SPX primeiro';
  return false;
}

// ---- Run in page MAIN world ----
async function runInTab(fn, args = []) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN', func: fn, args
  });
  return results?.[0]?.result;
}

// ============================================================
// SCAN: Read CTs from the page DOM
// ============================================================
function scanCTsFromPage() {
  try {
    const rows = document.querySelectorAll('table > tbody:nth-child(3) > tr');
    if (!rows || rows.length === 0) {
      // Try alternative selector
      const allRows = document.querySelectorAll('.ssc-table-body table tbody tr');
      if (!allRows || allRows.length === 0) return [];
    }

    const cts = [];
    const targetRows = rows && rows.length > 0 ? rows :
      document.querySelectorAll('.ssc-table-body table tbody tr');

    targetRows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 5) return;

      // Find CT ID (starts with CTBR)
      let ctId = '';
      let status = '';
      let cluster = '';
      let date = '';

      cells.forEach((cell, idx) => {
        const text = (cell.innerText || '').trim();
        if (text.startsWith('CTBR')) ctId = text;
        if (text.includes('Pending Calculate') || text.includes('Cálculo Pendente')) status = 'pending';
        if (text.includes('Pending Confirm') || text.includes('Confirmação pendente') || text.includes('Confirmação Pendente')) status = 'confirm';
        if (text.includes('Calculating') || text.includes('Calculando')) status = 'calculating';
        if (text.includes('Confirmed') || text.includes('Confirmado')) status = 'confirmed';
        if (text.includes('Failed') || text.includes('Falha')) status = 'failed';
        // Cluster name (usually has a dot like "02. Alvorada")
        if (/^\d{2}\.\s/.test(text)) cluster = text;
        // Date
        if (/^\d{2}-\d{2}-\d{4}/.test(text)) date = text;
      });

      if (ctId) {
        cts.push({ id: ctId, status: status || 'unknown', cluster, date });
      }
    });

    return cts;
  } catch(e) {
    return [];
  }
}

// ============================================================
// CANCEL: Call API to cancel a CT
// ============================================================
function cancelCT(taskId) {
  return new Promise(async (resolve) => {
    try {
      const getCookie = (n) => {
        const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + n + '=([^;]*)'));
        return m ? m[1] : '';
      };
      const res = await fetch('/api/spx/lmroute/adminapi/calculation_task/cancel', {
        method: 'POST',
        headers: {
          'accept': 'application/json, text/plain, */*',
          'content-type': 'application/json;charset=UTF-8',
          'app': 'FMS Portal',
          'x-csrftoken': getCookie('csrftoken'),
          'device-id': getCookie('spx-admin-device-id')
        },
        credentials: 'include',
        body: JSON.stringify({ calculation_task_id: taskId, calculation_task_version: 0 })
      });
      const data = await res.json();
      resolve(data.retcode === 0 ? { success: true } : { success: false, error: data.message || `retcode ${data.retcode}` });
    } catch(e) {
      resolve({ success: false, error: e.message });
    }
  });
}

// ============================================================
// UI UPDATES
// ============================================================
function updateUI() {
  // Apply filter
  if (activeFilter === 'all') {
    filteredCTs = allCTs.filter(ct => ct.status !== 'confirmed');
  } else {
    filteredCTs = allCTs.filter(ct => ct.status === activeFilter);
  }

  $('ctCount').textContent = filteredCTs.length;
  $('btnCancel').disabled = filteredCTs.length === 0;

  // Status breakdown
  const pending = allCTs.filter(c => c.status === 'pending').length;
  const confirm = allCTs.filter(c => c.status === 'confirm').length;
  const calculating = allCTs.filter(c => c.status === 'calculating').length;
  const confirmed = allCTs.filter(c => c.status === 'confirmed').length;
  const other = allCTs.length - pending - confirm - calculating - confirmed;

  let detail = [];
  if (pending) detail.push(`⏳ ${pending} Cálc. Pendente`);
  if (confirm) detail.push(`⏳ ${confirm} Confirm. Pendente`);
  if (calculating) detail.push(`🔄 ${calculating} Calculando`);
  if (confirmed) detail.push(`✅ ${confirmed} Confirmado`);
  if (other) detail.push(`❓ ${other} Outros`);
  $('ctDetail').textContent = detail.join('  |  ') || 'Nenhuma CT encontrada';
}

// ============================================================
// EVENT LISTENERS
// ============================================================

// Log toggle
$('logToggle').addEventListener('click', () => {
  $('logToggle').classList.toggle('open');
  $('logBody').classList.toggle('open');
});

// Filters
function setFilter(filter, btnId) {
  activeFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.remove('active', 'active-blue', 'active-warn');
  });
  $(btnId).classList.add(filter === 'pending' ? 'active' : filter === 'confirm' ? 'active-blue' : filter === 'calculating' ? 'active-warn' : 'active');
  updateUI();
}

$('fAll').addEventListener('click', () => setFilter('all', 'fAll'));
$('fPending').addEventListener('click', () => setFilter('pending', 'fPending'));
$('fConfirm').addEventListener('click', () => setFilter('confirm', 'fConfirm'));
$('fCalculating').addEventListener('click', () => setFilter('calculating', 'fCalculating'));

// Scan button
$('btnScan').addEventListener('click', async () => {
  const connected = await checkConnection();
  if (!connected) { alert('Abra o SPX primeiro!'); return; }

  $('btnScan').disabled = true;
  $('btnScan').innerHTML = '<div class="spinner-sm"></div> Buscando...';
  log('Buscando CTs na página...', '');

  allCTs = await runInTab(scanCTsFromPage) || [];
  log(`${allCTs.length} CTs encontradas`, allCTs.length > 0 ? 'success' : 'warn');

  if (allCTs.length > 0) {
    allCTs.forEach(ct => {
      log(`${ct.id} | ${ct.cluster || '-'} | ${ct.status}`, '');
    });
  }

  updateUI();
  $('btnScan').disabled = false;
  $('btnScan').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Buscar CTs na Página';
});

// Cancel button
$('btnCancel').addEventListener('click', async () => {
  if (filteredCTs.length === 0) return;

  const msg = `Cancelar ${filteredCTs.length} CT(s)?\n\nEssa ação NÃO pode ser desfeita!`;
  if (!confirm(msg)) return;

  $('btnCancel').disabled = true;
  $('btnCancel').innerHTML = '<div class="spinner-sm"></div> Cancelando...';
  $('progressBar').style.display = 'block';
  $('progressText').style.display = 'block';
  $('result').style.display = 'none';

  // Open logs
  $('logToggle').classList.add('open');
  $('logBody').classList.add('open');

  let success = 0, errors = 0;
  const total = filteredCTs.length;

  log(`Iniciando cancelamento de ${total} CTs...`, '');

  for (let i = 0; i < total; i++) {
    const ct = filteredCTs[i];
    const pct = Math.round(((i + 1) / total) * 100);
    $('progressFill').style.width = `${pct}%`;
    $('progressText').textContent = `${i + 1}/${total} — ${ct.id}`;

    const res = await runInTab(cancelCT, [ct.id]);
    if (res?.success) {
      success++;
      log(`✅ ${ct.id} cancelada`, 'success');
    } else {
      errors++;
      log(`❌ ${ct.id}: ${res?.error || 'erro'}`, 'error');
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 150));
  }

  // Show result
  $('result').style.display = 'block';
  $('resultText').textContent = `${success} CTs canceladas com sucesso!`;
  $('resultDetail').textContent = errors > 0 ? `${errors} erro(s)` : 'Nenhum erro';
  log(`Concluído: ${success} canceladas, ${errors} erros`, success > 0 ? 'success' : 'error');

  // Reset
  $('btnCancel').disabled = false;
  $('btnCancel').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Cancelar CTs Selecionadas';

  // Clear list
  allCTs = [];
  filteredCTs = [];
  updateUI();
  $('ctCount').textContent = success;
  $('ctDetail').textContent = 'CTs canceladas — clique "Buscar" para atualizar';
});

// ---- Init ----
checkConnection();
