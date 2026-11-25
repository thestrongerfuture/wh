// ============================================================
// payment-methods.js
// API لإدارة طرق الدفع (GET للعامة، POST/DELETE للمدير)
// ============================================================

export async function onRequest(context) {
  const { env, request } = context;
  const method = request.method;

  try {
    // ---------- GET: جلب الطرق النشطة (للزبون) ----------
    if (method === 'GET') {
      const url = new URL(request.url);
      const admin = url.searchParams.get('admin') === '1';

      if (admin) {
        // المدير يرى الكل
        const auth = request.headers.get('X-Admin-Password') || '';
        const passRow = await env.DB.prepare(
          "SELECT value FROM settings WHERE key = 'admin_password'"
        ).first();
        if (!passRow || auth !== passRow.value) {
          return jsonError('كلمة المرور غير صحيحة', 401);
        }
        const rows = await env.DB.prepare(
          'SELECT * FROM payment_methods ORDER BY sort_order ASC, id ASC'
        ).all();
        return jsonOk({ methods: rows.results });
      }

      // الزبون يرى النشط فقط
      const rows = await env.DB.prepare(
        'SELECT id, name, details, sort_order FROM payment_methods WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
      ).all();
      return jsonOk({ methods: rows.results });
    }

    // ---------- POST/DELETE: تتطلب كلمة مرور ----------
    const auth = request.headers.get('X-Admin-Password') || '';
    const passRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'admin_password'"
    ).first();
    if (!passRow || auth !== passRow.value) {
      return jsonError('كلمة المرور غير صحيحة', 401);
    }

    // ---------- POST: إضافة أو تعديل ----------
    if (method === 'POST') {
      const body = await request.json();
      const { id, name, details, is_active, sort_order } = body;

      if (!name || !details) {
        return jsonError('الاسم والتفاصيل مطلوبان');
      }

      if (id) {
        // تعديل
        await env.DB.prepare(
          'UPDATE payment_methods SET name = ?, details = ?, is_active = ?, sort_order = ? WHERE id = ?'
        ).bind(name, details, is_active ? 1 : 0, sort_order || 0, id).run();
        return jsonOk({ message: 'تم التعديل' });
      } else {
        // إضافة
        await env.DB.prepare(
          'INSERT INTO payment_methods (name, details, is_active, sort_order) VALUES (?, ?, ?, ?)'
        ).bind(name, details, is_active ? 1 : 0, sort_order || 0).run();
        return jsonOk({ message: 'تمت الإضافة' });
      }
    }

    // ---------- DELETE: حذف ----------
    if (method === 'DELETE') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (!id) return jsonError('id مطلوب');
      await env.DB.prepare('DELETE FROM payment_methods WHERE id = ?').bind(id).run();
      return jsonOk({ message: 'تم الحذف' });
    }

    return jsonError('طريقة غير مدعومة', 405);
  } catch (err) {
    return jsonError('خطأ في الخادم: ' + err.message, 500);
  }
}

function jsonOk(data) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
function jsonError(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
