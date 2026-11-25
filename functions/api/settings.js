// ============================================================
// settings.js
// API لإدارة إعدادات المتجر وتغيير كلمة مرور المدير
// ============================================================

const PUBLIC_ALLOWED_SETTINGS = [
  'whatsapp_number',
  'orders_whatsapp_number',
  'facebook_url',
  'instagram_url',
  'google_maps_url',
  'store_address',
  'community_whatsapp_enabled',
  'community_whatsapp_url',
  'community_whatsapp_tooltip',
  'store_name_ar',
  'store_name_en',
  'store_logo_url',
  'store_brand_palette',
  'store_brand_palette_active',
  'store_currency',
  'store_timezone',
  'watermark_enabled',
  'watermark_type',
  'watermark_text',
  'watermark_image_url',
  'watermark_opacity'
];

export async function onRequest(context) {
  const { env, request } = context;
  const method = request.method;

  try {
    // ---------- GET ----------
    if (method === 'GET') {
      const url = new URL(request.url);
      const admin = url.searchParams.get('admin') === '1';

      if (admin) {
        const auth = request.headers.get('X-Admin-Password') || '';
        const passRow = await env.DB.prepare(
          "SELECT value FROM settings WHERE key = 'admin_password'"
        ).first();

        if (!passRow || auth !== passRow.value) {
          return jsonError('كلمة المرور غير صحيحة', 401);
        }

        // عدم إرسال كلمة مرور المدير إلى المتصفح
        const rows = await env.DB.prepare(
          "SELECT key, value FROM settings WHERE key != 'admin_password'"
        ).all();

        const out = {};
        rows.results.forEach(r => {
          out[r.key] = r.value;
        });

        return jsonOk({ settings: out });
      }

      const placeholders = PUBLIC_ALLOWED_SETTINGS.map(() => '?').join(',');
      const rows = await env.DB.prepare(
        `SELECT key, value FROM settings WHERE key IN (${placeholders})`
      ).bind(...PUBLIC_ALLOWED_SETTINGS).all();

      const out = {};
      rows.results.forEach(r => {
        out[r.key] = r.value;
      });

      return jsonOk({ settings: out });
    }

    // ---------- POST ----------
    if (method === 'POST') {
      const auth = request.headers.get('X-Admin-Password') || '';

      const passRow = await env.DB.prepare(
        "SELECT value FROM settings WHERE key = 'admin_password'"
      ).first();

      if (!passRow || auth !== passRow.value) {
        return jsonError('كلمة المرور الحالية غير صحيحة', 401);
      }

      const body = await request.json();

      // ---------- تغيير كلمة مرور المدير ----------
      if (body.action === 'change_password') {
        const newPassword = String(body.newPassword || '');

        if (newPassword.length < 6) {
          return jsonError('يجب أن تكون كلمة المرور الجديدة 6 أحرف على الأقل');
        }

        await env.DB.prepare(
          "UPDATE settings SET value = ? WHERE key = 'admin_password'"
        ).bind(newPassword).run();

        return jsonOk({ message: 'تم تغيير كلمة مرور المدير بنجاح' });
      }

      // ---------- حفظ إعدادات المتجر العادية ----------
      const updates = body.settings || {};
      const stmts = [];

      for (const key of Object.keys(updates)) {
        if (!PUBLIC_ALLOWED_SETTINGS.includes(key)) continue;

        let value;

        if (key === 'store_brand_palette') {
          let palette;

          try {
            palette = typeof updates[key] === 'string'
              ? JSON.parse(updates[key])
              : updates[key];
          } catch {
            return jsonError('صيغة لوحة ألوان الهوية غير صحيحة');
          }

          if (
            !palette ||
            typeof palette !== 'object' ||
            Array.isArray(palette)
          ) {
            return jsonError('بيانات لوحة ألوان الهوية غير صحيحة');
          }

          const colorKeys = [
            'primary',
            'secondary',
            'accent',
            'background',
            'surface',
            'text'
          ];

          const cleanPalette = {};

          for (const colorKey of colorKeys) {
            const color = palette[colorKey];

            if (color === undefined || color === null || color === '') {
              continue;
            }

            if (
              typeof color !== 'string' ||
              !/^#[0-9a-fA-F]{6}$/.test(color)
            ) {
              return jsonError(
                `قيمة اللون ${colorKey} غير صحيحة`
              );
            }

            cleanPalette[colorKey] = color.toUpperCase();
          }

          if (Object.keys(cleanPalette).length === 0) {
            return jsonError('لوحة الألوان لا تحتوي على ألوان صالحة');
          }

          value = JSON.stringify(cleanPalette);

        } else if (key === 'store_brand_palette_active') {
          value = String(updates[key]);

          if (value !== '1' && value !== '0') {
            return jsonError(
              'قيمة تفعيل ألوان الشعار يجب أن تكون 1 أو 0'
            );
          }

        } else if (key === 'watermark_enabled') {
          value = String(updates[key]) === '1' ? '1' : '0';

        } else if (key === 'watermark_type') {
          const t = String(updates[key] ?? 'text').trim();
          if (!['text', 'logo', 'image'].includes(t)) {
            return jsonError('نوع العلامة المائية غير صالح');
          }
          value = t;

        } else if (key === 'watermark_opacity') {
          let num = parseFloat(updates[key]);
          if (Number.isNaN(num)) num = 0.10;
          num = Math.min(0.40, Math.max(0.05, num));
          value = num.toFixed(2);

        } else if (
          key === 'watermark_text' ||
          key === 'watermark_image_url' ||
          key === 'instagram_url'
        ) {
          value = String(updates[key] ?? '').trim();

        } else if (key === 'store_currency') {
          value = String(updates[key] ?? '').trim();

        } else if (key === 'store_timezone') {
          value = String(updates[key] ?? '').trim();

        } else {
          value = String(updates[key]);
        }

        stmts.push(
          env.DB.prepare(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
          ).bind(key, value)
        );
      }

      if (stmts.length === 0) {
        return jsonError('لا توجد حقول صالحة للتحديث');
      }

      await env.DB.batch(stmts);

      return jsonOk({ message: 'تم حفظ الإعدادات' });
    }

    return jsonError('طريقة غير مدعومة', 405);

  } catch (err) {
    return jsonError('خطأ في الخادم: ' + err.message, 500);
  }
}

function jsonOk(data) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function jsonError(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}