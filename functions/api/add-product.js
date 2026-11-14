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
    const { id, name, brand, category, price, stock, description } = body;

    if (!id || !name || price === undefined || stock === undefined) {
      return jsonError('البيانات الأساسية ناقصة (الرمز، الاسم، السعر، الكمية)', 400);
    }

    const existing = await env.DB.prepare(
      "SELECT id FROM products WHERE id = ?"
    ).bind(id).first();

    if (existing) {
      return jsonError(`رمز المنتج (${id}) مستخدم بالفعل، يرجى اختيار رمز آخر.`, 400);
    }

    await env.DB.prepare(
      `INSERT INTO products (id, name, brand, category, price, stock, description, image_url, is_hidden) 
       VALUES (?, ?, ?, ?, ?, ?, ?, '', 0)`
    ).bind(
      id,
      name,
      brand || '',
      category || '',
      price,
      stock,
      description || ''
    ).run();

    return jsonOk({ message: 'تم إضافة المنتج بنجاح' });

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