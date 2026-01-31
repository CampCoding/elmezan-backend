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

// التحقق من حالة الجهاز
router.get("/status", async (req, res) => {
  try {
    const deviceSerial = await getDeviceSerial();

    // البحث عن الجهاز في قاعدة البيانات
    const { query: deviceQuery, params: deviceParams } = convertToSqlServerQuery(
      "SELECT * FROM Authorized_Devices WHERE device_serial = ?",
      [deviceSerial]
    );
    const devices = await executeQuery(deviceQuery, deviceParams);

    if (devices && devices.length > 0) {
      const device = devices[0];
      res.json({
        success: true,
        isAuthorized: true,
        device: {
          id: device.id,
          deviceSerial: device.device_serial,
          devicePassword: "***", // لا نعرض كلمة المرور
          createdAt: device.created_at,
          deviceInfo: device.device_info
        },
        currentDeviceSerial: deviceSerial
      });
    } else {
      res.json({
        success: true,
        isAuthorized: false,
        message: "هذا الجهاز غير مصرح به",
        currentDeviceSerial: deviceSerial,
        requiresAuthorization: true
      });
    }
  } catch (error) {
    console.error("Error checking device status:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في التحقق من حالة الجهاز",
      error: error.message
    });
  }
});

// تفويض جهاز جديد (إدخال كلمة مرور لأول مرة)
router.post("/authorize", async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "كلمة المرور مطلوبة"
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

    // أولاً: التحقق هل هناك جهاز آخر مفعل بالفعل (منع النسخ بين الأجهزة)
    const { query: anyDeviceQuery, params: anyDeviceParams } = convertToSqlServerQuery(
      "SELECT TOP 1 device_serial FROM Authorized_Devices",
      []
    );
    const anyDevices = await executeQuery(anyDeviceQuery, anyDeviceParams);

    if (anyDevices && anyDevices.length > 0) {
      const existingSerial = anyDevices[0].device_serial;
      if (existingSerial && existingSerial !== deviceSerial) {
        // البرنامج مربوط بالفعل بجهاز آخر
        return res.status(403).json({
          success: false,
          message: "البرنامج مفعل بالفعل على جهاز آخر ولا يمكن نقله إلى هذا الجهاز.",
          error: "LICENSE_ALREADY_BOUND",
          existingDeviceSerial: existingSerial,
          currentDeviceSerial: deviceSerial
        });
      }
    }

    // ثانياً: التحقق من أن هذا الجهاز غير مصرح به مسبقاً
    const { query: existingQuery, params: existingParams } =
      convertToSqlServerQuery(
        "SELECT * FROM Authorized_Devices WHERE device_serial = ?",
        [deviceSerial]
      );
    const existing = await executeQuery(existingQuery, existingParams);

    if (existing && existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "هذا الجهاز مصرح به مسبقاً"
      });
    }

    // إضافة الجهاز الجديد
    const { query: insertQuery, params: insertParams } = convertToSqlServerQuery(`
      INSERT INTO Authorized_Devices (device_serial, device_password, device_info)
      VALUES (?, ?, ?)
    `, [deviceSerial, password, deviceInfo]);

    await executeQuery(insertQuery, insertParams);

    res.json({
      success: true,
      message: "تم تفويض الجهاز بنجاح",
      device: {
        deviceSerial: deviceSerial,
        deviceInfo: JSON.parse(deviceInfo)
      }
    });

  } catch (error) {
    console.error("Error authorizing device:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في تفويض الجهاز",
      error: error.message
    });
  }
});

// إلغاء تفويض الجهاز (للإدارة فقط)
router.post("/deauthorize", async (req, res) => {
  try {
    const deviceSerial = await getDeviceSerial();

    const { query: deleteQuery, params: deleteParams } = convertToSqlServerQuery(
      "DELETE FROM Authorized_Devices WHERE device_serial = ?",
      [deviceSerial]
    );

    await executeQuery(deleteQuery, deleteParams);

    res.json({
      success: true,
      message: "تم إلغاء تفويض الجهاز",
      deviceSerial: deviceSerial
    });

  } catch (error) {
    console.error("Error deauthorizing device:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في إلغاء تفويض الجهاز",
      error: error.message
    });
  }
});

// عرض جميع الأجهزة المصرح بها (للإدارة)
router.get("/list", async (req, res) => {
  try {
    const { query: listQuery } = convertToSqlServerQuery(
      "SELECT id, device_serial, created_at, device_info FROM Authorized_Devices ORDER BY created_at DESC"
    );
    const devices = await executeQuery(listQuery);

    res.json({
      success: true,
      devices: devices || [],
      count: devices ? devices.length : 0
    });

  } catch (error) {
    console.error("Error listing devices:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في عرض قائمة الأجهزة",
      error: error.message
    });
  }
});

module.exports = router;