
export async function onRequest(context) {
  const { env, request } = context;

  if (request.method !== "POST") {
    return jsonError("طريقة غير مدعومة", 405);
  }

  try {
    // 1. التحقق من كلمة مرور المدير
    const authHeader =
      request.headers.get("X-Admin-Password") || "";

    const passRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = ?"
    ).bind("admin_password").first();

    const correctPass = passRow ? passRow.value : "";

    if (!correctPass || authHeader !== correctPass) {
      return jsonError("كلمة المرور غير صحيحة", 401);
    }

    // 2. استقبال البيانات
    const body = await request.json();

    const {
      id,
      name,
      brand,
      category,
      price,
      stock,
      description,
      image_url
    } = body;

    // 3. التحقق من البيانات الأساسية
    if (
      id === undefined ||
      id === null ||
      String(id).trim() === "" ||
      typeof name !== "string" ||
      !name.trim() ||
      price === undefined ||
      stock === undefined
    ) {
      return jsonError(
        "البيانات الأساسية ناقصة (الرمز، الاسم، السعر، الكمية)",
        400
      );
    }

    const productId = String(id).trim();
    const productName = name.trim();
    const productPrice = Number(price);
    const productStock = Number(stock);

    if (
      productId.length > 100 ||
      productId === "." ||
      productId === ".." ||
      /[\/\\]/.test(productId)
    ) {
      return jsonError("رمز المنتج غير صالح", 400);
    }

    if (
      !Number.isFinite(productPrice) ||
      productPrice < 0 ||
      !Number.isInteger(productStock) ||
      productStock < 0
    ) {
      return jsonError("السعر أو الكمية غير صالحين", 400);
    }

    // 4. التحقق من عدم تكرار رمز المنتج
    const existing = await env.DB.prepare(
      "SELECT id FROM products WHERE id = ?"
    ).bind(productId).first();

    if (existing) {
      return jsonError(
        `رمز المنتج (${productId}) مستخدم بالفعل، يرجى اختيار رمز آخر.`,
        400
      );
    }

    // 5. التحقق من صورة المنتج إن وُجد رابط لها
    let finalImageUrl = "";

    if (
      image_url !== undefined &&
      image_url !== null &&
      image_url !== ""
    ) {
      if (typeof image_url !== "string") {
        return jsonError("رابط صورة المنتج غير صالح", 400);
      }

      let parsedImageUrl;

      try {
        parsedImageUrl = new URL(image_url, request.url);
      } catch {
        return jsonError("رابط صورة المنتج غير صالح", 400);
      }

      const expectedPath =
        `/api/image/products/${encodeURIComponent(productId)}.webp`;

      const version = parsedImageUrl.searchParams.get("v");
      const queryEntries = [
        ...parsedImageUrl.searchParams.entries()
      ];

      if (
        parsedImageUrl.origin !== new URL(request.url).origin ||
        parsedImageUrl.pathname !== expectedPath ||
        parsedImageUrl.hash ||
        parsedImageUrl.username ||
        parsedImageUrl.password ||
        queryEntries.length !== 1 ||
        queryEntries[0][0] !== "v" ||
        !version ||
        !/^[a-f0-9]{40}$/i.test(version)
      ) {
        return jsonError("رابط صورة المنتج غير صالح", 400);
      }

      finalImageUrl =
        parsedImageUrl.pathname + parsedImageUrl.search;
    }

    // 6. إضافة المنتج إلى قاعدة البيانات
    await env.DB.prepare(`
      INSERT INTO products
      (id, name, brand, category, price, stock, description, image_url, is_hidden)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(
      productId,
      productName,
      typeof brand === "string" ? brand.trim() : "",
      typeof category === "string" ? category.trim() : "",
      productPrice,
      productStock,
      typeof description === "string" ? description.trim() : "",
      finalImageUrl
    ).run();

    return jsonOk({
      message: "تم إضافة المنتج بنجاح",
      image_url: finalImageUrl
    });

  } catch (err) {
    return jsonError("خطأ: " + err.message, 500);
  }
}

function jsonOk(data) {
  return new Response(JSON.stringify({
    ok: true,
    ...data
  }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function jsonError(msg, status = 400) {
  return new Response(JSON.stringify({
    ok: false,
    error: msg
  }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
