export async function onRequest(context) {
  const { env, request } = context;

  if (request.method !== 'POST') {
    return jsonError('طريقة غير مدعومة', 405);
  }

  try {
    const authHeader = request.headers.get('X-Admin-Password') || '';
    const passRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'admin_password'"
    ).first();
    const correctPass = passRow ? passRow.value : '';

    if (!correctPass || authHeader !== correctPass) {
      return jsonError('كلمة المرور غير صحيحة', 401);
    }

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return jsonError('معرف المنتج مطلوب', 400);
    }

    const orderCheck = await env.DB.prepare(
      'SELECT id FROM order_items WHERE product_id = ? LIMIT 1'
    ).bind(id).first();

    if (orderCheck) {
      return jsonError('لا يمكن حذف هذا المنتج لأنه مرتبط بطلب أو فاتورة سابقة.', 400);
    }

    const offerCheck = await env.DB.prepare(
      'SELECT offer_id FROM offer_items WHERE product_id = ? LIMIT 1'
    ).bind(id).first();

    if (offerCheck) {
      return jsonError('لا يمكن حذف هذا المنتج لأنه موجود ضمن أحد العروض المتاحة.', 400);
    }

    await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();

    return jsonOk({ message: 'تم حذف المنتج بنجاح' });

  } catch (err) {
    return jsonError('خطأ: ' + err.message, 500);
  }
}

function jsonOk(data) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
function jsonError(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}