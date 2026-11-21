// =========================================================================
// SIMULATOR PENGUJIAN WEBHOOK LYNK.ID: /api/test-webhook
// Menjalankan Skenario A, B, C, D, dan E tanpa transaksi sungguhan
// =========================================================================

const crypto = require('crypto');

module.exports = async (req, res) => {
  const scenario = (req.query.scenario || req.body?.scenario || 'A').toUpperCase();
  const testEmail = (req.query.email || req.body?.email || 'test.member@gmail.com').toLowerCase();
  const testName = req.query.name || req.body?.name || 'Bunda Rina Wulandari';
  const merchantKey = process.env.LYNK_MERCHANT_KEY || 'TEST_MERCHANT_KEY_123';
  const webhookHandler = require('./lynk-webhook');

  const randId = Math.floor(100000 + Math.random() * 900000);
  let refId = `REF-TEST-${randId}`;
  let messageId = `MSG-TEST-${randId}`;
  let grandTotal = 99000;
  let email = testEmail;
  let forceInvalidSig = false;

  // Konfigurasi sesuai Skenario A - E
  if (scenario === 'A') {
    // Skenario A: Member sudah daftar, bayar 99.000
    grandTotal = 99000;
  } else if (scenario === 'B') {
    // Skenario B: Bayar duluan tanpa daftar web
    email = `newbuyer.${randId}@gmail.com`;
    grandTotal = 99000;
  } else if (scenario === 'C') {
    // Skenario C: Nominal tidak sesuai (misal Rp 50.000) atau email anomali
    grandTotal = 50000;
  } else if (scenario === 'D') {
    // Skenario D: Webhook duplikat (menggunakan message_id yang sama)
    refId = 'REF-DUPLICATE-FIXED-001';
    messageId = 'MSG-DUPLICATE-FIXED-001';
    grandTotal = 99000;
  } else if (scenario === 'E') {
    // Skenario E: Signature palsu / salah
    forceInvalidSig = true;
  }

  // Hitung Signature SHA-256
  const payloadString = `${grandTotal}${refId}${messageId}${merchantKey}`;
  const validSig = crypto.createHash('sha256').update(payloadString).digest('hex');
  const signatureToSend = forceInvalidSig ? 'INVALID_FAKE_SIGNATURE_12345' : validSig;

  const mockPayload = {
    event: 'payment.success',
    data: {
      refId: refId,
      message_id: messageId,
      totals: {
        grandTotal: grandTotal,
        totalPrice: grandTotal,
        discount: 0
      },
      customer: {
        name: testName,
        email: email,
        phone: '08123456789'
      }
    },
    isTestSimulation: true
  };

  // Panggil handler internal untuk mensimulasikan request masuk
  const mockReq = {
    method: 'POST',
    headers: {
      'x-lynk-signature': signatureToSend,
      'x-test-mode': 'true',
      'content-type': 'application/json'
    },
    body: mockPayload
  };

  let statusCode = 200;
  let responseData = null;

  const mockRes = {
    setHeader: () => {},
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => {
          responseData = data;
          return res.status(code).json({
            scenarioTested: scenario,
            description: getScenarioDescription(scenario),
            simulatedPayload: mockPayload,
            usedSignature: signatureToSend,
            httpStatusReturned: code,
            result: data
          });
        }
      };
    }
  };

  try {
    await webhookHandler(mockReq, mockRes);
  } catch (err) {
    return res.status(500).json({
      scenarioTested: scenario,
      error: err.message
    });
  }
};

function getScenarioDescription(sc) {
  switch(sc) {
    case 'A': return 'Skenario A: Member sudah daftar di web lalu bayar Rp 99.000 di Lynk. Sistem otomatis menandai Lunas, membuat kode aktivasi, dan mengirim email.';
    case 'B': return 'Skenario B: Pembeli bayar dulu di Lynk sebelum daftar di web. Sistem menyimpan status Lunas, Menunggu Registrasi dan mengirim kode ke email pembeli.';
    case 'C': return 'Skenario C: Pembayaran nominal tidak sesuai (Rp 50.000). Sistem menandai Perlu Dicek dan tidak mengirim kode aktivasi.';
    case 'D': return 'Skenario D: Webhook terkirim ganda (message_id / refId sama). Sistem mendeteksi duplikasi dan mengabaikan pengiriman email kedua.';
    case 'E': return 'Skenario E: Signature Lynk tidak valid / palsu. Request otomatis ditolak dengan HTTP 401 Unauthorized.';
    default: return 'Pengujian Webhook Lynk.id';
  }
}

