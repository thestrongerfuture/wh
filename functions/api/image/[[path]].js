const GITHUB_OWNER = "thestrongerfuture";
const GITHUB_REPO = "wh";
const GITHUB_BRANCH = "main";

export async function onRequestGet({ params, env }) {
  try {
    const pathParts = params.path;

    if (!Array.isArray(pathParts) || pathParts.length === 0) {
      return imageError("مسار الصورة غير صالح", 400);
    }

    const joinedPath = pathParts.join("/");
    let targetPath;
    let expectedMime;

    if (
      joinedPath === "Logo.png" ||
      joinedPath === "public/images/Logo.png" ||
      joinedPath === "store/Logo.png" ||
      joinedPath === "Watermark.png" ||
      joinedPath === "public/images/Watermark.png" ||
      joinedPath === "store/Watermark.png"
    ) {
      targetPath = joinedPath;
      expectedMime = "image/png";
    } else if (
      pathParts.length === 1 &&
      pathParts[0].endsWith(".webp")
    ) {
      const productId = pathParts[0].slice(0, -5);
      if (!productId || productId === "." || productId === "..") {
        return imageError("معرّف المنتج غير صالح", 400);
      }
      targetPath = pathParts[0];
      expectedMime = "image/webp";
    } else if (
      pathParts.length === 2 &&
      pathParts[0] === "products" &&
      pathParts[1].endsWith(".webp")
    ) {
      const productId = pathParts[1].slice(0, -5);
      if (!productId || productId === "." || productId === "..") {
        return imageError("معرّف المنتج غير صالح", 400);
      }
      targetPath = `products/${pathParts[1]}`;
      expectedMime = "image/webp";
    } else if (
      pathParts.length === 2 &&
      pathParts[0] === "offer-share" &&
      (pathParts[1].endsWith(".png") || pathParts[1].endsWith(".svg"))
    ) {
      const isPng = pathParts[1].endsWith(".png");
      const rawId = pathParts[1].slice(0, -4);
      const offerId = decodeURIComponent(rawId).trim();
      if (!offerId || offerId === "." || offerId === "..") {
        return imageError("معرّف العرض غير صالح", 400);
      }
      if (isPng) {
        return await buildOfferCompositePngResponse(offerId, env);
      }
      return await buildOfferCompositeSvgResponse(offerId, env);
    } else {
      return imageError("مسار الصورة غير مسموح", 404);
    }

    const encodedPath = targetPath
      .split("/")
      .map(segment => encodeURIComponent(segment))
      .join("/");

    const githubImageUrl =
      `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${encodedPath}`;

    const upstreamResponse = await fetch(githubImageUrl, {
      method: "GET"
    });

    if (!upstreamResponse.ok) {
      return imageError(
        upstreamResponse.status === 404
          ? "الصورة غير موجودة"
          : "تعذر جلب الصورة من مستودع الصور",
        upstreamResponse.status === 404 ? 404 : 502
      );
    }

    const contentType = (
      upstreamResponse.headers.get("Content-Type") || ""
    ).split(";")[0].trim().toLowerCase();

    if (contentType !== expectedMime) {
      return imageError("نوع الصورة المسترجعة غير متوقع", 502);
    }

    const headers = new Headers();
    headers.set("Content-Type", expectedMime);
    headers.set("Cache-Control", "no-cache");
    headers.set("X-Content-Type-Options", "nosniff");

    const contentLength = upstreamResponse.headers.get("Content-Length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(upstreamResponse.body, {
      status: 200,
      headers
    });
  } catch (error) {
    return imageError(
      "حدث خطأ أثناء عرض الصورة: " + (error?.message || ""),
      500
    );
  }
}

export async function onRequest({ request, env }) {
  if (request.method === "GET") {
    return imageError("حدث خطأ في معالجة طلب الصورة", 500);
  }

  return imageError("طريقة الطلب غير مسموحة", 405);
}

async function buildOfferCompositeSvgResponse(offerId, env) {
  try {
    const db = env?.DB;
    if (!db) {
      return imageError("قاعدة البيانات غير متاحة", 500);
    }

    const offer = await db
      .prepare("SELECT * FROM offers WHERE id = ? LIMIT 1")
      .bind(offerId)
      .first();

    if (!offer) {
      return imageError("العرض غير موجود", 404);
    }

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

    const topItems = items.slice(0, 3);
    const thumbDataUrls = [];

    for (const item of topItems) {
      const pid = String(item.product_id || "").trim();
      if (!pid || pid === "." || pid === "..") {
        thumbDataUrls.push("");
        continue;
      }
      const encodedPid = encodeURIComponent(pid);
      const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/products/${encodedPid}.webp`;
      try {
        const res = await fetch(rawUrl, { method: "GET" });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          thumbDataUrls.push(`data:image/webp;base64,${base64}`);
        } else {
          thumbDataUrls.push("");
        }
      } catch {
        thumbDataUrls.push("");
      }
    }

    const esc = (val) =>
      String(val ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const titleText = esc(String(offer.title || "عرض مميز").trim());
    const itemsLineText = esc(
      items
        .map((it) => {
          const q = Number(it.quantity || 1);
          const n = String(it.product_name || "").trim();
          return q > 1 ? `${n} (${q})` : n;
        })
        .filter(Boolean)
        .join(" + ")
    );
    const finalPriceText = esc(finalPrice > 0 ? `${finalPrice}` : "عرض خاص");
    const oldPriceText =
      originalTotal > finalPrice && originalTotal > 0
        ? esc(`بدلاً من ${originalTotal}`)
        : "";
    const discountBadgeText =
      discountPercent > 0 ? esc(`خصم ${discountPercent}%`) : "";

    const slots = [0, 1, 2].map((idx) => {
      const x = 60 + idx * 365;
      const y = 175;
      const w = 330;
      const h = 290;
      const imgHref = thumbDataUrls[idx] ? esc(thumbDataUrls[idx]) : "";
      const label = esc(String(topItems[idx]?.product_name || "").trim());

      return `
        <g>
          <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>
          ${
            imgHref
              ? `<image href="${imgHref}" x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${h - 64}" preserveAspectRatio="xMidYMid slice"/>`
              : `<rect x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${h - 64}" rx="14" fill="#f1f5f9"/>`
          }
          <text x="${x + w / 2}" y="${y + h - 20}" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="600" fill="#1e293b">${label}</text>
        </g>
      `;
    }).join("");

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#eef2ff"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bgGrad)"/>
  <rect x="30" y="30" width="1140" height="570" rx="28" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>

  <text x="1120" y="95" text-anchor="end" font-family="sans-serif" font-size="38" font-weight="700" fill="#0f172a">${titleText}</text>
  <text x="1120" y="138" text-anchor="end" font-family="sans-serif" font-size="22" fill="#475569">${itemsLineText}</text>

  ${slots}

  <rect x="60" y="495" width="1080" height="76" rx="18" fill="#0f172a"/>
  <text x="1110" y="544" text-anchor="end" font-family="sans-serif" font-size="30" font-weight="700" fill="#ffffff">السعر: ${finalPriceText}</text>
  ${
    oldPriceText
      ? `<text x="770" y="543" text-anchor="end" font-family="sans-serif" font-size="24" fill="#cbd5e1" text-decoration="line-through">${oldPriceText}</text>`
      : ""
  }
  ${
    discountBadgeText
      ? `<rect x="85" y="509" width="185" height="48" rx="12" fill="#16a34a"/><text x="177" y="541" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="700" fill="#ffffff">${discountBadgeText}</text>`
      : ""
  }
</svg>`;

    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (err) {
    return imageError("حدث خطأ أثناء تجهيز صورة العرض: " + (err?.message || ""), 500);
  }
}

async function buildOfferCompositePngResponse(offerId, env) {
  try {
    const db = env?.DB;
    if (!db) {
      return imageError("قاعدة البيانات غير متاحة", 500);
    }

    const offer = await db
      .prepare("SELECT * FROM offers WHERE id = ? LIMIT 1")
      .bind(offerId)
      .first();

    if (!offer) {
      return imageError("العرض غير موجود", 404);
    }

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

    const offerImageCandidates = [
      `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/offers/${encodeURIComponent(String(offer.id))}.png`,
      `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/offers/${encodeURIComponent(String(offer.id))}.webp`
    ];

    for (const offerImgUrl of offerImageCandidates) {
      try {
        const res = await fetch(offerImgUrl, { method: "GET" });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const mimeType = offerImgUrl.endsWith(".png") ? "image/png" : "image/webp";
          return new Response(buf, {
            status: 200,
            headers: {
              "Content-Type": mimeType,
              "Cache-Control": "no-cache",
              "X-Content-Type-Options": "nosniff"
            }
          });
        }
      } catch {
        // نكمل للخيار التالي
      }
    }

    for (const item of items) {
      const pid = String(item?.product_id || "").trim();
      if (!pid || pid === "." || pid === "..") {
        continue;
      }
      const encodedPid = encodeURIComponent(pid);
      const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/products/${encodedPid}.webp`;
      try {
        const res = await fetch(rawUrl, { method: "GET" });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          return new Response(buf, {
            status: 200,
            headers: {
              "Content-Type": "image/webp",
              "Cache-Control": "no-cache",
              "X-Content-Type-Options": "nosniff"
            }
          });
        }
      } catch {
        // نكمل للمنتج التالي
      }
    }

    const logoUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/Logo.png`;
    const logoRes = await fetch(logoUrl, { method: "GET" });
    if (logoRes.ok) {
      const logoBuf = await logoRes.arrayBuffer();
      return new Response(logoBuf, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }

    return imageError("تعذر تجهيز صورة العرض", 404);
  } catch (err) {
    return imageError("حدث خطأ أثناء تجهيز صورة العرض: " + (err?.message || ""), 500);
  }
}

function imageError(message, status) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
