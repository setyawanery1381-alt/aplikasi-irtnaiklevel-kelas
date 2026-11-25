/**
 * BACKEND GOOGLE APPS SCRIPT (GAS) - DATABASE IRT NAIK LEVEL V2
 * Webhook Otomatis Lynk.id + Pengiriman Email Kode Aktivasi Realtime + 2-Device Multi-Device Guard
 * 
 * FITUR UTAMA:
 * 1. Webhook Receiver Otomatis Lynk.id dengan verifikasi Shared Secret & Filter Produk
 * 2. Idempotency Guard (anti-duplikasi kode aktivasi jika webhook terkirim ganda)
 * 3. Auto-Generate & Validasi Kode Akses Unik (IRT-ACT-XXXX)
 * 4. Pengiriman Email Instan (Gratis via Google MailApp / GmailApp) ke inbox pembeli
 * 5. Multi-Device Lock (Maksimal 2 Perangkat per Member)
 * 6. Quick Return Login (Masuk cukup dengan Email di perangkat yang sudah terdaftar)
 * 7. Reset Perangkat langsung dari Admin Portal
 * 8. Pencatatan Audit Trail lengkap di Sheet "WebhookLog"
 */

// Konfigurasi Standar
var DEFAULT_SHARED_SECRET = "IRT_LYNK_SECRET_2026";
var HARGA_KELAS = 99000;
var SENDER_NAME = "CREATOR CLASS by IRT NAIK LEVEL";
var MAX_DEVICES_PER_MEMBER = 2;

// =========================================================================
// 1. INISIALISASI & SETUP SHEET OTOMATIS
// =========================================================================
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Sheet 1: Pembayaran
  var sheetBayar = ss.getSheetByName("Pembayaran");
  if (!sheetBayar) {
    sheetBayar = ss.insertSheet("Pembayaran");
    sheetBayar.appendRow([
      "Timestamp", "No Invoice", "Nama Lengkap", "Email", "WhatsApp", 
      "Nominal", "Metode", "Status", "Kode Aktivasi", "Bukti Pembayaran"
    ]);
    sheetBayar.getRange(1, 1, 1, 10).setFontWeight("bold").setBackground("#6d28d9").setFontColor("#ffffff");
    sheetBayar.setFrozenRows(1);
  }

  // Sheet 2: Member
  var sheetMember = ss.getSheetByName("Member");
  if (!sheetMember) {
    sheetMember = ss.insertSheet("Member");
    sheetMember.appendRow([
      "Timestamp", "ID Member", "Nama Lengkap", "Email", "WhatsApp", 
      "Status Akses", "Kode Aktivasi", "Paket Kelas", "Device Terdaftar"
    ]);
    sheetMember.getRange(1, 1, 1, 9).setFontWeight("bold").setBackground("#059669").setFontColor("#ffffff");
    sheetMember.setFrozenRows(1);
  } else {
    // Pastikan header kolom 9 ada untuk Device Terdaftar
    var h9 = sheetMember.getRange(1, 9).getValue();
    if (!h9) {
      sheetMember.getRange(1, 9).setValue("Device Terdaftar").setFontWeight("bold").setBackground("#059669").setFontColor("#ffffff");
    }
  }

  // Sheet 4: Pengaturan (Simpan Kredensial Superadmin & Konfigurasi Landing Page)
  var sheetPengaturan = ss.getSheetByName("Pengaturan");
  if (!sheetPengaturan) {
    sheetPengaturan = ss.insertSheet("Pengaturan");
    sheetPengaturan.appendRow(["Kunci", "Nilai", "Keterangan", "Update Terakhir"]);
    sheetPengaturan.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#312e81").setFontColor("#ffffff");
    sheetPengaturan.setFrozenRows(1);

    var nowStr = Utilities.formatDate(new Date(), "Asia/Jakarta", "dd MMM yyyy, HH:mm");
    sheetPengaturan.appendRow(["superadmin_username", "admin", "Username resmi superadmin pengelola kelas", nowStr]);
    sheetPengaturan.appendRow(["superadmin_password", "irtnaiklevel2026", "Password aman superadmin pengelola kelas", nowStr]);
    sheetPengaturan.appendRow(["mentor_avatarUrl", "assets/foto_mentor_lia.jpg", "Foto profil mentor / founder (sinkron ke HP & Laptop)", nowStr]);
    sheetPengaturan.appendRow(["mentor_name", "Lia Naik Level", "Nama pembimbing resmi", nowStr]);
    sheetPengaturan.appendRow(["mentor_role", "Komunitas & Mentor Edukasi AI", "Peran pembimbing", nowStr]);
    sheetPengaturan.appendRow(["mentor_badge", "Verified Community", "Lencana resmi mentor", nowStr]);
    sheetPengaturan.appendRow(["course_price", "Rp 1", "Harga promo saat ini", nowStr]);
    sheetPengaturan.appendRow(["normal_price", "Rp 20.000", "Harga coret / normal", nowStr]);
    sheetPengaturan.appendRow(["hero_badge", "1.834+ Ibu Rumah Tangga Telah Bergabung", "Badge jumlah peserta", nowStr]);
  }

  // Sheet 5: PortalTools (Simpan Revisi Tools & Materi dari Admin)
  var sheetTools = ss.getSheetByName("PortalTools");
  if (!sheetTools) {
    sheetTools = ss.insertSheet("PortalTools");
    sheetTools.appendRow(["ID", "Level", "Kategori", "Nama Modul", "Deskripsi", "Link Tools", "Link Video", "Prompt MD", "Update Terakhir"]);
    sheetTools.getRange(1, 1, 1, 9).setFontWeight("bold").setBackground("#4338ca").setFontColor("#ffffff");
    sheetTools.setFrozenRows(1);
  }

  // Sheet 3: WebhookLog (Pencatatan Log Transaksi Masuk Lynk.id)
  var sheetLog = ss.getSheetByName("WebhookLog");
  if (!sheetLog) {
    sheetLog = ss.insertSheet("WebhookLog");
    sheetLog.appendRow([
      "Timestamp", "Event", "RefId", "MessageId", "Email Pembeli", 
      "GrandTotal", "Status", "Hasil / Pesan", "Raw Payload"
    ]);
    sheetLog.getRange(1, 1, 1, 9).setFontWeight("bold").setBackground("#4338ca").setFontColor("#ffffff");
    sheetLog.setFrozenRows(1);
  }
}

// =========================================================================
// 2. ENDPOINT GET (BACA DATA OLEH ADMIN / MEMBER + VERIFIKASI 2 PERANGKAT)
// =========================================================================
function doGet(e) {
  setupSheets();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var action = (e && e.parameter && e.parameter.action) || 'getAll';

  var result = { success: true };

  try {
    if (action === 'getSettings') {
      var sheetPengaturan = ss.getSheetByName("Pengaturan");
      var settingsObj = {};
      if (sheetPengaturan && sheetPengaturan.getLastRow() > 1) {
        var rows = sheetPengaturan.getRange(2, 1, sheetPengaturan.getLastRow() - 1, 2).getValues();
        for (var i = 0; i < rows.length; i++) {
          if (rows[i][0]) settingsObj[rows[i][0]] = rows[i][1];
        }
      }
      var sheetTools = ss.getSheetByName("PortalTools");
      var customTools = sheetTools ? getSheetData(sheetTools) : [];
      result.settings = settingsObj;
      result.customTools = customTools;
    } else if (action === 'getAll' || action === 'getAdminDashboard') {
      result.payments = getSheetData(ss.getSheetByName("Pembayaran"));
      result.members = getSheetData(ss.getSheetByName("Member"));
      result.webhookLogs = getSheetData(ss.getSheetByName("WebhookLog")).slice(-50).reverse(); // 50 log terakhir
    } else if (action === 'getPayments') {
      result.payments = getSheetData(ss.getSheetByName("Pembayaran"));
    } else if (action === 'getMembers') {
      result.members = getSheetData(ss.getSheetByName("Member"));
    } else if (action === 'getWebhookLogs') {
      result.webhookLogs = getSheetData(ss.getSheetByName("WebhookLog")).slice(-50).reverse();
    } 
    // KIRIM ULANG EMAIL AKTIVASI VIA GET (ANTI-CORS)
    else if (action === 'resendActivationEmail') {
      var targetEmail = String(e.parameter.email || '').trim().toLowerCase();
      var targetName = String(e.parameter.name || 'Member').trim();
      var targetCode = String(e.parameter.code || '').trim().toUpperCase();

      if (!targetEmail || !targetCode) {
        result.success = false;
        result.error = "Email dan Kode Aktivasi wajib disertakan.";
      } else {
        var resendRes = sendActivationEmail(targetEmail, targetName, targetCode);
        result.success = resendRes.success;
        result.error = resendRes.error;
        result.message = resendRes.success ? 
          ("Kode aktivasi berhasil dikirim ulang ke: " + targetEmail) : 
          ("Gagal mengirim email: " + resendRes.error);
        
        var sheetLog = ss.getSheetByName("WebhookLog");
        if (sheetLog) {
          sheetLog.appendRow([
            Utilities.formatDate(new Date(), "Asia/Jakarta", "dd MMM yyyy, HH:mm"), "manual.resendEmail.get", "-", "-", targetEmail, 0,
            resendRes.success ? "Sukses" : "Gagal", "Kirim ulang manual: " + (resendRes.success ? "Terkirim" : resendRes.error), "-"
          ]);
        }
      }
    } 
    // VERIFIKASI AKSES MEMBER (2-DEVICE GUARD & ONE-CLICK RETURN LOGIN)
    else if (action === 'verifyMemberAccess' || action === 'checkCode') {
      var email = String(e.parameter.email || '').trim().toLowerCase();
      var code = String(e.parameter.code || '').trim().toUpperCase();
      var deviceId = String(e.parameter.deviceId || '').trim();

      result = processMemberVerification(ss, email, code, deviceId);
    } else {
      result.message = "API IRT NAIK LEVEL Ready (Webhook Integrated & Multi-Device Protected)";
    }
  } catch (err) {
    result.success = false;
    result.error = err.toString();
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// =========================================================================
// 3. ENDPOINT POST (TERIMA PENDAFTARAN, WEBHOOK LYNK, & UPDATE ADMIN)
// =========================================================================
function verifyGasAdminPass(ss, providedPass) {
  if (!providedPass) return false;
  var sheetPeng = ss.getSheetByName("Pengaturan");
  var storedPass = "irtnaiklevel2026";
  if (sheetPeng && sheetPeng.getLastRow() > 1) {
    var rows = sheetPeng.getRange(2, 1, sheetPeng.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] === "superadmin_password" && rows[i][1]) {
        storedPass = String(rows[i][1]);
        break;
      }
    }
  }
  return String(providedPass).trim().toLowerCase() === String(storedPass).trim().toLowerCase();
}

function doPost(e) {
  setupSheets();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = { success: true };

  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    var data = JSON.parse(raw);
    var action = data.action || 'submitPayment';
    var nowStr = Utilities.formatDate(new Date(), "Asia/Jakarta", "dd MMM yyyy, HH:mm");

    var sheetBayar = ss.getSheetByName("Pembayaran");
    var sheetPengaturan = ss.getSheetByName("Pengaturan");
    var sheetTools = ss.getSheetByName("PortalTools");

    // =====================================================================
    // AKSI BARU: SIMPAN PENGATURAN LANDING PAGE SECARA LIVE
    // =====================================================================
    // =====================================================================
    // AKSI BARU: CATAT KLIK MATERI & LOG AKTIVITAS REAL-TIME LINTAS DEVICE
    // =====================================================================
    if (action === 'trackClick') {
      if (sheetPengaturan) {
        var toolId = String(data.toolId || '');
        var viewMap = {};
        var logsArr = [];
        var viewRow = -1;
        var logRow = -1;
        var lastR = sheetPengaturan.getLastRow();
        if (lastR > 1) {
          var rows = sheetPengaturan.getRange(2, 1, lastR - 1, 2).getValues();
          for (var r = 0; r < rows.length; r++) {
            if (rows[r][0] === 'tool_views') {
              viewRow = r + 2;
              try { viewMap = JSON.parse(rows[r][1] || '{}'); } catch(ex) {}
            } else if (rows[r][0] === 'realtime_logs') {
              logRow = r + 2;
              try { logsArr = JSON.parse(rows[r][1] || '[]'); } catch(ex) {}
            }
          }
        }
        if (toolId) {
          viewMap[toolId] = (Number(viewMap[toolId]) || 0) + 1;
        }
        if (data.logEntry) {
          logsArr.unshift(data.logEntry);
          if (logsArr.length > 50) logsArr = logsArr.slice(0, 50);
        }
        var viewJson = JSON.stringify(viewMap);
        var logJson = JSON.stringify(logsArr);
        if (viewRow > 0) {
          sheetPengaturan.getRange(viewRow, 2).setValue(viewJson);
          sheetPengaturan.getRange(viewRow, 4).setValue(nowStr);
        } else {
          sheetPengaturan.appendRow(['tool_views', viewJson, 'Real-Time Views', nowStr]);
        }
        if (logRow > 0) {
          sheetPengaturan.getRange(logRow, 2).setValue(logJson);
          sheetPengaturan.getRange(logRow, 4).setValue(nowStr);
        } else {
          sheetPengaturan.appendRow(['realtime_logs', logJson, 'Real-Time Logs', nowStr]);
        }
        result.tool_views = viewMap;
      }
      result.message = "Klik materi & log aktivitas tercatat!";
      return createJsonResponse(result);
    }

    if (action === 'saveSettings') {
      var settings = data.settings || {};
      var keys = Object.keys(settings);
      if (sheetPengaturan && keys.length > 0) {
        var existingKeys = {};
        var lastRow = sheetPengaturan.getLastRow();
        if (lastRow > 1) {
          var vals = sheetPengaturan.getRange(2, 1, lastRow - 1, 1).getValues();
          for (var r = 0; r < vals.length; r++) {
            existingKeys[vals[r][0]] = r + 2;
          }
        }
        keys.forEach(function(k) {
          if (existingKeys[k]) {
            sheetPengaturan.getRange(existingKeys[k], 2).setValue(settings[k]);
            sheetPengaturan.getRange(existingKeys[k], 4).setValue(nowStr);
          } else {
            sheetPengaturan.appendRow([k, settings[k], "Pengaturan Live", nowStr]);
          }
        });
      }
      result.message = "Pengaturan berhasil disimpan live ke Google Sheets!";
      return createJsonResponse(result);
    }

    // =====================================================================
    // AKSI BARU: SIMPAN REVISI TOOLS MATERI SECARA LIVE
    // =====================================================================
    if (action === 'saveTool') {
      var tool = data.tool || {};
      if (sheetTools && tool.id) {
        var lastRowTools = sheetTools.getLastRow();
        var foundRow = 0;
        if (lastRowTools > 1) {
          var idVals = sheetTools.getRange(2, 1, lastRowTools - 1, 1).getValues();
          for (var t = 0; t < idVals.length; t++) {
            if (idVals[t][0] == tool.id) {
              foundRow = t + 2;
              break;
            }
          }
        }
        var rowData = [
          tool.id, tool.levelNum || '', tool.category || '', tool.name || '',
          tool.desc || '', tool.toolUrl || '', tool.videoUrl || '',
          tool.markdownPrompt || '', nowStr
        ];
        if (foundRow > 0) {
          sheetTools.getRange(foundRow, 1, 1, 9).setValues([rowData]);
        } else {
          sheetTools.appendRow(rowData);
        }
      }
      result.message = "Tool berhasil disimpan live ke Google Sheets!";
      return createJsonResponse(result);
    }

    var sheetMember = ss.getSheetByName("Member");
    var sheetLog = ss.getSheetByName("WebhookLog");

    // =====================================================================
    // AKSI 1: WEBHOOK OTOMATIS DARI LYNK.ID (Diteruskan dari Vercel Endpoint)
    // =====================================================================
    if (action === 'handleLynkWebhook') {
      var configuredSecret = PropertiesService.getScriptProperties().getProperty("SHARED_SECRET") || DEFAULT_SHARED_SECRET;
      var incomingSecret = data.sharedSecret || "";

      // 1. Verifikasi Shared Secret (Keamanan Antar-Server)
      if (incomingSecret !== configuredSecret) {
        sheetLog.appendRow([
          nowStr, data.event || 'unauthorized', data.refId || '-', data.message_id || '-', 
          data.email || '-', data.grandTotal || 0, "Ditolak", "Shared Secret Tidak Cocok", JSON.stringify(data)
        ]);
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Unauthorized Shared Secret" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var refId = String(data.refId || "").trim();
      var messageId = String(data.message_id || "").trim();
      var email = String(data.email || "").trim().toLowerCase();
      var name = String(data.name || (email ? email.split('@')[0] : "Kreator")).trim();
      var phone = String(data.phone || "-").trim();
      var grandTotal = Number(data.grandTotal || 0);

      // Jika webhook ditandai diabaikan (karena bukan produk target)
      if (data.status && data.status.indexOf("Diabaikan") !== -1) {
        sheetLog.appendRow([
          nowStr, data.event || 'payment.received', refId, messageId, email,
          grandTotal, data.status, data.resultMessage || "Transaksi diabaikan", JSON.stringify(data.rawPayload || data)
        ]);
        return ContentService.createTextOutput(JSON.stringify({ success: true, ignored: true, message: data.resultMessage }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      // 2. Idempotency Check: Cegah proses ganda jika Lynk mengirim ulang webhook
      var isDuplicate = checkDuplicateWebhook(sheetLog, sheetBayar, messageId, refId);
      if (isDuplicate) {
        sheetLog.appendRow([
          nowStr, data.event || 'payment.received', refId, messageId, email,
          grandTotal, "Diabaikan (Duplikat)", "Webhook kedua diabaikan (anti kode ganda)", JSON.stringify(data.rawPayload || data)
        ]);
        return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Duplicate webhook ignored", duplicate: true }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      // Format nominal yang dibayar
      var nominalTampil = "Rp " + (grandTotal > 0 ? grandTotal.toLocaleString('id-ID') : "99.000");
      if (grandTotal > 0 && grandTotal < HARGA_KELAS) {
        nominalTampil += " (Promo/Test Lynk)";
      }

      // 3. Cari apakah member sudah terdaftar sebelumnya berdasarkan email
      var memberRowIndex = findRowIndexByEmail(sheetMember, email, 4); // Kolom 4: Email di sheet Member
      var payRowIndex = findRowIndexByEmail(sheetBayar, email, 4);    // Kolom 4: Email di sheet Pembayaran

      var activationCode = "";

      // SKENARIO A: Member sudah daftar di web sebelumnya lalu bayar di Lynk
      if (memberRowIndex !== -1 || payRowIndex !== -1) {
        if (memberRowIndex !== -1) {
          activationCode = String(sheetMember.getRange(memberRowIndex, 7).getValue() || '').trim();
        }
        if ((!activationCode || activationCode === '-') && payRowIndex !== -1) {
          activationCode = String(sheetBayar.getRange(payRowIndex, 9).getValue() || '').trim();
        }
        if (!activationCode || activationCode === '-' || activationCode === 'undefined') {
          activationCode = generateUniqueActivationCode();
        }

        // Update status Member menjadi "Aktif"
        if (memberRowIndex !== -1) {
          sheetMember.getRange(memberRowIndex, 6).setValue("Aktif"); // Kolom 6: Status Akses
          sheetMember.getRange(memberRowIndex, 7).setValue(activationCode);
        } else {
          sheetMember.appendRow([
            nowStr, "MEM-" + Math.floor(1000 + Math.random() * 9000), name, email, phone, "Aktif", activationCode, "Kelas Animasi AI", ""
          ]);
        }

        // Catat Pembayaran: Jika ada invoice pending ("Menunggu Verifikasi"), update invoice tersebut.
        // Jika sudah lunas atau belum ada, SELALU buat baris transaksi invoice baru agar riwayat transaksi akurat.
        var isPendingPayment = false;
        if (payRowIndex !== -1) {
          var existingStatus = String(sheetBayar.getRange(payRowIndex, 8).getValue() || '');
          if (existingStatus.indexOf("Menunggu") !== -1) {
            isPendingPayment = true;
          }
        }

        if (isPendingPayment) {
          sheetBayar.getRange(payRowIndex, 8).setValue("Lunas (Otomatis via Lynk)"); // Kolom 8: Status
          sheetBayar.getRange(payRowIndex, 9).setValue(activationCode);
          if (refId) sheetBayar.getRange(payRowIndex, 2).setValue("INV-" + refId.slice(-8));
        } else {
          var newInvoiceId = "INV-LYNK-" + (refId ? refId.slice(-6) : Math.floor(1000 + Math.random() * 9000));
          sheetBayar.appendRow([
            nowStr, newInvoiceId,
            name, email, phone, nominalTampil, "Lynk Payment", "Lunas (Otomatis via Lynk)", activationCode, "Terverifikasi Webhook"
          ]);
        }

        // Kirim email aktivasi ke member
        var emailResult = sendActivationEmail(email, name, activationCode);

        // Catat ke WebhookLog
        sheetLog.appendRow([
          nowStr, data.event || 'payment.received', refId, messageId, email,
          grandTotal, "Sukses (Skenario A)", "Member diaktifkan & email " + (emailResult.success ? "terkirim" : ("gagal: " + emailResult.error)), JSON.stringify(data.rawPayload || data)
        ]);

        result.scenario = "A";
        result.activationCode = activationCode;
        result.emailSent = emailResult.success;
        result.emailError = emailResult.error;
        result.message = "Member berhasil diaktifkan dan kode dikirim ke email!";
      } 
      // SKENARIO B: Member bayar duluan di Lynk sebelum daftar di web
      else {
        activationCode = generateUniqueActivationCode();
        var invoiceId = "INV-LYNK-" + (refId ? refId.slice(-6) : Math.floor(1000 + Math.random() * 9000));

        // Simpan data pembayaran dengan status "Lunas (Otomatis via Lynk)"
        sheetBayar.appendRow([
          nowStr, invoiceId, name, email, phone, 
          nominalTampil, 
          "Lynk Payment", "Lunas (Otomatis via Lynk)", activationCode, "Terverifikasi Webhook"
        ]);

        // Simpan juga ke sheet Member sebagai akun aktif siap login
        sheetMember.appendRow([
          nowStr, "MEM-" + Math.floor(1000 + Math.random() * 9000), name, email, phone, 
          "Aktif", activationCode, "Kelas Animasi AI", ""
        ]);

        // Kirim email aktivasi ke pembeli
        var emailResultB = sendActivationEmail(email, name, activationCode);

        // Catat ke WebhookLog
        sheetLog.appendRow([
          nowStr, data.event || 'payment.received', refId, messageId, email,
          grandTotal, "Sukses (Skenario B)", "Bayar duluan. Akun aktif & email " + (emailResultB.success ? "terkirim" : ("gagal: " + emailResultB.error)), JSON.stringify(data.rawPayload || data)
        ]);

        result.scenario = "B";
        result.activationCode = activationCode;
        result.emailSent = emailResultB.success;
        result.emailError = emailResultB.error;
        result.message = "Pembayaran lunas dicatat & kode dikirim ke email pembeli.";
      }
    }

    // =====================================================================
    // AKSI 2: ADMIN KIRIM ULANG EMAIL KODE AKTIVASI
    // =====================================================================
    else if (action === 'resendActivationEmail') {
      var targetEmail = String(data.email || '').trim().toLowerCase();
      var targetName = String(data.name || 'Member').trim();
      var targetCode = String(data.code || data.activationCode || '').trim().toUpperCase();

      if (!targetEmail || !targetCode) {
        result.success = false;
        result.error = "Email dan Kode Aktivasi wajib disertakan.";
      } else {
        var resendRes = sendActivationEmail(targetEmail, targetName, targetCode);
        result.success = resendRes.success;
        result.error = resendRes.error;
        result.message = resendRes.success ? 
          ("Kode aktivasi berhasil dikirim ulang ke: " + targetEmail) : 
          ("Gagal mengirim email: " + resendRes.error);
        
        sheetLog.appendRow([
          nowStr, "manual.resendEmail", "-", "-", targetEmail, 0,
          resendRes.success ? "Sukses" : "Gagal", "Kirim ulang manual: " + (resendRes.success ? "Terkirim" : resendRes.error), "-"
        ]);
      }
    }

    // =====================================================================
    // AKSI 3: VERIFIKASI AKSES MEMBER (POST VERSION)
    // =====================================================================
    else if (action === 'verifyMemberAccess') {
      var vEmail = String(data.email || '').trim().toLowerCase();
      var vCode = String(data.code || '').trim().toUpperCase();
      var vDeviceId = String(data.deviceId || '').trim();
      result = processMemberVerification(ss, vEmail, vCode, vDeviceId);
    }

    // =====================================================================
    // AKSI 4: ADMIN RESET DEVICE MEMBER (Buka Kembali Slot 2 Perangkat)
    // =====================================================================
    else if (action === 'resetMemberDevices') {
      var rEmail = String(data.email || '').trim().toLowerCase();
      var rRowIdx = findRowIndexByEmail(sheetMember, rEmail, 4);
      if (rRowIdx !== -1) {
        sheetMember.getRange(rRowIdx, 9).setValue(""); // Kosongkan kolom Device Terdaftar
        result.success = true;
        result.message = "Slot perangkat untuk " + rEmail + " berhasil di-reset menjadi 0!";
      } else {
        result.success = false;
        result.error = "Member dengan email tersebut tidak ditemukan.";
      }
    }

    // =====================================================================
    // AKSI 5: REGISTRASI DARI WEB (Member Mendaftar Melalui Form)
    // =====================================================================
    else if (action === 'requestActivationCode' || action === 'submitPayment') {
      var emailCheck = String(data.email || '').trim().toLowerCase();
      var payIdx = findRowIndexByEmail(sheetBayar, emailCheck, 4);
      var memIdx = findRowIndexByEmail(sheetMember, emailCheck, 4);

      var rand = Math.floor(1000 + Math.random() * 9000);
      var invoiceId = data.invoiceId || ("INV-LYNK-" + rand);
      var code = data.activationCode || ("IRT-ACT-" + rand);
      var nama = data.name || data.nama || "Calon Member";
      var wa = data.wa || data.whatsapp || "-";
      var amount = data.amount || "Rp 99.000";
      var method = data.method || "Lynk Payment";
      var proof = data.proofImage || "-";

      if (payIdx !== -1) {
        var existingPayStatus = sheetBayar.getRange(payIdx, 8).getValue();
        if (existingPayStatus.indexOf("Lunas") !== -1) {
          code = sheetBayar.getRange(payIdx, 9).getValue() || code;
          if (memIdx !== -1) {
            sheetMember.getRange(memIdx, 6).setValue("Aktif");
            sheetMember.getRange(memIdx, 7).setValue(code);
          }
          result.alreadyPaid = true;
          result.activationCode = code;
          result.message = "Email Anda sudah terverifikasi lunas via Lynk! Akses kelas langsung aktif.";
          return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
        }
      }

      var status = data.status || "Menunggu Pembayaran";
      sheetBayar.appendRow([
        nowStr, invoiceId, nama, emailCheck, wa, amount, method, status, code, proof
      ]);

      sheetMember.appendRow([
        nowStr, "MEM-" + rand, nama, emailCheck, wa, "Menunggu Aktivasi", code, "Kelas Animasi AI", ""
      ]);

      result.invoiceId = invoiceId;
      result.activationCode = code;
      result.message = "Pendaftaran berhasil dicatat ke Google Sheets!";
    }

    // =====================================================================
    // AKSI 6: ADMIN UPDATE STATUS MANUAL
    // =====================================================================
    else // =====================================================================
    // AKSI BARU: TAMBAH MEMBER MANUAL, HAPUS MEMBER, HAPUS PEMBAYARAN, RESET TRIAL
    // =====================================================================
    if (action === 'addMember') {
      var sheetMemberAdd = ss.getSheetByName("Member");
      if (sheetMemberAdd) {
        sheetMemberAdd.appendRow([
          nowStr,
          data.id || ('mem-' + new Date().getTime()),
          data.name || 'Member',
          data.email || '-',
          data.wa || '-',
          data.status || 'Aktif',
          data.activationCode || ('IRT-ACT-' + Math.floor(1000 + Math.random() * 9000)),
          data.package || 'Kelas Animasi AI',
          '[]'
        ]);
      }
      var sheetBayarAdd = ss.getSheetByName("Pembayaran");
      if (sheetBayarAdd) {
        sheetBayarAdd.appendRow([
          nowStr,
          'INV-MAN-' + Math.floor(100000 + Math.random() * 900000),
          data.name || 'Member',
          data.email || '-',
          data.wa || '-',
          'Rp 1',
          'Input Manual Admin',
          'Lunas & Teraktivasi',
          '-',
          data.activationCode || ''
        ]);
      }
      result.message = "Member & Pembayaran berhasil ditambahkan ke Google Sheets!";
      return createJsonResponse(result);
    }

    if (action === 'deleteMembers') {
      if (data.adminPass !== undefined && !verifyGasAdminPass(ss, data.adminPass)) { result.success = false; result.message = 'Unauthorized'; return createJsonResponse(result); }
      var sheetMemDel = ss.getSheetByName("Member");
      var delIds = (data.ids || []).map(function(x){ return String(x).toLowerCase(); });
      if (sheetMemDel && sheetMemDel.getLastRow() > 1 && delIds.length > 0) {
        var rows = sheetMemDel.getDataRange().getValues();
        for (var r = rows.length - 1; r >= 1; r--) {
          var rowId = String(rows[r][1] || '').toLowerCase();
          var rowEmail = String(rows[r][3] || '').toLowerCase();
          var rowCode = String(rows[r][6] || '').toLowerCase();
          if (delIds.indexOf(rowId) !== -1 || delIds.indexOf(rowEmail) !== -1 || delIds.indexOf(rowCode) !== -1) {
            sheetMemDel.deleteRow(r + 1);
          }
        }
      }
      result.message = "Member terpilih berhasil dihapus dari Google Sheets!";
      return createJsonResponse(result);
    }

    if (action === 'deletePayments') {
      if (data.adminPass !== undefined && !verifyGasAdminPass(ss, data.adminPass)) { result.success = false; result.message = 'Unauthorized'; return createJsonResponse(result); }
      var sheetPayDel = ss.getSheetByName("Pembayaran");
      var delPayIds = (data.ids || []).map(function(x){ return String(x).toLowerCase(); });
      if (sheetPayDel && sheetPayDel.getLastRow() > 1 && delPayIds.length > 0) {
        var pRows = sheetPayDel.getDataRange().getValues();
        for (var pr = pRows.length - 1; pr >= 1; pr--) {
          var pInv = String(pRows[pr][1] || '').toLowerCase();
          if (delPayIds.indexOf(pInv) !== -1) {
            sheetPayDel.deleteRow(pr + 1);
          }
        }
      }
      result.message = "Pembayaran terpilih berhasil dihapus dari Google Sheets!";
      return createJsonResponse(result);
    }

    if (action === 'resetTrialData') {
      if (data.adminPass !== undefined && !verifyGasAdminPass(ss, data.adminPass)) { result.success = false; result.message = 'Unauthorized'; return createJsonResponse(result); }
      var sMem = ss.getSheetByName("Member");
      if (sMem && sMem.getLastRow() > 1) sMem.deleteRows(2, sMem.getLastRow() - 1);
      var sPay = ss.getSheetByName("Pembayaran");
      if (sPay && sPay.getLastRow() > 1) sPay.deleteRows(2, sPay.getLastRow() - 1);
      result.message = "Seluruh data trial Member & Pembayaran di Google Sheets telah dibersihkan!";
      return createJsonResponse(result);
    }

    if (action === 'updateMemberStatus') {
      var targetCode = (data.activationCode || data.code || '').trim().toUpperCase();
      var targetEmail = (data.email || '').trim().toLowerCase();
      var newStatus = data.status || 'Aktif';

      updateMemberAndPayment(sheetMember, sheetBayar, targetEmail, targetCode, newStatus);
      result.message = "Status berhasil diperbarui menjadi: " + newStatus;
    }

  } catch (err) {
    result.success = false;
    result.error = err.toString();
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// =========================================================================
// 4. FUNGSI LOGIKA VERIFIKASI MEMBER & 2-DEVICE LOCK
// =========================================================================
function processMemberVerification(ss, email, code, deviceId) {
  var sheetMember = ss.getSheetByName("Member");
  var members = getSheetData(sheetMember);
  var memberRowIdx = findRowIndexByEmail(sheetMember, email, 4);

  // Jika master code digunakan (IRT-VIP atau ADMIN)
  if (code === 'IRT-VIP' || code === 'ADMIN') {
    return {
      success: true,
      valid: true,
      masterAccess: true,
      member: { "Nama Lengkap": "Kreator VIP", "Email": email || "vip@member.com", "Kode Aktivasi": code },
      message: "Akses VIP Terbuka!"
    };
  }

  if (memberRowIdx === -1) {
    // Cek juga apakah code dimasukkan tanpa email (fallback cari by code)
    if (code && !email) {
      var foundByCode = members.find(function(m) {
        return m['Kode Aktivasi'] && String(m['Kode Aktivasi']).trim().toUpperCase() === code;
      });
      if (foundByCode) {
        email = String(foundByCode['Email'] || '').trim().toLowerCase();
        memberRowIdx = findRowIndexByEmail(sheetMember, email, 4);
      }
    }
  }

  if (memberRowIdx === -1) {
    return {
      success: false,
      valid: false,
      error: "Email belum terdaftar. Pastikan email sama persis dengan saat pendaftaran di Lynk.id."
    };
  }

  var memberData = members[memberRowIdx - 2];
  var memberStatus = String(memberData['Status Akses'] || '').trim();
  var correctCode = String(memberData['Kode Aktivasi'] || '').trim().toUpperCase();
  var registeredDevicesStr = String(memberData['Device Terdaftar'] || '').trim();
  var deviceList = registeredDevicesStr ? registeredDevicesStr.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];

  if (memberStatus !== 'Aktif') {
    return {
      success: false,
      valid: false,
      error: "Status akses akun belum aktif. Silakan hubungi Admin atau selesaikan pembayaran."
    };
  }

  // KASUS 1: Perangkat ini SUDAH terdaftar sebelumnya (Quick Return Login)
  if (deviceId && deviceList.indexOf(deviceId) !== -1) {
    return {
      success: true,
      valid: true,
      remembered: true,
      member: memberData,
      deviceCount: deviceList.length,
      maxDevices: MAX_DEVICES_PER_MEMBER,
      message: "Perangkat terverifikasi. Selamat datang kembali!"
    };
  }

  // KASUS 2: Perangkat BARU (Belum terdaftar di slot perangkat member)
  if (!code) {
    return {
      success: true,
      valid: false,
      needsCode: true,
      error: "Perangkat baru terdeteksi. Silakan masukkan Kode Akses unik Anda untuk mendaftarkan perangkat ini."
    };
  }

  if (code !== correctCode) {
    return {
      success: false,
      valid: false,
      error: "Kode Aktivasi tidak cocok dengan email ini. Silakan periksa email aktivasi Anda."
    };
  }

  // Kode COCOK! Cek kuota perangkat (Maksimal 2 Perangkat)
  if (deviceList.length >= MAX_DEVICES_PER_MEMBER) {
    return {
      success: false,
      valid: false,
      deviceLimitExceeded: true,
      deviceCount: deviceList.length,
      maxDevices: MAX_DEVICES_PER_MEMBER,
      error: "Akses Ditolak: Batas maksimal 2 perangkat telah tercapai untuk akun ini. Hubungi Admin (WhatsApp 0813-1989-4236) jika Anda mengganti perangkat untuk reset slot."
    };
  }

  // Masih ada slot kuota! Daftarkan deviceId baru ini
  if (deviceId) {
    deviceList.push(deviceId);
    var updatedDeviceStr = deviceList.join(',');
    sheetMember.getRange(memberRowIdx, 9).setValue(updatedDeviceStr);
  }

  return {
    success: true,
    valid: true,
    registeredNewDevice: true,
    member: memberData,
    deviceCount: deviceList.length,
    maxDevices: MAX_DEVICES_PER_MEMBER,
    message: "Perangkat baru berhasil diotorisasi (Slot " + deviceList.length + " dari " + MAX_DEVICES_PER_MEMBER + ")!"
  };
}

// =========================================================================
// 5. TEMPLATE & PENGIRIMAN EMAIL OTOMATIS (MailApp & GmailApp Fallback)
// =========================================================================
function sendActivationEmail(toEmail, memberName, activationCode) {
  toEmail = String(toEmail || '').trim().toLowerCase();
  memberName = String(memberName || 'Member').trim();
  activationCode = String(activationCode || '').trim().toUpperCase();

  if (!toEmail || toEmail.indexOf('@') === -1) {
    return { success: false, error: "Email tujuan tidak valid." };
  }

  var subject = "Akses Kelas Animasi AI Anda Sudah Aktif - IRT NAIK LEVEL";
  var loginUrl = "https://aplikasi-irtnaiklevel-kelas.vercel.app";
  var fullActivationUrl = loginUrl + "?redeem=1&email=" + encodeURIComponent(toEmail) + "&code=" + encodeURIComponent(activationCode) + "#materi";

  var plainText = "Halo Bunda/Kak " + memberName + ",\n\n" +
    "Selamat! Pembayaran pendaftaran Kelas Animasi AI Anda di IRT NAIK LEVEL via Lynk telah BERHASIL DIVERIFIKASI 100%.\n\n" +
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
    "KODE AKTIVASI AKSES KELAS ANDA:\n" +
    activationCode + "\n" +
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
    "Link Aktivasi Kelas: " + fullActivationUrl + "\n\n" +
    "PANDUAN MASUK:\n" +
    "1. Klik link aktivasi di atas.\n" +
    "2. Masukkan Email Anda (" + toEmail + ") dan Kode Aktivasi (" + activationCode + ").\n" +
    "3. Klik tombol 'Buka Akses' untuk membuka seluruh modul materi & tutorial.\n\n" +
    "Jika butuh bantuan, hubungi Admin WhatsApp: 0813-1989-4236\n\n" +
    "Salam hangat,\nCREATOR CLASS by IRT NAIK LEVEL";

  var htmlBody = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { margin: 0; padding: 0; background-color: #0c0d12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9; }
      .container { max-width: 600px; margin: 0 auto; background-color: #12131a; border: 1px solid #232533; border-radius: 20px; overflow: hidden; }
      .header { background: radial-gradient(circle at top, #261f38 0%, #12131a 100%); padding: 36px 24px 24px 24px; text-align: center; border-bottom: 1px solid rgba(255, 215, 0, 0.15); }
      .brand-title { color: #ffffff; font-size: 20px; font-weight: 800; letter-spacing: 2px; margin: 0; }
      .brand-sub { color: #d4af37; font-size: 11px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; margin-top: 4px; }
      .content { padding: 32px 28px; }
      .greeting { font-size: 18px; font-weight: 700; color: #ffffff; margin-bottom: 12px; }
      .paragraph { font-size: 14px; line-height: 1.65; color: #94a3b8; margin-bottom: 20px; }
      .code-card { background: linear-gradient(135deg, rgba(212, 175, 55, 0.12) 0%, rgba(139, 92, 246, 0.12) 100%); border: 1.5px dashed #d4af37; border-radius: 16px; padding: 24px; text-align: center; margin: 26px 0; }
      .code-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 2.5px; color: #cbd5e1; margin-bottom: 8px; }
      .code-display { font-size: 32px; font-weight: 900; letter-spacing: 4px; color: #ffd700; text-shadow: 0 0 20px rgba(255, 215, 0, 0.35); font-family: monospace; }
      .btn { display: inline-block; background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%); color: #ffffff !important; font-size: 15px; font-weight: 800; text-decoration: none; padding: 14px 34px; border-radius: 9999px; margin-top: 10px; box-shadow: 0 10px 25px rgba(236, 72, 153, 0.35); }
      .steps { background-color: #171821; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #232533; }
      .step-item { font-size: 13px; color: #cbd5e1; margin-bottom: 10px; line-height: 1.5; }
      .footer { background-color: #090a0e; padding: 20px 24px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #1c1d28; }
      .footer a { color: #d4af37; text-decoration: none; }
    </style>
  </head>
  <body>
    <div style="padding: 24px 10px;">
      <div class="container">
        <div class="header">
          <h1 class="brand-title">CREATOR CLASS</h1>
          <div class="brand-sub">BY IRT NAIK LEVEL</div>
        </div>

        <div class="content">
          <div class="greeting">Halo Bunda/Kak ${memberName}! 👋</div>
          <div class="paragraph">
            Terima kasih banyak! Pembayaran pendaftaran <strong>Kelas Animasi AI untuk Pemula</strong> Anda melalui Lynk.id telah <strong>berhasil diverifikasi 100%</strong>. Akses materi belajar Anda kini telah aktif selamanya.
          </div>

          <div class="code-card">
            <div class="code-label">KODE AKTIVASI AKSES KELAS ANDA</div>
            <div class="code-display" style="user-select: all; -webkit-user-select: all; cursor: pointer;">${activationCode}</div>
            <div style="margin-top: 12px;">
              <a href="${fullActivationUrl}&autocopy=1" target="_blank" style="display: inline-block; padding: 8px 16px; border-radius: 10px; background: rgba(168, 85, 247, 0.22); border: 1px solid rgba(168, 85, 247, 0.5); color: #e9d5ff; font-size: 12px; font-weight: 700; text-decoration: none;">&#128203; Salin Kode &amp; Isi Otomatis di Website</a>
            </div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 10px;">(Ketuk kode di atas untuk menyalin cepat, atau klik tombol di bawah untuk langsung buka website)</div>
          </div>

          <div style="text-align: center; margin: 26px 0;">
            <a href="${fullActivationUrl}&autocopy=1" target="_blank" class="btn">&#128273; Buka Website &amp; Masukkan Kode Akses</a>
          </div>

          <div class="steps">
            <div style="font-size: 13px; font-weight: 700; color: #ffffff; margin-bottom: 12px;">Cara Membuka Akses Materi di Website:</div>
            <div class="step-item">1️⃣ Klik tombol <strong>"Buka Website & Masukkan Kode Akses"</strong> di atas.</div>
            <div class="step-item">2️⃣ Di jendela aktivasi yang muncul, periksa Email Anda (<strong>${toEmail}</strong>) dan Kode Aktivasi Unik: <strong>${activationCode}</strong>.</div>
            <div class="step-item">3️⃣ Klik tombol <strong>"Buka Akses"</strong>. Seluruh video tutorial dan modul kelas akan langsung terbuka!</div>
          </div>

          <div class="paragraph" style="font-size: 12px; color: #64748b;">
            💡 <em>Simpan email ini baik-baik. Jika butuh bantuan atau ingin reset perangkat, hubungi Admin di WhatsApp <strong>0813-1989-4236</strong>.</em>
          </div>
        </div>

        <div class="footer">
          © 2026 IRT NAIK LEVEL. Hak Cipta Dilindungi.<br>
          Email otomatis dikirim melalui sistem verifikasi pembayaran Lynk.id.
        </div>
      </div>
    </div>
  </body>
  </html>
  `;

  var errorMsg = "";

  // Percobaan 1: Menggunakan GmailApp (agar langsung masuk folder Sent/Terkirim)
  try {
    GmailApp.sendEmail(toEmail, subject, plainText, {
      htmlBody: htmlBody,
      name: SENDER_NAME
    });
    return { success: true, error: "" };
  } catch (e1) {
    errorMsg = "GmailApp: " + e1.toString();
    Logger.log(errorMsg);

    // Percobaan 2: Menggunakan MailApp sebagai cadangan
    try {
      MailApp.sendEmail({
        to: toEmail,
        subject: subject,
        body: plainText,
        htmlBody: htmlBody,
        name: SENDER_NAME
      });
      return { success: true, error: "" };
    } catch (e2) {
      errorMsg += " | MailApp: " + e2.toString();
      Logger.log(errorMsg);
      return { success: false, error: errorMsg };
    }
  }
}

function testOtorisasiEmail() {
  var myEmail = Session.getActiveUser().getEmail();
  if (!myEmail) myEmail = "setyawnery1381@gmail.com";
  Logger.log("Menguji kirim email ke: " + myEmail);
  var res = sendActivationEmail(myEmail, "Pemilik Kelas", "IRT-ACT-TESTING");
  Logger.log("Hasil test: " + JSON.stringify(res));
  return res;
}

// =========================================================================
// 7. HELPER FUNCTIONS LAINNYA
// =========================================================================
function generateUniqueActivationCode() {
  var randomDigits = Math.floor(1000 + Math.random() * 9000);
  return "IRT-ACT-" + randomDigits;
}

function checkDuplicateWebhook(sheetLog, sheetBayar, messageId, refId) {
  if (!messageId && !refId) return false;

  // Cek di Sheet WebhookLog
  if (sheetLog) {
    var logs = sheetLog.getDataRange().getValues();
    for (var i = 1; i < logs.length; i++) {
      var logMsgId = String(logs[i][3] || '').trim(); // Kolom 4: MessageId
      var logRefId = String(logs[i][2] || '').trim(); // Kolom 3: RefId
      var logStatus = String(logs[i][6] || '').trim(); // Kolom 7: Status
      if (logStatus.indexOf("Sukses") !== -1) {
        if ((messageId && logMsgId === messageId) || (refId && logRefId === refId)) {
          return true;
        }
      }
    }
  }

  // Cek di Sheet Pembayaran
  if (sheetBayar && refId) {
    var pays = sheetBayar.getDataRange().getValues();
    for (var j = 1; j < pays.length; j++) {
      var inv = String(pays[j][1] || ''); // Kolom 2: No Invoice
      if (inv.indexOf(refId.slice(-6)) !== -1) {
        return true;
      }
    }
  }

  return false;
}

function findRowIndexByEmail(sheet, targetEmail, emailColIndex) {
  if (!sheet || !targetEmail) return -1;
  var rows = sheet.getDataRange().getValues();
  var cleanTarget = targetEmail.trim().toLowerCase();
  for (var i = 1; i < rows.length; i++) {
    var rowEmail = String(rows[i][emailColIndex - 1] || '').trim().toLowerCase();
    if (rowEmail === cleanTarget) {
      return i + 1; // 1-based index
    }
  }
  return -1;
}

function getSheetData(sheet) {
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  var headers = rows[0];
  var data = [];
  for (var i = 1; i < rows.length; i++) {
    var item = {};
    for (var j = 0; j < headers.length; j++) {
      item[headers[j]] = rows[i][j];
    }
    data.push(item);
  }
  return data;
}

function updateRowStatus(sheet, code, email, statusColIndex, newStatus) {
  if (!sheet) return;
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var rowCode = (rows[i][6] || '').toString().trim().toUpperCase(); // Kolom Kode
    var rowEmail = (rows[i][3] || '').toString().trim().toLowerCase(); // Kolom Email
    if ((code && rowCode === code) || (email && rowEmail === email)) {
      sheet.getRange(i + 1, statusColIndex).setValue(newStatus);
      if (code && code !== '-') {
        var codeCol = (statusColIndex === 6) ? 7 : 9;
        var existingCode = String(sheet.getRange(i + 1, codeCol).getValue() || '').trim();
        if (!existingCode || existingCode === '-') {
          sheet.getRange(i + 1, codeCol).setValue(code);
        }
      }
      break;
    }
  }
}

function updateMemberAndPayment(sheetMember, sheetBayar, email, code, status) {
  updateRowStatus(sheetMember, code, email, 6, status);
  updateRowStatus(sheetBayar, code, email, 8, (status === 'Aktif' ? 'Lunas & Teraktivasi' : status));
}
