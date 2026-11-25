
const GITHUB_OWNER = "thestrongerfuture";
const GITHUB_REPO = "wh";
const GITHUB_BRANCH = "main";
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

    // 2. استقبال معرّف المنتج
    const body = await request.json();
    const id = body.id;

    if (
      id === undefined ||
      id === null ||
      String(id).trim() === ""
    ) {
      return jsonError("معرّف المنتج مطلوب", 400);
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

    // 3. التأكد من وجود المنتج
    const product = await env.DB.prepare(
      "SELECT id, image_url FROM products WHERE id = ?"
    ).bind(productId).first();

    if (!product) {
      return jsonError("المنتج غير موجود", 404);
    }

    // 4. التحقق من ارتباط المنتج بالطلبات السابقة
    const orderCheck = await env.DB.prepare(
      "SELECT id FROM order_items WHERE product_id = ? LIMIT 1"
    ).bind(productId).first();

    if (orderCheck) {
      return jsonError(
        "لا يمكن حذف هذا المنتج لأنه مرتبط بطلب أو فاتورة سابقة.",
        400
      );
    }

    // 5. التحقق من ارتباط المنتج بالعروض
    const offerCheck = await env.DB.prepare(
      "SELECT offer_id FROM offer_items WHERE product_id = ? LIMIT 1"
    ).bind(productId).first();

    if (offerCheck) {
      return jsonError(
        "لا يمكن حذف هذا المنتج لأنه موجود ضمن أحد العروض.",
        400
      );
    }

    // 6. تجهيز حذف صورة المنتج إن وجدت
    let imagePath = null;
    let imageVersion = null;

    if (product.image_url) {
      const token = env.GITHUB_ASSETS_TOKEN;

      if (!token) {
        return jsonError(
          "إعدادات الاتصال بمستودع الصور غير جاهزة. لم يتم حذف المنتج.",
          503
        );
      }

      let parsedImageUrl;

      try {
        parsedImageUrl = new URL(
          product.image_url,
          request.url
        );
      } catch {
        return jsonError(
          "رابط صورة المنتج غير صالح. لم يتم حذف المنتج.",
          409
        );
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
        return jsonError(
          "رابط صورة المنتج لا يطابق مسار التخزين المتوقع. لم يتم حذف المنتج.",
          409
        );
      }

      imagePath = `products/${productId}.webp`;
      imageVersion = version;
    }

    // 7. حذف الصورة من GitHub أولاً
    if (imagePath) {
      const encodedPath = imagePath
        .split("/")
        .map(part => encodeURIComponent(part))
        .join("/");

      const githubApiUrl =
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}?ref=${GITHUB_BRANCH}`;

      const githubHeaders = {
        "Authorization": `Bearer ${env.GITHUB_ASSETS_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Elsaadany-Store"
      };

      // جلب SHA الخاص بملف الصورة
      let fileResponse;

      try {
        fileResponse = await fetch(githubApiUrl, {
          method: "GET",
          headers: githubHeaders
        });
      } catch {
        return jsonError(
          "تعذر الاتصال بمستودع الصور. لم يتم حذف المنتج.",
          503
        );
      }

      if (!fileResponse.ok) {
        return jsonError(
          fileResponse.status === 404
            ? "صورة المنتج غير موجودة في مستودع الصور. لم يتم حذف المنتج."
            : "تعذر التحقق من صورة المنتج في مستودع الصور. لم يتم حذف المنتج.",
          fileResponse.status === 404 ? 409 : 503
        );
      }

      let fileData;

      try {
        fileData = await fileResponse.json();
      } catch {
        return jsonError(
          "تعذر قراءة بيانات صورة المنتج. لم يتم حذف المنتج.",
          502
        );
      }

      if (!fileData || !fileData.sha) {
        return jsonError(
          "تعذر الحصول على بيانات الصورة اللازمة للحذف.",
          502
        );
      }

      // حذف الصورة باستخدام SHA
      let deleteResponse;

      try {
        deleteResponse = await fetch(githubApiUrl, {
          method: "DELETE",
          headers: {
            ...githubHeaders,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: `Delete product image ${productId}`,
            sha: fileData.sha,
            branch: GITHUB_BRANCH
          })
        });
      } catch {
        return jsonError(
          "تعذر الاتصال بمستودع الصور لحذف الصورة. لم يتم حذف المنتج.",
          503
        );
      }

      if (!deleteResponse.ok) {
        return jsonError(
          "فشل حذف صورة المنتج من مستودع الصور. لم يتم حذف المنتج.",
          503
        );
      }
    }

    // 8. حذف المنتج من قاعدة البيانات بعد نجاح حذف الصورة
    await env.DB.prepare(
      "DELETE FROM products WHERE id = ?"
    ).bind(productId).run();

    return jsonOk({
      message: imagePath
        ? "تم حذف المنتج وصورته بنجاح"
        : "تم حذف المنتج بنجاح، ولم تكن له صورة مسجلة",
      image_deleted: Boolean(imagePath)
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
