// ── Magic helpers ─────────────────────────────────────────────────────

document.addEventListener('alpine:init', () => {

  Alpine.magic('money', () => (n) => {
    const v = parseFloat(n) || 0;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });

  Alpine.magic('number', () => (n) => {
    const v = parseFloat(n) || 0;
    return Math.round(v).toLocaleString();
  });

  Alpine.magic('datetime', () => (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  });

  Alpine.magic('date', () => (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  });

  Alpine.magic('monthName', () => (m) => {
    const names = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];
    return names[parseInt(m)] ?? '—';
  });

  Alpine.magic('timeAgo', () => (iso) => {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

});

// ── itemCalc: per-item calculations ──────────────────────────────────

function itemCalc(item) {
  const price = parseFloat(item.unit_price) || 0;
  let totalRec = 0, totalIss = 0;
  for (let w = 1; w <= 4; w++) {
    totalRec += parseFloat(item[`w${w}_received`]) || 0;
    totalIss += parseFloat(item[`w${w}_issued`]) || 0;
  }
  const onHand = parseFloat(item.on_hand) || 0;
  const endQty = Math.max(0, onHand + totalRec - totalIss);
  const total = endQty * price;
  const parLevel = parseFloat(item.par_level) || 0;
  const isLow = parLevel > 0 && onHand < parLevel;
  return { totalRec, totalIss, onHand, endQty, total, price, parLevel, isLow };
}

// ── Role helpers ──────────────────────────────────────────────────────

function userCan(minRole) {
  const hierarchy = { staff: 10, assistant: 20, manager: 30, admin: 40 };
  const role = Alpine.store('auth')?.user?.role || 'staff';
  return (hierarchy[role] || 0) >= (hierarchy[minRole] || 0);
}

function roleBadgeClass(role) {
  return {
    admin:     'bg-red-50 text-red-600 border border-red-200',
    manager:   'bg-blue-50 text-blue-600 border border-blue-200',
    assistant: 'bg-purple-50 text-purple-600 border border-purple-200',
    staff:     'bg-slate-100 text-slate-600 border border-slate-200',
  }[role] || 'bg-slate-100 text-slate-600';
}
