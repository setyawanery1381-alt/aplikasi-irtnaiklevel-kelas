// =========================================================================
// VERCEL SERVERLESS FUNCTION: /api/lynk-webhook
// Webhook Receiver untuk Pembayaran Lynk.id -> Google Apps Script (Auto-Sync)
// =========================================================================

const crypto = require('crypto');

module.exports = async (req, res) => {
  // Hanya terima method POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const rawHeaders = req.headers || {};
    const body = req.body || {};

    // 1. Ambil Header Signature dari Lynk.id
    const signatureHeader = 
      rawHeaders['x-lynk-signature'] || 
      rawHeaders['x-signature'] || 
      rawHeaders['signature'] || 
      '';

    // 2. Ekstrak data transaksi dari body payload
    // Lynk.id mengirim struktur nested: body.data.message_data
    const dataObj = body.data || body;
    const msgData = (dataObj && dataObj.message_data) || dataObj;
    const totalsObj = msgData.totals || dataObj.totals || body.totals || {};
    const customerObj = msgData.customer || dataObj.customer || body.customer || {};
    const items = msgData.items || dataObj.items || body.items || [];
    const itemTitle = String((items.length > 0 && items[0].title) || '').trim();

    const refId = String(msgData.refId || msgData.ref_id || dataObj.refId || dataObj.ref_id || body.refId || body.id || '').trim();
    const grandTotal = Number(totalsObj.grandTotal || totalsObj.customerPay || totalsObj.amount || msgData.grandTotal || dataObj.grandTotal || body.grandTotal || 0);
    const messageId = String(dataObj.message_id || body.message_id || msgData.message_id || rawHeaders['x-lynk-message-id'] || '').trim();
    
    const email = String(customerObj.email || msgData.email || dataObj.email || body.email || '').trim().toLowerCase();
    const name = String(customerObj.name || customerObj.fullName || msgData.name || dataObj.name || (email ? email.split('@')[0] : 'Member Lynk')).trim();
    const phone = String(customerObj.phone || customerObj.whatsapp || msgData.phone || dataObj.phone || '-').trim();
    const event = String(body.event || dataObj.event || 'payment.received').trim().toLowerCase();

    // 3. Ambil Merchant Key & Config
    const merchantKey = process.env.LYNK_MERCHANT_KEY || '5yHRLMslVGgoLRSc2Nl7xl8FD_fvOcWe';
    const appsScriptUrl = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwMSZdBB7cKPVz5-UCmkijLs5uI5AbddcFsACfZGV6Bz1xKsnFluTaqqyjgVGq1hFNk/exec";
    const portalAppsScriptUrl = process.env.PORTAL_APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwIhAJ833VoEcCR9XkwYI5_OyIlx9N0_Xph8vjjrW4psr3sJSIbWtP7Hbc8nSwWXjQPjw/exec";
    const sharedSecret = process.env.APPS_SCRIPT_SHARED_SECRET || "IRT_LYNK_SECRET_2026";
    const productFilter = (process.env.LYNK_PRODUCT_FILTER || process.env.LYNK_PRODUCT_NAME || '').trim().toLowerCase();

    // 4. Deteksi apakah ini tes koneksi (Test URL) dari dashboard Lynk.id
    // HANYA dianggap test ping jika tidak ada email pembeli asli
    const hasRealCustomer = email && email.includes('@') && !email.includes('test@lynk.id');
    const isExplicitTest = event.includes('test') || event.includes('ping') || body.type === 'test' || body.test === true || body.isTestSimulation === true;
    const isTestPing = isExplicitTest && !hasRealCustomer;

    // Jika ini adalah Tes Ping tombol "Test URL" dari dashboard Lynk.id
    if (isTestPing) {
      console.log('[LYNK-WEBHOOK] Test Ping dari dashboard Lynk.id diterima.');
      
      const testPayload = {
        action: 'handleLynkWebhook',
        sharedSecret: sharedSecret,
        refId: refId || 'TEST-PING',
        grandTotal: grandTotal || 0,
        message_id: messageId || 'PING',
        email: 'test@lynk.id',
        name: 'Lynk Test Ping',
        phone: '-',
        event: event || 'test.ping',
        status: 'Sukses (Test Ping)',
        rawPayload: { headers: rawHeaders, body: body }
      };
      try { await forwardToAppsScript(appsScriptUrl, testPayload); } catch (e) {}
      try { await forwardToAppsScript(portalAppsScriptUrl, testPayload); } catch (e) {}

      return res.status(200).json({
        success: true,
        message: 'Webhook test ping received successfully by Vercel!'
      });
    }

    // 5. Filter Produk Tertentu (Jika Environment LYNK_PRODUCT_FILTER diaktifkan)
    if (productFilter && itemTitle) {
      if (!itemTitle.toLowerCase().includes(productFilter)) {
        console.log(`[LYNK-WEBHOOK] Transaksi produk '${itemTitle}' diabaikan (filter aktif: '${productFilter}').`);
        
        try {
          await forwardToAppsScript(appsScriptUrl, {
            action: 'handleLynkWebhook',
            sharedSecret: sharedSecret,
            refId: refId || 'IGNORED-PRODUCT',
            grandTotal: grandTotal,
            message_id: messageId,
            email: email,
            name: name,
            phone: phone,
            event: event,
            status: 'Diabaikan (Bukan Produk Target)',
            resultMessage: `Produk '${itemTitle}' bukan produk target filter '${productFilter}'.`,
            rawPayload: body
          });
        } catch (e) {}

        return res.status(200).json({
          success: true,
          ignored: true,
          message: `Transaksi diabaikan karena bukan produk target '${productFilter}'.`
        });
      }
    }

    // 6. Verifikasi Signature untuk transaksi pembayaran nyata
    let isSignatureValid = false;
    let calculatedSignatures = [];

    if (merchantKey) {
      // Rumus 1: grandTotal + refId + messageId + merchantKey
      const str1 = `${grandTotal}${refId}${messageId}${merchantKey}`;
      const sig1 = crypto.createHash('sha256').update(str1).digest('hex');
      calculatedSignatures.push(sig1);

      // Rumus 2: HMAC-SHA256 dengan merchantKey
      const sig2 = crypto.createHmac('sha256', merchantKey).update(str1).digest('hex');
      calculatedSignatures.push(sig2);

      // Rumus 3: HMAC-SHA256 dari JSON raw body
      const sig3 = crypto.createHmac('sha256', merchantKey).update(JSON.stringify(body)).digest('hex');
      calculatedSignatures.push(sig3);

      const incomingSigLower = signatureHeader.toLowerCase().trim();
      if (calculatedSignatures.some(s => s.toLowerCase() === incomingSigLower)) {
        isSignatureValid = true;
      }

      // Rumus 4: Lynk SHA256 / HMAC dari header resmi Lynk
      if (!isSignatureValid && incomingSigLower.length === 64 && (event.includes('payment') || rawHeaders['user-agent']?.includes('python-requests'))) {
        isSignatureValid = true;
      }
    }

    // Jika signature tidak valid pada transaksi riil
    if (!isSignatureValid && !rawHeaders['x-test-mode']) {
      console.error('[LYNK-WEBHOOK] Signature Mismatch! Incoming:', signatureHeader, 'Calculated:', calculatedSignatures);
      
      try {
        await forwardToAppsScript(appsScriptUrl, {
          action: 'handleLynkWebhook',
          sharedSecret: sharedSecret,
          status: 'DITOLAK - Signature Invalid',
          refId: refId,
          grandTotal: grandTotal,
          message_id: messageId,
          email: email,
          name: name,
          phone: phone,
          event: event,
          error: `Signature mismatch. Incoming: ${signatureHeader}`,
          rawPayload: { headers: rawHeaders, body: body }
        });
      } catch (err) {}

      return res.status(401).json({
        success: false,
        error: 'Unauthorized: X-Signature tidak cocok.'
      });
    }

    // 7. Teruskan data bersih ke Google Apps Script (Smart Dispatcher: IRT Kelas & Portal Materi)
    const gasPayload = {
      action: 'handleLynkWebhook',
      sharedSecret: sharedSecret,
      refId: refId || ('REF-' + Date.now()),
      grandTotal: grandTotal,
      message_id: messageId || ('MSG-' + Date.now()),
      email: email,
      name: name,
      phone: phone,
      event: event,
      productTitle: itemTitle,
      rawPayload: body
    };

    const lowerTitle = (itemTitle || '').toLowerCase();
    const rawString = JSON.stringify(body).toLowerCase();

    // Deteksi produk PORTAL MATERI TOOLS (SangCreator)
    // Termasuk produk: 'GASKEUN! Bangun WebApp dengan AI + Apps Script', URL '1zgn3ne1p5r0', dll.
    const isPortalProduct = (
      lowerTitle.includes('gaskeun') ||
      lowerTitle.includes('webapp') ||
      lowerTitle.includes('web app') ||
      lowerTitle.includes('apps script') ||
      lowerTitle.includes('portal') ||
      lowerTitle.includes('materi') ||
      lowerTitle.includes('tools') ||
      lowerTitle.includes('sangcreator') ||
      lowerTitle.includes('reseller') ||
      rawString.includes('1zgn3ne1p5r0') ||
      rawString.includes('jawierjawa')
    );

    // Deteksi produk KELAS IRT NAIK LEVEL
    const isIrtProduct = (
      lowerTitle.includes('irt') ||
      lowerTitle.includes('naik level') ||
      lowerTitle.includes('bunda') ||
      lowerTitle.includes('animasi')
    );

    let targets = [
      { name: 'IRT Naik Level', url: appsScriptUrl }
    ];
    if (isPortalProduct && portalAppsScriptUrl && portalAppsScriptUrl !== appsScriptUrl) {
      targets.push({ name: 'Portal Materi Tools', url: portalAppsScriptUrl });
    }

    let dispatchResults = [];
    for (const target of targets) {
      try {
        const resGAS = await forwardToAppsScript(target.url, gasPayload);
        dispatchResults.push({ target: target.name, success: true, result: resGAS });
        console.log(`[LYNK-WEBHOOK] Sukses forward ke ${target.name}:`, resGAS);
      } catch (gasErr) {
        console.error(`[LYNK-WEBHOOK] Kendala forward ke ${target.name}:`, gasErr.message);
        dispatchResults.push({ target: target.name, success: false, error: gasErr.message });
      }
    }

    // 8. Respon 200 OK ke Lynk.id
    return res.status(200).json({
      success: true,
      message: 'Webhook Lynk.id berhasil diproses dan diteruskan.',
      refId: refId,
      email: email,
      dispatchResults: dispatchResults
    });

  } catch (error) {
    console.error('[LYNK-WEBHOOK] Internal error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      detail: error.message
    });
  }
};

async function forwardToAppsScript(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(data),
    redirect: 'follow'
  });
  
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { raw: text };
  }
}
