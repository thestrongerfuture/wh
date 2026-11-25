
export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    // 1. التحقق من طريقة الطلب
    if (request.method !== "POST") {
      return jsonError("طريقة الطلب غير مدعومة", 405);
    }

    // 2. التحقق من كلمة مرور المدير
    const authHeader =
      request.headers.get("X-Admin-Password") || "";

    const passRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = ?"
    ).bind("admin_password").first();

    if (!passRow || !passRow.value || authHeader !== passRow.value) {
      return jsonError("كلمة المرور غير صحيحة", 401);
    }

    // 3. استقبال البيانات
    const body = await request.json();

    const {
      id,
      name,
      price,
      stock,
      description,
      created_at,
      image_url
    } = body;

    // 4. التحقق من صحة البيانات
    if (
      id === undefined ||
      id === null ||
      String(id).trim() === "" ||
      typeof name !== "string" ||
      !name.trim() ||
      price === undefined ||
      !Number.isFinite(Number(price)) ||
      stock === undefined ||
      !Number.isInteger(Number(stock)) ||
      Number(price) < 0 ||
      Number(stock) < 0
    ) {
      return jsonError("الحقول المطلوبة ناقصة أو غير صالحة", 400);
    }

    const productId = String(id).trim();

    if (
      productId.length > 100 ||
      productId === "." ||
      productId === ".." ||
      /[\/\\]/.test(productId)
    ) {
      return jsonError("معرّف المنتج غير صالح", 400);
    }

    // 5. التحقق من وجود المنتج
    const existing = await env.DB.prepare(
      "SELECT id, image_url FROM products WHERE id = ?"
    ).bind(productId).first();

    if (!existing) {
      return jsonError("لم يتم العثور على المنتج", 404);
    }

    // 6. تجهيز رابط الصورة
    // عدم إرسال image_url يحافظ على الصورة الحالية
    let finalImageUrl = existing.image_url || "";

    if (Object.prototype.hasOwnProperty.call(body, "image_url")) {

      // السماح بمسح الصورة عند إرسال قيمة فارغة
      if (
        image_url === null ||
        image_url === ""
      ) {
        finalImageUrl = "";

      } else {
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
    }

    // 7. تحديث بيانات المنتج
    let sql = `
      UPDATE products
      SET name = ?,
          price = ?,
          stock = ?,
          description = ?,
          image_url = ?
    `;

    const params = [
      name.trim(),
      Number(price),
      Number(stock),
      typeof description === "string" ? description.trim() : "",
      finalImageUrl
    ];

    if (created_at) {
      sql += ", created_at = ?";
      params.push(created_at);
    }

    sql += " WHERE id = ?";
    params.push(productId);

    await env.DB.prepare(sql).bind(...params).run();

    return new Response(JSON.stringify({
      ok: true,
      message: "تم تعديل المنتج بنجاح",
      image_url: finalImageUrl
    }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });

  } catch (err) {
    return jsonError("خطأ: " + err.message, 500);
  }
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
