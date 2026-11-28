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
  'secondary_currency_enabled',
  'secondary_currency_symbol',
  'exchange_rate_source_url',
  'manual_syp_rate',
  'syp_rounding_step',
  'fetched_syp_rate',
  'exchange_rate_updated_at',
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

      await maybeRefreshSypRate(env, out, false);

      if (String(out.secondary_currency_enabled || '0') === '1') {
        out.store_currency = String(out.secondary_currency_symbol ?? '').trim();
        const fetched = parseFloat(out.fetched_syp_rate || '');
        const manual = parseFloat(out.manual_syp_rate || '');
        const activeRate = (!Number.isNaN(fetched) && fetched > 0)
          ? fetched
          : ((!Number.isNaN(manual) && manual > 0) ? manual : 1);
        out.active_exchange_rate = String(activeRate);
      } else {
        out.active_exchange_rate = '1';
      }

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

      // ---------- جلب سعر الصرف الآن ----------
      if (body.action === 'fetch_exchange_rate') {
        const sourceUrl = String(
          body.sourceUrl || 'https://www.sp-today.com/'
        ).trim() || 'https://www.sp-today.com/';

        const manualFallback = String(body.manualRate ?? '').trim();
        const result = await fetchAndStoreSypRate(env, sourceUrl, manualFallback);

        if (!result.rate) {
          return jsonError(
            result.error || 'تعذر جلب سعر الصرف من الرابط ولا يوجد سعر يدوي احتياطي'
          );
        }

        return jsonOk({
          message: result.fromManual
            ? 'تم اعتماد السعر اليدوي الاحتياطي'
            : 'تم جلب سعر مبيع الليرة السورية الجديدة بنجاح',
          rate: result.rate,
          updatedAt: result.updatedAt,
          fromManual: result.fromManual
        });
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

        } else if (key === 'secondary_currency_enabled') {
          value = String(updates[key]) === '1' ? '1' : '0';

        } else if (key === 'secondary_currency_symbol') {
          value = String(updates[key] ?? '').trim();

        } else if (key === 'exchange_rate_source_url') {
          value = String(updates[key] ?? '').trim() || 'https://www.sp-today.com/';

        } else if (key === 'manual_syp_rate' || key === 'fetched_syp_rate') {
          const raw = String(updates[key] ?? '').trim();
          if (raw === '') {
            value = '';
          } else {
            const num = parseFloat(raw);
            if (Number.isNaN(num) || num <= 0) {
              return jsonError('قيمة سعر الصرف غير صالحة');
            }
            value = String(num);
          }

        } else if (key === 'syp_rounding_step') {
          const step = String(updates[key] ?? '0').trim();
          if (!['0', '1', '5', '10', '50'].includes(step)) {
            return jsonError('قيمة التقريب غير صالحة');
          }
          value = step;

        } else if (key === 'exchange_rate_updated_at') {
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

const FIVE_MINUTES_MS = 5 * 60 * 1000;

async function maybeRefreshSypRate(env, out, force = false) {
  const enabled = String(out.secondary_currency_enabled || '0') === '1';
  if (!enabled && !force) return;

  const lastUpdatedRaw = out.exchange_rate_updated_at || '';
  const lastUpdatedMs = lastUpdatedRaw ? Date.parse(lastUpdatedRaw) : 0;
  const isStale = !lastUpdatedMs || (Date.now() - lastUpdatedMs >= FIVE_MINUTES_MS);

  if (!force && !isStale && out.fetched_syp_rate) {
    return;
  }

  const sourceUrl = String(out.exchange_rate_source_url || '').trim() || 'https://www.sp-today.com/';
  const manualFallback = String(out.manual_syp_rate || '').trim();

  const res = await fetchAndStoreSypRate(env, sourceUrl, manualFallback);
  if (res.rate) {
    out.fetched_syp_rate = String(res.rate);
    out.exchange_rate_updated_at = res.updatedAt;
  }
}

async function fetchAndStoreSypRate(env, sourceUrl, manualFallback = '') {
  const nowIso = new Date().toISOString();
  let parsedRate = null;

  try {
    const resp = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StoreCurrencyBot/1.0)',
        'Accept': 'text/html,application/json,*/*'
      }
    });

    if (resp.ok) {
      const text = await resp.text();
      parsedRate = extractNewSypSellRate(text);
    }
  } catch {
    parsedRate = null;
  }

  const fallbackNum = parseFloat(manualFallback);
  const finalRate = (parsedRate && parsedRate > 0)
    ? parsedRate
    : ((!Number.isNaN(fallbackNum) && fallbackNum > 0) ? fallbackNum : null);

  if (!finalRate) {
    return {
      rate: null,
      updatedAt: nowIso,
      fromManual: false,
      error: 'تعذر قراءة سعر المبيع من المصدر ولا يوجد سعر يدوي احتياطي'
    };
  }

  const fromManual = !(parsedRate && parsedRate > 0);

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind('fetched_syp_rate', String(finalRate)),
    env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind('exchange_rate_updated_at', nowIso)
  ]);

  return {
    rate: finalRate,
    updatedAt: nowIso,
    fromManual
  };
}

function extractNewSypSellRate(rawText) {
  if (!rawText) return null;

  // إزالة وسوم HTML وتحويل الكيانات الشائعة
  const plain = rawText
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();

  // البحث عن سعر المبيع لليرة الجديدة قرب الدولار الأمريكي
  const patterns = [
    /(?:USD|دولار\s*أمريكي)[\s\S]{0,160}?(?:مبيع|بيع)[^\d]{0,25}(\d{1,5}(?:[.,]\d{1,2})?)/i,
    /(?:ل\.س\s*جديدة|جديدة)[\s\S]{0,120}?(?:مبيع|بيع)[^\d]{0,25}(\d{1,5}(?:[.,]\d{1,2})?)/i
  ];

  for (const re of patterns) {
    const match = plain.match(re);
    if (match && match[1]) {
      const cleaned = parseFloat(match[1].replace(/,/g, ''));
      if (!Number.isNaN(cleaned) && cleaned > 0 && cleaned < 10000) {
        return cleaned;
      }
    }
  }

  return null;
}