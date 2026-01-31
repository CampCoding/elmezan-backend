const express = require("express");
const { executeQuery } = require("../config/database");
const crypto = require("crypto");
const os = require("os");

const router = express.Router();

// Helper function لتحويل SQLite queries لـ SQL Server
function convertToSqlServerQuery(query, params = []) {
  let sqlServerQuery = query;
  params.forEach((param, index) => {
    sqlServerQuery = sqlServerQuery.replace('?', `@param${index}`);
  });
  return { query: sqlServerQuery, params };
}

// دالة للحصول على سيريال الجهاز
async function getDeviceSerial() {
  try {
    const { exec } = require("child_process");
    const util = require("util");
    const execAsync = util.promisify(exec);
    const crypto = require("crypto");

    let serialNumber = "Not available";

    if (process.platform === "win32") {
      try {
        // Method 1: BIOS Serial
        try {
          const { stdout: biosOutput } = await execAsync("wmic bios get serialnumber /value 2>nul");
          const biosMatch = biosOutput.match(/SerialNumber=(\S+)/);
          if (biosMatch && biosMatch[1] && biosMatch[1].trim() !== "" && biosMatch[1] !== "To be filled by O.E.M.") {
            serialNumber = biosMatch[1].trim();
            return serialNumber;
          }
        } catch (e) { /* Continue to next method */ }

        // Method 2: Motherboard Serial
        if (serialNumber === "Not available") {
          try {
            const { stdout: baseboardOutput } = await execAsync("wmic baseboard get serialnumber /value 2>nul");
            const baseboardMatch = baseboardOutput.match(/SerialNumber=(\S+)/);
            if (baseboardMatch && baseboardMatch[1] && baseboardMatch[1].trim() !== "" && baseboardMatch[1] !== "To be filled by O.E.M.") {
              serialNumber = baseboardMatch[1].trim();
              return serialNumber;
            }
          } catch (e) { /* Continue to next method */ }
        }

        // Method 3: Disk Drive Serial
        if (serialNumber === "Not available") {
          try {
            const { stdout: diskOutput } = await execAsync("wmic diskdrive get serialnumber /value 2>nul");
            const diskMatches = diskOutput.match(/SerialNumber=(\S+)/g);
            if (diskMatches && diskMatches.length > 0) {
              for (const match of diskMatches) {
                const serial = match.replace("SerialNumber=", "").trim();
                if (serial && serial !== "") {
                  serialNumber = serial;
                  return serialNumber;
                }
              }
            }
          } catch (e) { /* Continue to next method */ }
        }

        // Method 4: CPU ID
        if (serialNumber === "Not available") {
          try {
            const { stdout: cpuOutput } = await execAsync("wmic cpu get processorid /value 2>nul");
            const cpuMatch = cpuOutput.match(/ProcessorId=(\S+)/);
            if (cpuMatch && cpuMatch[1] && cpuMatch[1].trim() !== "") {
              serialNumber = cpuMatch[1].trim();
              return serialNumber;
            }
          } catch (e) { /* Continue to next method */ }
        }

        // Method 5: Generate hash from system info as fallback
        if (serialNumber === "Not available") {
          const hashInput = `${os.hostname()}-${os.platform()}-${os.arch()}-${os.cpus().length}-${os.totalmem()}`;
          serialNumber = crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 16).toUpperCase();
          return serialNumber;
        }

      } catch (error) {
        // Final fallback
        const hashInput = `${os.hostname()}-${os.platform()}-${Date.now()}`;
        serialNumber = crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 16).toUpperCase();
        return serialNumber;
      }
    } else {
      // For Linux/Mac
      try {
        const { stdout } = await execAsync("dmidecode -s system-serial-number 2>/dev/null || echo 'Not available'");
        const dmidecodeResult = stdout.trim();
        if (dmidecodeResult && dmidecodeResult !== "Not available") {
          return dmidecodeResult;
        } else {
          // Fallback to hostname + MAC address hash
          const networkInterfaces = os.networkInterfaces();
          let macAddress = "";
          for (const interfaceName in networkInterfaces) {
            const interfaces = networkInterfaces[interfaceName];
            for (const iface of interfaces) {
              if (iface.mac && iface.mac !== "00:00:00:00:00:00" && !iface.internal) {
                macAddress = iface.mac;
                break;
              }
            }
            if (macAddress) break;
          }
          const hashInput = `${os.hostname()}-${macAddress}-${os.platform()}`;
          return crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 16).toUpperCase();
        }
      } catch (error) {
        // Final fallback
        const hashInput = `${os.hostname()}-${os.platform()}-${Date.now()}`;
        return crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 16).toUpperCase();
      }
    }

    return serialNumber;
  } catch (error) {
    return "ERROR";
  }
}

// التحقق من حالة الترخيص
router.get("/status", async (req, res) => {
  try {
    const deviceSerial = await getDeviceSerial();

    // البحث عن الترخيص في قاعدة البيانات
    const { query: licenseQuery, params: licenseParams } = convertToSqlServerQuery(
      "SELECT * FROM License WHERE device_serial = ? AND is_activated = 1",
      [deviceSerial]
    );
    const licenses = await executeQuery(licenseQuery, licenseParams);

    if (licenses && licenses.length > 0) {
      const license = licenses[0];
      res.json({
        success: true,
        isActivated: true,
        license: {
          id: license.id,
          deviceSerial: license.device_serial,
          licenseKey: license.license_key,
          activatedAt: license.activated_at,
          deviceInfo: license.device_info
        },
        currentDeviceSerial: deviceSerial
      });
    } else {
      res.json({
        success: true,
        isActivated: false,
        message: "البرنامج غير مفعل",
        currentDeviceSerial: deviceSerial
      });
    }
  } catch (error) {
    console.error("Error checking license status:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في التحقق من حالة الترخيص",
      error: error.message
    });
  }
});

// تفعيل البرنامج باستخدام مفتاح الترخيص
router.post("/activate", async (req, res) => {
  try {
    const { licenseKey } = req.body;

    if (!licenseKey) {
      return res.status(400).json({
        success: false,
        message: "مفتاح الترخيص مطلوب"
      });
    }

    const deviceSerial = await getDeviceSerial();
    const deviceInfo = JSON.stringify({
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      timestamp: new Date().toISOString()
    });

    // البحث عن مفتاح الترخيص في قاعدة البيانات
    const { query: licenseQuery, params: licenseParams } = convertToSqlServerQuery(
      "SELECT * FROM License WHERE license_key = ?",
      [licenseKey]
    );
    const licenses = await executeQuery(licenseQuery, licenseParams);

    if (!licenses || licenses.length === 0) {
      return res.status(404).json({
        success: false,
        message: "مفتاح الترخيص غير صحيح"
      });
    }

    const license = licenses[0];

    // التحقق من أن الترخيص غير مفعل مسبقاً
    if (license.is_activated === 1) {
      return res.status(400).json({
        success: false,
        message: "مفتاح الترخيص مفعل مسبقاً"
      });
    }

    // تفعيل الترخيص
    const { query: activateQuery, params: activateParams } = convertToSqlServerQuery(`
      UPDATE License
      SET is_activated = 1, activated_at = GETDATE(), device_serial = ?, device_info = ?
      WHERE license_key = ?
    `, [deviceSerial, deviceInfo, licenseKey]);

    await executeQuery(activateQuery, activateParams);

    res.json({
      success: true,
      message: "تم تفعيل البرنامج بنجاح",
      license: {
        deviceSerial: deviceSerial,
        licenseKey: licenseKey,
        activatedAt: new Date().toISOString(),
        deviceInfo: JSON.parse(deviceInfo)
      }
    });

  } catch (error) {
    console.error("Error activating license:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في تفعيل الترخيص",
      error: error.message
    });
  }
});

// إلغاء تفعيل البرنامج (للاختبار أو النقل)
router.post("/deactivate", async (req, res) => {
  try {
    const deviceSerial = await getDeviceSerial();

    const { query: deactivateQuery, params: deactivateParams } = convertToSqlServerQuery(`
      UPDATE License
      SET is_activated = 0, activated_at = NULL, device_serial = NULL, device_info = NULL
      WHERE device_serial = ? AND is_activated = 1
    `, [deviceSerial]);

    const result = await executeQuery(deactivateQuery, deactivateParams);

    res.json({
      success: true,
      message: "تم إلغاء تفعيل البرنامج",
      deviceSerial: deviceSerial
    });

  } catch (error) {
    console.error("Error deactivating license:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في إلغاء تفعيل الترخيص",
      error: error.message
    });
  }
});

// إضافة مفتاح ترخيص جديد (للإدارة)
router.post("/add-license", async (req, res) => {
  try {
    const { licenseKey, deviceSerial } = req.body;

    if (!licenseKey) {
      return res.status(400).json({
        success: false,
        message: "مفتاح الترخيص مطلوب"
      });
    }

    // التحقق من عدم وجود المفتاح مسبقاً
    const { query: existingQuery, params: existingParams } = convertToSqlServerQuery(
      "SELECT * FROM License WHERE license_key = ?",
      [licenseKey]
    );
    const existing = await executeQuery(existingQuery, existingParams);

    if (existing && existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "مفتاح الترخيص موجود مسبقاً"
      });
    }

    // إضافة المفتاح الجديد
    const deviceInfo = deviceSerial ? `Pre-assigned to device: ${deviceSerial}` : "Not assigned yet";
    const { query: insertQuery, params: insertParams } = convertToSqlServerQuery(`
      INSERT INTO License (device_serial, license_key, is_activated, device_info)
      VALUES (?, ?, 0, ?)
    `, [deviceSerial || null, licenseKey, deviceInfo]);

    await executeQuery(insertQuery, insertParams);

    res.json({
      success: true,
      message: "تم إضافة مفتاح الترخيص بنجاح",
      license: {
        licenseKey: licenseKey,
        deviceSerial: deviceSerial,
        deviceInfo: deviceInfo
      }
    });

  } catch (error) {
    console.error("Error adding license:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في إضافة مفتاح الترخيص",
      error: error.message
    });
  }
});

module.exports = router;