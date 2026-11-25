function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toAbsoluteUrl(rawUrl, origin) {
  const clean = String(rawUrl || "").trim();
  if (!clean) return `${origin}/images/logo.png`;

  try {
    const parsed = new URL(clean, origin);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.href;
    }
  } catch {
    return `${origin}/images/logo.png`;
  }

  return `${origin}/images/logo.png`;
}

async function loadStoreMetaSettings(db) {
  if (!db) return {};

  try {
    const result = await db
      .prepare(`
        SELECT key, value
        FROM settings
        WHERE key IN ('store_name_ar', 'store_name_en', 'store_logo_url')
      `)
      .all();

    const map = {};
    for (const row of result?.results || []) {
      if (row && row.key) {
        map[row.key] = row.value || "";
      }
    }
    return map;
  } catch {
    return {};
  }
}

async function resolveOfferShareImage(db, offer, items, origin, fallbackLogoUrl) {
  const safeOfferId = encodeURIComponent(String(offer?.id || "").trim());
  const compositeUrl = safeOfferId
    ? `${origin}/api/image/offer-share/${safeOfferId}.png`
    : "";

  const firstProductId = Array.isArray(items) && items.length > 0
    ? encodeURIComponent(String(items[0]?.product_id || "").trim())
    : "";
  const firstProductUrl = firstProductId
    ? `${origin}/api/image/products/${firstProductId}.webp`
    : "";

  for (const candidate of [compositeUrl, firstProductUrl, fallbackLogoUrl]) {
    const clean = String(candidate || "").trim();
    if (!clean) continue;
    try {
      const res = await fetch(clean, { method: "GET" });
      if (res.ok) {
        const contentType = String(res.headers.get("content-type") || "").toLowerCase();
        if (!contentType || contentType.startsWith("image/")) {
          return clean;
        }
      }
    } catch {
      // ننتقل للخيار الاحتياطي التالي
    }
  }

  return fallbackLogoUrl || `${origin}/images/logo.png`;
}

async function loadOfferShareMeta(db, offerId, origin, fallbackLogoUrl, storeName) {
  if (!db || !offerId) return null;

  try {
    const offer = await db
      .prepare("SELECT * FROM offers WHERE id = ? LIMIT 1")
      .bind(offerId)
      .first();

    if (!offer) return null;

    const itemsResult = await db
      .prepare(
        `SELECT oi.*, p.name as product_name, p.price as product_price
         FROM offer_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.offer_id = ?`
      )
      .bind(offer.id)
      .all();

    const items = itemsResult?.results || [];

    let originalTotal = 0;
    for (const item of items) {
      const qty = Number(item.quantity || 1);
      const price = Number(item.product_price || 0);
      originalTotal += qty * price;
    }

    let finalPrice = originalTotal;
    if (Number(offer.manual_price) > 0) {
      finalPrice = Number(offer.manual_price);
    } else if (Number(offer.discount_percent) > 0) {
      finalPrice = originalTotal - originalTotal * (Number(offer.discount_percent) / 100);
    }

    const discountPercent =
      originalTotal > 0
        ? Math.round(((originalTotal - finalPrice) / originalTotal) * 100)
        : 0;

    const itemsSummary = items
      .map((item) => {
        const qty = Number(item.quantity || 1);
        const name = String(item.product_name || "").trim();
        return qty > 1 ? `${name} (${qty})` : name;
      })
      .filter(Boolean)
      .join(" + ");

    const offerTitle = String(offer.title || "عرض مميز").trim();
    const title = storeName ? `${offerTitle} | ${storeName}` : offerTitle;

    const priceParts = [];
    if (finalPrice > 0) {
      priceParts.push(`السعر النهائي: ${finalPrice}`);
    }
    if (originalTotal > finalPrice && originalTotal > 0) {
      priceParts.push(`بدلاً من ${originalTotal}`);
    }
    if (discountPercent > 0) {
      priceParts.push(`توفير ${discountPercent}%`);
    }

    const description =
      [itemsSummary, priceParts.join(" | "), storeName]
        .filter(Boolean)
        .join(" — ") || offerTitle;

    const imageUrl = await resolveOfferShareImage(
      db,
      offer,
      items,
      origin,
      fallbackLogoUrl
    );

    const sharePageUrl = `${origin}/offers.html?offer=${encodeURIComponent(
      String(offer.id)
    )}#offer-${encodeURIComponent(String(offer.id))}`;

    return {
      title,
      description,
      imageUrl,
      url: sharePageUrl
    };
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { env, request, next } = context;
  const url = new URL(request.url);

  const cleanPath = url.pathname.replace(/\/+$/, "") || "/";
  const isHomePage = cleanPath === "/" || cleanPath === "/index.html";
  const isOffersPageWithId =
    (cleanPath === "/offers.html" || cleanPath === "/offers") &&
    Boolean(String(url.searchParams.get("offer") || "").trim());

  if (!isHomePage && !isOffersPageWithId) {
    return next();
  }

  const response = await next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  let html = await response.text();

  try {
    const settings = await loadStoreMetaSettings(env?.DB);

    const nameAr = String(settings.store_name_ar || "").trim();
    const nameEn = String(settings.store_name_en || "").trim();
    const storeName = [nameAr, nameEn].filter(Boolean).join(" | ") || "المتجر";
    const logoUrl = toAbsoluteUrl(settings.store_logo_url, url.origin);

    let fullTitle = storeName;
    let description = [nameAr, nameEn].filter(Boolean).join(" - ") || "المتجر";
    let shareImageUrl = logoUrl;
    let sharePageUrl = `${url.origin}/`;

    if (isOffersPageWithId) {
      const offerId = String(url.searchParams.get("offer") || "").trim();
      const offerMeta = await loadOfferShareMeta(
        env?.DB,
        offerId,
        url.origin,
        logoUrl,
        storeName
      );
      if (offerMeta) {
        fullTitle = offerMeta.title;
        description = offerMeta.description;
        shareImageUrl = offerMeta.imageUrl;
        sharePageUrl = offerMeta.url;
      }
    }

    const safeTitle = escapeHtml(fullTitle);
    const safeDesc = escapeHtml(description);
    const safeLogo = escapeHtml(shareImageUrl);
    const safeUrl = escapeHtml(sharePageUrl);

    html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`);

    const tags = [
      {
        pattern: /<meta[^>]*name=["']description["'][^>]*>/i,
        replacement: `<meta name="description" content="${safeDesc}">`
      },
      {
        pattern: /<meta[^>]*property=["']og:site_name["'][^>]*>/i,
        replacement: `<meta property="og:site_name" content="${safeTitle}">`
      },
      {
        pattern: /<meta[^>]*property=["']og:title["'][^>]*>/i,
        replacement: `<meta property="og:title" content="${safeTitle}">`
      },
      {
        pattern: /<meta[^>]*property=["']og:description["'][^>]*>/i,
        replacement: `<meta property="og:description" content="${safeDesc}">`
      },
      {
        pattern: /<meta[^>]*property=["']og:image["'][^>]*>/i,
        replacement: `<meta property="og:image" content="${safeLogo}">`
      },
      {
        pattern: /<meta[^>]*property=["']og:url["'][^>]*>/i,
        replacement: `<meta property="og:url" content="${safeUrl}">`
      },
      {
        pattern: /<meta[^>]*name=["']twitter:title["'][^>]*>/i,
        replacement: `<meta name="twitter:title" content="${safeTitle}">`
      },
      {
        pattern: /<meta[^>]*name=["']twitter:description["'][^>]*>/i,
        replacement: `<meta name="twitter:description" content="${safeDesc}">`
      },
      {
        pattern: /<meta[^>]*name=["']twitter:image["'][^>]*>/i,
        replacement: `<meta name="twitter:image" content="${safeLogo}">`
      }
    ];

    for (const item of tags) {
      if (item.pattern.test(html)) {
        html = html.replace(item.pattern, item.replacement);
      } else {
        html = html.replace(/<\/head>/i, `  ${item.replacement}\n</head>`);
      }
    }
  } catch {
    // في حال أي خطأ بالاستعلام، نعيد الصفحة الأصلية بدون تعطيل
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}