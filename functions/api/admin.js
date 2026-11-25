export async function onRequest(context) {
  const { env, request } = context;
  const method = request.method;

  try {
    // ---------- 1) التحقق من كلمة المرور ----------
    const authHeader = request.headers.get('X-Admin-Password') || '';
    const passRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'admin_password'"
    ).first();
    const correctPass = passRow ? passRow.value : '';

    if (!correctPass || authHeader !== correctPass) {
      return jsonError('كلمة المرور غير صحيحة', 401);
    }

    // ---------- 2) GET: جلب الطلبات المعلقة ----------
    if (method === 'GET') {
      const status = new URL(request.url).searchParams.get('status') || 'pending';

      const rawOrders = await env.DB.prepare(
        'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC'
      ).bind(status).all();

      const ordersWithItems = await Promise.all(rawOrders.results.map(async (o) => {
        const items = await env.DB.prepare(
          `SELECT oi.*, 
                  COALESCE(p.name, oi.item_name, 'عرض') as name,
                  COALESCE(p.stock, 9999) as stock
           FROM order_items oi 
           LEFT JOIN products p ON p.id = oi.product_id 
           WHERE oi.order_id = ?`
        ).bind(o.id).all();
        return { ...o, items: items.results };
      }));

      return jsonOk({ orders: ordersWithItems });
    }

    // ---------- 3) POST: إجراء على طلب ----------
    if (method === 'POST') {

const body = await request.json();
const { action, order_id, items, deleted_item_ids } = body;

// ---------- حذف الطلبات حسب الحالة ----------
if (action === 'delete_status') {
  const allowedStatuses = ['pending', 'approved', 'rejected'];

  if (!allowedStatuses.includes(body.status)) {
    return jsonError('حالة الطلبات غير صحيحة', 400);
  }

  const status = body.status;

  // معرفة عدد الطلبات المطابقة قبل الحذف
  const countResult = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM orders WHERE status = ?'
  ).bind(status).first();

  const total = countResult ? countResult.total : 0;

  if (total === 0) {
    return jsonOk({
      message: 'لا توجد طلبات بهذه الحالة',
      deleted: 0
    });
  }

  // حذف أصناف الطلبات أولاً، ثم حذف الطلبات نفسها
  const deleteItems = env.DB.prepare(
    'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE status = ?)'
  ).bind(status);

  const deleteOrders = env.DB.prepare(
    'DELETE FROM orders WHERE status = ?'
  ).bind(status);

  await env.DB.batch([deleteItems, deleteOrders]);

  return jsonOk({
    message: 'تم حذف الطلبات بنجاح',
    deleted: total
  });
}

if (!order_id) return jsonError('order_id مطلوب', 400);

      // حفظ التعديلات على الفاتورة بدون خصم المخزون أو تغيير الحالة
      if (action === 'save') {
        const orderRow = await env.DB.prepare(
          'SELECT * FROM orders WHERE id = ?'
        ).bind(order_id).first();
        if (!orderRow) return jsonError('الطلب غير موجود', 404);
        if (orderRow.status !== 'pending') return jsonError('لا يمكن تعديل طلب غير معلق', 400);

        const stmts = [];

        if (Array.isArray(deleted_item_ids) && deleted_item_ids.length > 0) {
          for (const itemId of deleted_item_ids) {
            stmts.push(
              env.DB.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?')
                .bind(itemId, order_id)
            );
          }
        }

        if (Array.isArray(items)) {
          for (const it of items) {
            if (Array.isArray(deleted_item_ids) && it.id && deleted_item_ids.includes(it.id)) continue;

            const qty = Math.max(1, parseInt(it.quantity, 10) || 1);

            if (it.id) {
              stmts.push(
                env.DB.prepare('UPDATE order_items SET quantity = ? WHERE id = ? AND order_id = ?')
                  .bind(qty, it.id, order_id)
              );
            } else if (it.offer_id) {
              stmts.push(
                env.DB.prepare('UPDATE order_items SET quantity = ? WHERE order_id = ? AND offer_id = ?')
                  .bind(qty, order_id, it.offer_id)
              );
            } else if (it.product_id) {
              stmts.push(
                env.DB.prepare('UPDATE order_items SET quantity = ? WHERE order_id = ? AND product_id = ?')
                  .bind(qty, order_id, it.product_id)
              );
            }
          }
        }

        if (stmts.length > 0) {
          await env.DB.batch(stmts);
        }

        const remainingItems = await env.DB.prepare(
          'SELECT SUM(quantity * price) as new_total FROM order_items WHERE order_id = ?'
        ).bind(order_id).first();

        const finalTotal = (remainingItems && remainingItems.new_total) ? remainingItems.new_total : 0;

        await env.DB.prepare('UPDATE orders SET total = ? WHERE id = ?')
          .bind(finalTotal, order_id).run();

        return jsonOk({ message: 'تم حفظ تعديلات الفاتورة بنجاح', total: finalTotal });
      }


      // الموافقة
      if (action === 'approve') {
        const orderRow = await env.DB.prepare(
          'SELECT * FROM orders WHERE id = ?'
        ).bind(order_id).first();
        if (!orderRow) return jsonError('الطلب غير موجود', 404);
        if (orderRow.status !== 'pending') return jsonError('الطلب ليس معلقاً', 400);

        const orderItems = await env.DB.prepare(
          'SELECT * FROM order_items WHERE order_id = ?'
        ).bind(order_id).all();

        const itemsToUse = items || orderItems.results;

        const stmts = [];

        // أ) حذف الأصناف التي اختار المدير حذفها
        if (deleted_item_ids && deleted_item_ids.length > 0) {
          for (const itemId of deleted_item_ids) {
            stmts.push(env.DB.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?')
              .bind(itemId, order_id));
          }
        }

        // ب) معالجة الكميات المتبقية وخصم المخزون
        for (const it of itemsToUse) {
          // تجاهل الأصناف المحذوفة من الحساب
          if (deleted_item_ids && it.id && deleted_item_ids.includes(it.id)) continue;

          if (it.offer_id) {
            const offerItems = await env.DB.prepare(
              'SELECT product_id, quantity FROM offer_items WHERE offer_id = ?'
            ).bind(it.offer_id).all();
            
            for (const oi of offerItems.results) {
              const p = await env.DB.prepare('SELECT stock, name FROM products WHERE id = ?')
                .bind(oi.product_id).first();
              if (!p) return jsonError(`منتج في العرض (${oi.product_id}) غير موجود`, 400);
              
              const requiredQty = oi.quantity * it.quantity;
              
              if (p.stock < requiredQty) {
                return jsonError(`المخزون غير كافٍ للمنتج "${p.name}" (المطلوب: ${requiredQty}, المتاح: ${p.stock})`, 400);
              }
              
              stmts.push(env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
                .bind(requiredQty, oi.product_id));
            }
            
            stmts.push(env.DB.prepare('UPDATE order_items SET quantity = ? WHERE order_id = ? AND offer_id = ?')
              .bind(it.quantity, order_id, it.offer_id));
              
          } else {
            const p = await env.DB.prepare('SELECT stock, name FROM products WHERE id = ?')
              .bind(it.product_id).first();
            if (!p) return jsonError(`المنتج ${it.product_id} غير موجود`, 400);
            if (p.stock < it.quantity) {
              return jsonError(`المخزون غير كافٍ للمنتج "${p.name}" (المطلوب: ${it.quantity}, المتاح: ${p.stock})`, 400);
            }
            
            stmts.push(env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
              .bind(it.quantity, it.product_id));
            stmts.push(env.DB.prepare('UPDATE order_items SET quantity = ? WHERE order_id = ? AND product_id = ?')
              .bind(it.quantity, order_id, it.product_id));
          }
        }
        
        stmts.push(env.DB.prepare("UPDATE orders SET status = 'approved' WHERE id = ?")
          .bind(order_id));

        await env.DB.batch(stmts);

        // ج) إعادة حساب الإجمالي للطلب بعد الحذف والتعديلات
        const remainingItems = await env.DB.prepare(
          'SELECT SUM(quantity * price) as new_total FROM order_items WHERE order_id = ?'
        ).bind(order_id).first();
        
        const finalTotal = (remainingItems && remainingItems.new_total) ? remainingItems.new_total : 0;
        
        await env.DB.prepare('UPDATE orders SET total = ? WHERE id = ?')
          .bind(finalTotal, order_id).run();

        return jsonOk({ message: 'تمت الموافقة وخصم المخزون' });
      }

      // الرفض
      if (action === 'reject') {
        const r = await env.DB.prepare(
          "UPDATE orders SET status = 'rejected' WHERE id = ? AND status = 'pending'"
        ).bind(order_id).run();
        if (!r.success || r.meta.changes === 0) return jsonError('لم يتم الرفض (ربما الطلب غير معلق)', 400);
        return jsonOk({ message: 'تم رفض الطلب' });
      }

      return jsonError('إجراء غير معروف', 400);
    }

    return jsonError('طريقة غير مدعومة', 405);
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
