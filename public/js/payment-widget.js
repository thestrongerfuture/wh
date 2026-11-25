
// ============================================================
// payment-widget.js
// منطق زر طرق الدفع وتحميل طرق الدفع من API
// يُحمَّل في index.html / new.html / offers.html
// ============================================================

(function () {
  const API_BASE = '/api';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `
      position:fixed; bottom:100px; left:50%; transform:translateX(-50%);
      background:#0A2472; color:#fff; padding:12px 24px; border-radius:8px;
      z-index:9999; font-weight:600; box-shadow:0 4px 12px rgba(0,0,0,0.3);
      direction:rtl; font-size:0.9rem; max-width:90vw; text-align:center;
    `;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  // ---------- زر طرق الدفع ----------
  const btn = document.getElementById('paymentMethodBtn');
  const modal = document.getElementById('paymentMethodsModal');
  const list = document.getElementById('paymentMethodsList');
  const empty = document.getElementById('paymentMethodsEmpty');
  const closeBtn = document.getElementById('closePaymentMethods');

  if (!btn || !modal) return;

  async function loadMethods() {
    if (!list) return;

    try {
      const res = await fetch(`${API_BASE}/payment-methods`);
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'فشل الجلب');
      }

      render(data.methods || []);

    } catch (e) {
      list.innerHTML = `<p style="color:#dc2626; text-align:center;">❌ ${escapeHtml(e.message)}</p>`;
    }
  }

  function render(methods) {
    list.innerHTML = '';

    if (!methods.length) {
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    methods.forEach(m => {
      const card = document.createElement('div');

      card.style.cssText = 'background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; padding:12px 16px; cursor:pointer; transition:all 0.15s;';

      card.innerHTML = `
        <div style="font-weight:700; color:var(--primary); margin-bottom:4px;">
          ${escapeHtml(m.name)}
        </div>
        <div style="font-size:0.85rem; color:#666; word-break:break-all;">
          ${escapeHtml(m.details)}
        </div>
      `;

      card.onmouseenter = () => {
        card.style.background = '#eff6ff';
        card.style.borderColor = 'var(--primary)';
      };

      card.onmouseleave = () => {
        card.style.background = '#f9fafb';
        card.style.borderColor = '#e5e7eb';
      };

      card.onclick = async () => {
        try {
          await navigator.clipboard.writeText(m.details);
          showToast(`✅ تم نسخ تفاصيل: ${m.name}`);

        } catch {
          const ta = document.createElement('textarea');

          ta.value = m.details;
          document.body.appendChild(ta);
          ta.select();

          try {
            document.execCommand('copy');
            showToast(`✅ تم نسخ تفاصيل: ${m.name}`);
          } catch {
            showToast('❌ فشل النسخ');
          }

          ta.remove();
        }
      };

      list.appendChild(card);
    });
  }

  btn.onclick = () => {
    modal.classList.remove('hidden');
    loadMethods();
  };

  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.add('hidden');
  }

  modal.addEventListener('click', e => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });

})();
