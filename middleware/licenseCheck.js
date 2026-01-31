const { executeQuery } = require("../config/database");

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
    const os = require("os");

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

// Middleware للتحقق من الجهاز المصرح به
const licenseCheck = async (req, res, next) => {
  try {
    // استثناء endpoints الخاصة بالأجهزة و endpoints الصحة والاختبار
    const excludedPaths = [
      "/api/device/status",
      "/api/device/authorize",
      "/api/device/deauthorize",
      "/api/health",
      "/api/test-db",
      "/api/serial",
      "/api/admin/shutdown",
    ];

    // التحقق من أن المسار مستثنى
    const isExcluded = excludedPaths.some((path) => req.path.startsWith(path));
    if (isExcluded) {
      return next();
    }

    // الحصول على سيريال الجهاز
    const deviceSerial = await getDeviceSerial();

    // التحقق من وجود هذا السيريال في قاعدة البيانات
    const { query: deviceQuery, params: deviceParams } =
      convertToSqlServerQuery(
        "SELECT * FROM Authorized_Devices WHERE device_serial = ?",
        [deviceSerial]
      );
    const devices = await executeQuery(deviceQuery, deviceParams);

    if (!devices || devices.length === 0) {
      // لا يوجد صف بهذا السيريال، نتأكد هل هناك جهاز آخر مفعل أم لا
      const { query: anyDeviceQuery, params: anyDeviceParams } =
        convertToSqlServerQuery(
          "SELECT TOP 1 device_serial FROM Authorized_Devices",
          []
        );
      const existingDevices = await executeQuery(
        anyDeviceQuery,
        anyDeviceParams
      );

      if (existingDevices && existingDevices.length > 0) {
        // يوجد جهاز آخر مفعل بسيريال مختلف -> منع تام
        const licensedSerial = existingDevices[0].device_serial;
        return res.status(403).json({
          success: false,
          message:
            "البرنامج مفعل بالفعل على جهاز آخر ولا يمكن تشغيله على هذا الجهاز.",
          error: "LICENSE_BOUND_TO_OTHER_DEVICE",
          currentDeviceSerial: deviceSerial,
          licensedDeviceSerial: licensedSerial,
          requiresAuthorization: false,
        });
      }

      // لا يوجد أي جهاز في الجدول -> هذه أول مرة، نسمح للواجهة أن تطلب كلمة المرور وتستدعي /api/device/authorize
      return res.status(403).json({
        success: false,
        message: "هذا الجهاز غير مصرح به. يرجى إدخال كلمة المرور للتفعيل.",
        error: "DEVICE_NOT_AUTHORIZED",
        currentDeviceSerial: deviceSerial,
        requiresAuthorization: true,
      });
    }

    // إضافة معلومات الجهاز للطلب
    req.authorizedDevice = devices[0];
    req.deviceSerial = deviceSerial;

    next();
  } catch (error) {
    console.error("Device authorization check error:", error);
    return res.status(500).json({
      success: false,
      message: "خطأ في التحقق من صلاحية الجهاز",
      error: error.message,
    });
  }
};

module.exports = licenseCheck;