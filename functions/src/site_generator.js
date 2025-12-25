const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/https");

// ★ 新しいホスティング先のベースURL
const NEW_SITE_BASE_URL = "https://kotarokaseko.github.io/bilikmatch_tenant";

function generateListingHTML(data, postId) {
    const title = `${data.condominiumName} in ${data.location} | BilikMatch`;
    const description = data.description || "Find your perfect room with BilikMatch.";
    const keywords = [
        ...(data.search_tag || []),
        ...(data.manualTags || []),
        data.condominiumName,
        data.location
    ].join(", ");

    const ogImage = (data.imageUrls && data.imageUrls.length > 0)
        ? data.imageUrls[0]
        : "https://bilikmatch.com/assets/default-og.jpg";

    const schemaData = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Accommodation",
        "name": data.condominiumName,
        "description": description,
        "address": data.location,
        "image": ogImage,
        "priceRange": `RM ${data.rent}`,
    });

    // ★ リダイレクト先のURLを構築 (静的サイトのクエリパラメータ形式)
    const redirectUrl = `${NEW_SITE_BASE_URL}/features/property_detail.html?id=${postId}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <meta name="description" content="${description}">
    <meta name="keywords" content="${keywords}">

    <link rel="canonical" href="https://bilikmatch.com/listing/${postId}">
    
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://bilikmatch.com/listing/${postId}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${ogImage}">

    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:title" content="${title}">
    <meta property="twitter:description" content="${description}">
    <meta property="twitter:image" content="${ogImage}">

    <script type="application/ld+json">
      ${schemaData}
    </script>

    <script>
      const userAgent = navigator.userAgent.toLowerCase();
      // 一般的なボットに加え、LINEやWhatsAppなどのプレビューボットも判定
      const isBot = /bot|googlebot|crawler|spider|robot|crawling|facebookexternalhit|whatsapp|line/i.test(userAgent);

      if (!isBot) {
          // ★ 人間のユーザーは新しいGitHub PagesのURLへ転送
          window.location.replace("${redirectUrl}");
      }
    </script>
</head>
<body>
    <h1>${data.condominiumName}</h1>
    <p>${description}</p>
    <img src="${ogImage}" alt="${data.condominiumName}" />
    <ul>
      <li>Rent: RM ${data.rent}</li>
      <li>Location: ${data.location}</li>
    </ul>
    <p><a href="${redirectUrl}">Click here if you are not redirected...</a></p>
</body>
</html>`;
}

// Listing書き込みトリガー (変更なし、ロジックはそのまま)
exports.onListingWrite = onDocumentWritten(
    {
        document: "posts/{postId}",
        region: "us-central1",
    },
    async (event) => {
        const BUCKET_NAME = "whatsappclone-5ad8f.firebasestorage.app";
        const bucket = admin.storage().bucket(BUCKET_NAME);

        if (!event.data || !event.data.after.exists) {
            const file = bucket.file(`posts/${event.params.postId}.html`);
            try {
                await file.delete();
                console.log("Deleted HTML for:", event.params.postId);
            } catch (e) { console.log("Error deleting:", e.message); }
            return;
        }

        const newData = event.data.after.data();
        const oldData = event.data.before.data();

        const isSEOContentChanged =
            !oldData ||
            JSON.stringify(newData.search_tag) !== JSON.stringify(oldData.search_tag) ||
            newData.description !== oldData.description ||
            newData.condominiumName !== oldData.condominiumName;

        if (isSEOContentChanged) {
            console.log(`Generating HTML for ${event.params.postId}...`);
            const html = generateListingHTML(newData, event.params.postId);
            const file = bucket.file(`posts/${event.params.postId}.html`);
            await file.save(html, {
                contentType: "text/html",
                public: true,
                metadata: { cacheControl: "public, max-age=3600" }
            });
            console.log(`✅ HTML saved.`);
        }
    }
);

// 全生成用関数 (変更なし)
exports.generateAllListings = onRequest(
    {
        region: "us-central1",
        timeoutSeconds: 540,
        memory: "512MiB",
    },
    async (req, res) => {
        const BUCKET_NAME = "whatsappclone-5ad8f.firebasestorage.app";
        const bucket = admin.storage().bucket(BUCKET_NAME);
        const db = admin.firestore();

        try {
            const snapshot = await db.collection("posts").get();
            if (snapshot.empty) { res.status(200).send("No posts."); return; }

            const promises = snapshot.docs.map(async (doc) => {
                const data = doc.data();
                if (!data.condominiumName) return;
                const html = generateListingHTML(data, doc.id); // 新しいgenerateListingHTMLを使用
                const file = bucket.file(`posts/${doc.id}.html`);
                await file.save(html, {
                    contentType: "text/html",
                    public: true,
                    metadata: { cacheControl: "public, max-age=3600" }
                });
            });
            await Promise.all(promises);
            res.status(200).send(`Success! Generated HTML for ${snapshot.size} posts.`);
        } catch (error) {
            res.status(500).send(`Error: ${error.message}`);
        }
    }
);

// サイトマップ生成 (変更点: URLを新しいサイトに向けるか、今のままにするか)
// ★今の運用なら「bilikmatch.com/listing/XXX」が入り口なので、ここは変更しなくてOKです。
exports.generateSitemap = onRequest(
    { region: "us-central1", timeoutSeconds: 300, memory: "256MiB" },
    async (req, res) => {
        const BUCKET_NAME = "whatsappclone-5ad8f.firebasestorage.app";
        const bucket = admin.storage().bucket(BUCKET_NAME);
        const db = admin.firestore();

        try {
            // ベースURLはFirebase Hosting (リンク生成元) のままにしておきます
            let xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
   <url>
      <loc>https://bilikmatch.com/</loc>
      <priority>1.0</priority>
   </url>`;

            const snapshot = await db.collection("posts").select().get();
            const today = new Date().toISOString().split('T')[0];

            snapshot.forEach(doc => {
                xmlContent += `
   <url>
      <loc>https://bilikmatch.com/listing/${doc.id}</loc>
      <lastmod>${today}</lastmod>
   </url>`;
            });
            xmlContent += `</urlset>`;

            const file = bucket.file("sitemap.xml");
            await file.save(xmlContent, {
                contentType: "application/xml",
                public: true,
                metadata: { cacheControl: "public, max-age=3600" }
            });
            res.status(200).send(`Sitemap generated.`);
        } catch (error) { res.status(500).send(error.message); }
    }
);

// テナントプロフィール用HTML生成
function generateTenantHTML(data, userId) {
    const title = `${data.displayName} is looking for a room in ${data.location} | BilikMatch`;
    const description = `Budget: RM${data.budget} | Age: ${data.age}`;
    const ogImage = data.profileImageUrl || "https://bilikmatch.com/assets/default-avatar.png";

    // ★ リダイレクト先: features/tenant_detail.html?id=... (このファイルを作成してください)
    const redirectUrl = `${NEW_SITE_BASE_URL}/features/tenant_detail.html?id=${userId}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="https://bilikmatch.com/tenant/${userId}">
    
    <meta property="og:type" content="profile">
    <meta property="og:url" content="https://bilikmatch.com/tenant/${userId}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${ogImage}">
    <meta property="twitter:card" content="summary">

    <script>
      const userAgent = navigator.userAgent.toLowerCase();
      const isBot = /bot|googlebot|crawler|spider|robot|crawling|facebookexternalhit|whatsapp/i.test(userAgent);

      if (!isBot) {
          window.location.replace("${redirectUrl}");
      }
    </script>
</head>
<body>
    <h1>${data.displayName}</h1>
    <p>${description}</p>
    <img src="${ogImage}" />
    <p><a href="${redirectUrl}">View Profile</a></p>
</body>
</html>`;
}

// テナント書き込みトリガー (ロジックはそのまま)
exports.onTenantProfileWrite = onDocumentWritten(
    { document: "users_prof/{userId}", region: "us-central1" },
    async (event) => {
        const BUCKET_NAME = "whatsappclone-5ad8f.firebasestorage.app";
        const bucket = admin.storage().bucket(BUCKET_NAME);

        if (!event.data || !event.data.after.exists) {
            const file = bucket.file(`tenants/${event.params.userId}.html`);
            try { await file.delete(); } catch (e) {}
            return;
        }

        const newData = event.data.after.data();
        const oldData = event.data.before.data();

        if (newData.role !== 'tenant') return;

        const isContentChanged = !oldData || newData.displayName !== oldData.displayName || newData.location !== oldData.location;

        if (isContentChanged) {
            console.log(`Generating Tenant HTML...`);
            const html = generateTenantHTML(newData, event.params.userId); // 新しいgenerateTenantHTMLを使用
            const file = bucket.file(`tenants/${event.params.userId}.html`);
            await file.save(html, {
                contentType: "text/html",
                public: true,
                metadata: { cacheControl: "public, max-age=3600" }
            });
            console.log(`✅ HTML saved.`);
        }
    }
);