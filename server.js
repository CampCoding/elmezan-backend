const express = require("express");
const cors = require("cors");
// const morgan = require("morgan");
require("dotenv").config({ path: "./config.env" });

const app = express();
const PORT = process.env.PORT || 3000;

// Import routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const areaRoutes = require("./routes/areas");
const tableRoutes = require("./routes/tables");  
const tabTabelsRoutes = require("./routes/tab_tabels");
const bookingRoutes = require("./routes/bookings");
const captainRoutes = require("./routes/captains");
const menuRoutes = require("./routes/menu");
// const orderRoutes = require("./routes/orders"); // Removed - using invoice-based workflow instead
const invoiceRoutes = require("./routes/invoice");
const flavorsRoutes = require("./routes/flavors");
const printerRoutes = require("./routes/printers");
const deviceRoutes = require("./routes/device");
const { exec } = require("child_process");
 
// Import database functions for testing
const { connectDB, executeQuery } = require("./config/database");
const { initializeTabTabels } = require("./config/init-tab-tabels");

// Import license middleware
const licenseCheck = require("./middleware/licenseCheck");

// Middleware
app.use(cors());
// app.use(morgan("combined")); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// License check middleware - يتحقق من الترخيص قبل أي عملية
app.use(licenseCheck);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/areas", areaRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/tab_tabels", tabTabelsRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/captains", captainRoutes);
app.use("/api/menu", menuRoutes);
// app.use("/api/orders", orderRoutes); // Removed --- --->>> using invoice-based  --- --->>>  workflow instead.
app.use("/api/invoice", invoiceRoutes);
app.use("/api/flavors", flavorsRoutes);
app.use("/api/printers", printerRoutes);
app.use("/api/device", deviceRoutes);

// Admin: graceful shutdown endpoint
app.post("/api/admin/shutdown", async (req, res) => {
  try {
    res.json({ success: true, message: "Server shutting down and killing processes" });

    // Give the response time to flush, then kill processes and exit
    setTimeout(() => {
      // Attempt to kill node and npm processes (Windows only)
      if (process.platform === "win32") {
        const { exec } = require("child_process");
        
        // Kill Google Chrome processes
        exec('taskkill /F /IM chrome.exe /T', (err) => {
          // Ignore errors
        });
        
        // Kill node.exe and npm.exe processes
        exec('taskkill /F /IM node.exe /T', (err) => {
          // Ignore errors
        });
        exec('taskkill /F /IM npm.exe /T', (err) => {
          // Ignore errors
        });

        // Attempt to close the parent command window (CMD/PowerShell) if not an IDE terminal
        const parentPid = process.ppid;
        const isVSCode = String(process.env.TERM_PROGRAM || '').toLowerCase().includes('vscode');
        const isWindowsTerminal = !!process.env.WT_SESSION; // Windows Terminal sets WT_SESSION
        if (!isVSCode && !isWindowsTerminal && parentPid && Number.isFinite(parentPid)) {
          exec(`taskkill /F /PID ${parentPid}`, (err) => {
            // Ignore errors (may be denied when launched from IDE)
          });
        }

        // As a fallback, walk up the process tree and close the first cmd.exe or powershell.exe ancestor
        if (!isVSCode && !isWindowsTerminal) {
          const psCommand = `
            $current = Get-CimInstance Win32_Process -Filter "ProcessId=$PID";
            while ($current) {
              $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($current.ParentProcessId)";
              if ($null -ne $parent -and ($parent.Name -match 'cmd.exe|powershell.exe')) {
                try { Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
                break
              }
              $current = $parent
            }
          `;
          exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand.replace(/\n/g, ' ').replace(/\"/g, '\\\"')}"`, (err) => {
            // Ignore errors
          });
        }
      } else {
        // On Unix-like systems, try to kill all node processes except the current one
        const { exec } = require("child_process");
        exec(`pkill -f node`, (err) => {
          // Ignore errors
        });
        exec(`pkill -f npm`, (err) => {
          // Ignore errors
        });
      }
      
      // Reopen Chrome without any tabs after a delay
      setTimeout(() => {
        if (process.platform === "win32") {
          exec('start chrome --new-window', (err) => {
            // Ignore errors
          });
        } else {
          // On Unix-like systems
          exec('google-chrome --new-window', (err) => {
            // Ignore errors
          });
        }
      }, 1000);
      
      // Exit the current process after a short delay to allow kill commands to propagate
      setTimeout(() => process.exit(0), 300);
    }, 200);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Database connection test endpoint
app.get("/api/test-db", async (req, res) => {
  try {
    console.log("🔍 Testing database connection...");

    // Test basic connection
    const pool = await connectDB();
    console.log("✅ Database connection successful");

    // Test a simple query
    const testQuery = "SELECT 1 as test";
    const result = await executeQuery(testQuery);
    console.log("✅ Test query successful:", result);

    res.json({
      success: true,
      message: "Database connection successful",
      connection: "Connected",
      testQuery: result,
      config: {
        dbType: process.env.DB_TYPE,
        server: process.env.DB_SERVER,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
      },
    });
  } catch (error) {
    console.error("❌ Database test failed:", error);
    res.status(500).json({
      success: false,
      message: "Database connection failed",
      error: error.message,
      config: {
        dbType: process.env.DB_TYPE,
        server: process.env.DB_SERVER,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
      },
    });
  }
});

// Get device serial number endpoint
app.get("/api/serial", async (req, res) => {
  try {
    const { exec } = require("child_process");
    const util = require("util");
    const execAsync = util.promisify(exec);
    const crypto = require("crypto");
    const os = require("os");

    let serialNumber = "Not available";
    let method = "none";
    const systemInfo = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
    };

    if (process.platform === "win32") {
      try {
        // Try multiple methods to get a unique identifier

        // Method 1: BIOS Serial
        try {
          const { stdout: biosOutput } = await execAsync("wmic bios get serialnumber /value 2>nul");
          const biosMatch = biosOutput.match(/SerialNumber=(\S+)/);
          if (biosMatch && biosMatch[1] && biosMatch[1].trim() !== "" && biosMatch[1] !== "To be filled by O.E.M.") {
            serialNumber = biosMatch[1].trim();
            method = "bios";
          }
        } catch (e) { /* Continue to next method */ }

        // Method 2: Motherboard Serial
        if (serialNumber === "Not available") {
          try {
            const { stdout: baseboardOutput } = await execAsync("wmic baseboard get serialnumber /value 2>nul");
            const baseboardMatch = baseboardOutput.match(/SerialNumber=(\S+)/);
            if (baseboardMatch && baseboardMatch[1] && baseboardMatch[1].trim() !== "" && baseboardMatch[1] !== "To be filled by O.E.M.") {
              serialNumber = baseboardMatch[1].trim();
              method = "motherboard";
            }
          } catch (e) { /* Continue to next method */ }
        }

        // Method 3: Disk Drive Serial
        if (serialNumber === "Not available") {
          try {
            const { stdout: diskOutput } = await execAsync("wmic diskdrive get serialnumber /value 2>nul");
            const diskMatches = diskOutput.match(/SerialNumber=(\S+)/g);
            if (diskMatches && diskMatches.length > 0) {
              // Take the first non-empty serial
              for (const match of diskMatches) {
                const serial = match.replace("SerialNumber=", "").trim();
                if (serial && serial !== "") {
                  serialNumber = serial;
                  method = "disk";
                  break;
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
              method = "cpu";
            }
          } catch (e) { /* Continue to next method */ }
        }

        // Method 5: Generate hash from system info as fallback
        if (serialNumber === "Not available") {
          const hashInput = `${systemInfo.hostname}-${systemInfo.platform}-${systemInfo.arch}-${systemInfo.cpus}-${systemInfo.totalMemory}`;
          serialNumber = crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 16).toUpperCase();
          method = "hash";
        }

      } catch (error) {
        console.log("Error getting serial number:", error.message);
        // Fallback to hash method
        const hashInput = `${systemInfo.hostname}-${systemInfo.platform}-${systemInfo.arch}-${systemInfo.cpus}-${systemInfo.totalMemory}-${Date.now()}`;
        serialNumber = crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 16).toUpperCase();
        method = "fallback-hash";
      }
    } else {
      // For Linux/Mac
      try {
        const { stdout } = await execAsync("dmidecode -s system-serial-number 2>/dev/null || echo 'Not available'");
        const dmidecodeResult = stdout.trim();
        if (dmidecodeResult && dmidecodeResult !== "Not available") {
          serialNumber = dmidecodeResult;
          method = "dmidecode";
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
          const hashInput = `${systemInfo.hostname}-${macAddress}-${systemInfo.platform}`;
          serialNumber = crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 16).toUpperCase();
          method = "mac-hash";
        }
      } catch (error) {
        // Final fallback
        const hashInput = `${systemInfo.hostname}-${systemInfo.platform}-${Date.now()}`;
        serialNumber = crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 16).toUpperCase();
        method = "fallback-hash";
      }
    }

    res.json({
      success: true,
      serialNumber: serialNumber,
      method: method,
      platform: process.platform,
      systemInfo: systemInfo,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in serial endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve serial number",
      error: error.message,
    });
  }
});

// Simple health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "AlMizan server is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Root endpoint - API information
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "AlMizan API Server",
    version: "1.0.0",
    // endpoints: {
    //   auth: "/api/auth",
    //   users: "/api/users",
    //   areas: "/api/areas",
    //   tables: "/api/tables",
    //   bookings: "/api/bookings",
    //   test: "/api/test-db",
    //   health: "/api/health",
    // },
    // documentation: "Check README.md for API usage details",
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "development" ? err.message : {},
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    // availableEndpoints: [
    //   "/api/auth",
    //   "/api/users",
    //   "/api/areas",
    //   "/api/tables",
    //   "/api/bookings",
    //   "/api/test-db",
    //   "/api/health",
    // ],
  });
});

app.listen(PORT, async () => {
  
  
  // تهيئة البيانات الأولية لجدول Tab_tabels
  try {
    await initializeTabTabels();
  } catch (error) {
    console.error("❌ Failed to initialize Tab_tabels:", error);
  }
});
