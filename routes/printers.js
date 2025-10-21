const express = require("express");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const router = express.Router();


router.get("/", async (req, res) => {
  try {
    console.log("🔍 Fetching available printers...");
    
    let stdout, stderr;
    
    try {
      
      const result = await execAsync('powershell "Get-WmiObject -Class Win32_Printer | Select-Object Name, DriverName, PortName, Default, Status | ConvertTo-Json"');
      stdout = result.stdout;
      stderr = result.stderr;
      console.log("PowerShell output:", stdout);
    } catch (powerShellError) {
      console.log("PowerShell failed, trying alternative method...");
      
      try {
        const result = await execAsync('reg query "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers" /s');
        stdout = result.stdout;
        stderr = result.stderr;
        console.log("Registry output:", stdout);
      } catch (registryError) {
        console.error("Both PowerShell and Registry methods failed");
        return res.status(500).json({
          success: false,
          message: "Failed to get printers - no compatible method available",
          error: "PowerShell and Registry methods both failed"
        });
      }
    }
    
    if (stderr) {
      console.error("Error getting printers:", stderr);
      return res.status(500).json({
        success: false,
        message: "Failed to get printers",
        error: stderr
      });
    }

    
    let printers = [];
    
    if (stdout.trim()) {
      try {
        
        const printerData = JSON.parse(stdout);
        const printerArray = Array.isArray(printerData) ? printerData : [printerData];
        
        printers = printerArray.map(printer => ({
          name: printer.Name || 'Unknown',
          driver: printer.DriverName || 'Unknown',
          port: printer.PortName || 'Unknown',
          status: printer.Status || 'Unknown',
          isDefault: printer.Default === true
        }));
      } catch (parseError) {
        
        console.log("JSON parsing failed, trying registry output...");
        const lines = stdout.trim().split('\n');
        const printerNames = [];
        
        for (const line of lines) {
          if (line.includes('HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers\\')) {
            const parts = line.split('\\');
            const printerName = parts[parts.length - 1];
            if (printerName && !printerName.includes('HKEY_')) {
              printerNames.push(printerName);
            }
          }
        }
        
        printers = printerNames.map(name => ({
          name: name,
          driver: 'Unknown',
          port: 'Unknown',
          status: 'Unknown',
          isDefault: false
        }));
      }
    }

    console.log(`✅ Found ${printers.length} printers`);
    
    res.json({
      success: true,
      printers: printers,
      total: printers.length
    });
    
  } catch (error) {
    console.error("❌ Error fetching printers:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get printers",
      error: error.message
    });
  }
});


router.get("/default", async (req, res) => {
  try {
    console.log("🔍 Getting default printer...");
    
    const { stdout, stderr } = await execAsync('powershell "Get-WmiObject -Class Win32_Printer | Where-Object {$_.Default -eq $true} | Select-Object Name | ConvertTo-Json"');
    
    if (stderr) {
      console.error("Error getting default printer:", stderr);
      return res.status(500).json({
        success: false,
        message: "Failed to get default printer",
        error: stderr
      });
    }

    let defaultPrinter = null;
    
    if (stdout.trim()) {
      try {
        const defaultData = JSON.parse(stdout);
        
        if (Array.isArray(defaultData) && defaultData.length > 0) {
          defaultPrinter = defaultData[0].Name;
        } else if (defaultData.Name) {
          defaultPrinter = defaultData.Name;
        }
      } catch (parseError) {
        console.error("Error parsing default printer JSON:", parseError);
      }
    }

    res.json({
      success: true,
      defaultPrinter: defaultPrinter
    });
    
  } catch (error) {
    console.error("❌ Error getting default printer:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get default printer",
      error: error.message
    });
  }
});


router.post("/print", async (req, res) => {
  try {
    const { filePath, printerName, copies = 1 } = req.body;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: "filePath is required"
      });
    }

    console.log(`🖨️ Printing file: ${filePath}`);
    console.log(`📄 Printer: ${printerName || 'default'}`);
    console.log(`📋 Copies: ${copies}`);

    let printCommand;
    
    if (printerName) {
      
      printCommand = `print /d:"${printerName}" "${filePath}"`;
    } else {
      
      printCommand = `print "${filePath}"`;
    }

    const { stdout, stderr } = await execAsync(printCommand);
    
    if (stderr) {
      console.error("Print error:", stderr);
      return res.status(500).json({
        success: false,
        message: "Print failed",
        error: stderr
      });
    }

    console.log("✅ Print job submitted successfully");
    
    res.json({
      success: true,
      message: "Print job submitted successfully",
      printer: printerName || "default",
      file: filePath,
      copies: copies
    });
    
  } catch (error) {
    console.error("❌ Error printing file:", error);
    res.status(500).json({
      success: false,
      message: "Failed to print file",
      error: error.message
    });
  }
});


router.post("/print-text", async (req, res) => {
  try {
    const { content, printerName, fileName = "print.txt" } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, message: "content is required" });
    }

    console.log(`🖨️ Printing text content to: ${printerName || "default"}`);

    
    const path = require("path");
    const fs = require("fs").promises;
    const { execFile } = require("child_process");
    const util = require("util");
    const execFileAsync = util.promisify(execFile);

    const invoiceDir = path.join(__dirname, "..", "invoice");

    
    try {
      await fs.mkdir(invoiceDir, { recursive: true });
      console.log(`📁 Created/verified invoice directory: ${invoiceDir}`);
    } catch (mkdirError) {
      console.warn("Warning: Could not create invoice directory:", mkdirError.message);
    }

    
    const invoiceFilePath = path.join(invoiceDir, fileName);

    
    await fs.writeFile(invoiceFilePath, content, "utf8");
    console.log(`📄 Created invoice file: ${invoiceFilePath}`);

    
    try {
      if (process.platform === "win32") {
        
        try {
          let psCommand;
          if (printerName) {
            psCommand = `powershell "Start-Process -FilePath '${invoiceFilePath}' -Verb Print -WindowStyle Hidden -ArgumentList '/p /h /d:"${printerName}"'"`;
          } else {
            psCommand = `powershell "Start-Process -FilePath '${invoiceFilePath}' -Verb Print -WindowStyle Hidden -ArgumentList '/p /h'"`;
          }
          
          
          const { stdout, stderr } = await execAsync(psCommand);
          
          if (stdout) console.log("PowerShell stdout:", stdout);
          
          
          
        } catch (psError) {
          
          
          
          let printCommand;
          if (printerName) {
            printCommand = `print /d:"${printerName}" "${invoiceFilePath}"`;
          } else {
            printCommand = `print "${invoiceFilePath}"`;
          }
          
          
          const { stdout, stderr } = await execAsync(printCommand);
          
          if (stderr) {
            console.error("Print stderr:", stderr);
            
          }
          
          if (stdout) {
            console.log("Print stdout:", stdout);
          }
        }
      } else {
        
        const args = [];
        if (printerName) args.push("-d", printerName);
        args.push(invoiceFilePath);
        await execFileAsync("lp", args);
      }
    } catch (printErr) {
      console.error("Print error:", printErr);
      return res.status(500).json({
        success: false,
        message: "Print failed",
        error: printErr.message,
      });
    }
    

    console.log("✅ Text printed successfully");

    res.json({
      success: true,
      message: "Text printed successfully",
      printer: printerName || "default",
      fileName,
      filePath: invoiceFilePath,
    });
  } catch (error) {
    console.error("❌ Error printing text:", error);
    res.status(500).json({
      success: false,
      message: "Failed to print text",
      error: error.message,
    });
  }
});
const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs").promises;

router.post("/print-html", async (req, res) => {
  try {
    const {
      html,                 
      printerName,          
      fileName = "print.html",
      pdfName,              
      landscape = false,    
      scale = 1,            
      margin = { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" } 
    } = req.body;

    if (!html || typeof html !== "string") {
      return res.status(400).json({ success: false, message: "`html` is required" });
    }

    const invoiceDir = path.join(__dirname, "..", "invoice");
    await fs.mkdir(invoiceDir, { recursive: true });

    const htmlPath = path.join(invoiceDir, fileName.endsWith(".html") ? fileName : `${fileName}.html`);
    await fs.writeFile(htmlPath, html, "utf8");

    const outPdfName = (pdfName && pdfName.endsWith(".pdf")) ? pdfName
                      : (pdfName ? `${pdfName}.pdf`
                      : `${path.parse(fileName).name}.pdf`);
    const pdfPath = path.join(invoiceDir, outPdfName);

    
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: 'C:\\Users\\Administrator\\.cache\\puppeteer\\chrome\\win64-141.0.7390.76\\chrome-win64\\chrome.exe',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    await page.pdf({
      path: pdfPath,
      printBackground: true,
      format: "A4",
      landscape,
      scale: Math.min(Math.max(scale, 0.1), 2),
      margin
    });
    await browser.close();

    
    try {
      if (process.platform === "win32") {
        
        if (printerName) {
          const ps = `
            $file = "${pdfPath.replace(/\\/g, "\\\\")}";
            $printer = "${String(printerName).replace(/"/g, '\\"')}";
            Start-Process -FilePath $file -Verb PrintTo -ArgumentList $printer -WindowStyle Hidden
          `;
          const cmd = `powershell -NoProfile -Command "${ps.replace(/\n/g, " ")}"`;
          const { stdout, stderr } = await execAsync(cmd);
          if (stdout) console.log("PowerShell PrintTo stdout:", stdout);
          if (stderr) console.log("PowerShell PrintTo stderr:", stderr);
        } else {
          
          const ps = `
            $file = "${pdfPath.replace(/\\/g, "\\\\")}"; 
            Start-Process -FilePath $file -Verb Print -WindowStyle Hidden
          `;
          const cmd = `powershell -NoProfile -Command "${ps.replace(/\n/g, " ")}"`;
          const { stdout, stderr } = await execAsync(cmd);
          if (stdout) console.log("PowerShell Print stdout:", stdout);
          if (stderr) console.log("PowerShell Print stderr:", stderr);
        }
      } else {
        
        const args = [];
        if (printerName) args.push("-d", printerName);
        args.push(pdfPath);
        await execFileAsync("lp", args);
      }
    } catch (printErr) {
      console.error("Print error:", printErr);
      return res.status(500).json({
        success: false,
        message: "Print failed",
        error: printErr.message,
        pdfPath
      });
    }

    return res.json({
      success: true,
      message: "HTML rendered to PDF and sent to printer",
      printer: printerName || "default",
      htmlPath,
      pdfPath
    });
  } catch (err) {
    console.error("❌ /print-html error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to render/print HTML",
      error: err.message
    });
  }
});


router.post("/test", async (req, res) => {
  try {
    const { printerName } = req.body;

    console.log(`🧪 Testing printer: ${printerName || "default"}`);

    
    const testContent = `
=== PRINTER TEST ===
Date: ${new Date().toLocaleString()}
Printer: ${printerName || "Default Printer"}
Status: Working
==================
    `.trim();

    
    const path = require("path");
    const fs = require("fs").promises;
    const { execFile } = require("child_process");
    const util = require("util");
    const execFileAsync = util.promisify(execFile);

    const invoiceDir = path.join(__dirname, "..", "invoice");

    
    try {
      await fs.mkdir(invoiceDir, { recursive: true });
    } catch (mkdirError) {
      console.warn("Warning: Could not create invoice directory:", mkdirError.message);
    }

    const testFilePath = path.join(invoiceDir, "printer_test.txt");
    await fs.writeFile(testFilePath, testContent, "utf8");

    
    try {
      if (process.platform === "win32") {
        
        try {
          let psCommand;
          if (printerName) {
            psCommand = `powershell "Start-Process -FilePath '${testFilePath}' -Verb Print -WindowStyle Hidden"`;
          } else {
            psCommand = `powershell "Start-Process -FilePath '${testFilePath}' -Verb Print -WindowStyle Hidden"`;
          }
          
          console.log(`🧪 Trying PowerShell test print command: ${psCommand}`);
          const { stdout, stderr } = await execAsync(psCommand);
          
          if (stdout) console.log("PowerShell stdout:", stdout);
          if (stderr) console.log("PowerShell stderr:", stderr);
          
          console.log("✅ PowerShell test print command executed successfully");
        } catch (psError) {
          console.log("PowerShell test print failed, trying traditional print command...");
          
          
          let printCommand;
          if (printerName) {
            printCommand = `print /d:"${printerName}" "${testFilePath}"`;
          } else {
            printCommand = `print "${testFilePath}"`;
          }
          
          console.log(`🧪 Executing fallback test print command: ${printCommand}`);
          const { stdout, stderr } = await execAsync(printCommand);
          
          if (stderr) {
            console.error("Test print stderr:", stderr);
            
          }
          
          if (stdout) {
            console.log("Test print stdout:", stdout);
          }
        }
      } else {
        
        const args = [];
        if (printerName) args.push("-d", printerName);
        args.push(testFilePath);
        await execFileAsync("lp", args);
      }
    } catch (printErr) {
      console.error("Test print error:", printErr);
      return res.status(500).json({
        success: false,
        message: "Test print failed",
        error: printErr.message,
      });
    }
    

    console.log("✅ Test print successful");

    res.json({
      success: true,
      message: "Test print successful",
      printer: printerName || "default",
    });
  } catch (error) {
    console.error("❌ Error testing printer:", error);
    res.status(500).json({
      success: false,
      message: "Failed to test printer",
      error: error.message,
    });
  }
});



router.get("/test-commands", async (req, res) => {
  try {
    console.log("🧪 Testing system commands...");
    
    const results = {};
    
    
    try {
      const { stdout } = await execAsync('powershell "Get-Command Get-Printer"');
      results.powershell = "Available";
    } catch (error) {
      results.powershell = "Not available";
    }
    
    
    try {
      const { stdout } = await execAsync('wmic printer list brief');
      results.wmic = "Available";
    } catch (error) {
      results.wmic = "Not available";
    }
    
    
    try {
      const { stdout } = await execAsync('reg query "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers"');
      results.registry = "Available";
    } catch (error) {
      results.registry = "Not available";
    }
    
    res.json({
      success: true,
      systemCommands: results,
      message: "System command availability test completed"
    });
    
  } catch (error) {
    console.error("❌ Error testing commands:", error);
    res.status(500).json({
      success: false,
      message: "Failed to test commands",
      error: error.message
    });
  }
});



router.post("/print-html-direct", async (req, res) => {
  try {
    const {
      html,
      printerName,
      fileName = "invoice_487.html",
      baseDir, 
    } = req.body;

    if (!html || typeof html !== "string") {
      return res.status(400).json({ success: false, message: "`html` is required" });
    }

    const invoiceDir = path.join(__dirname, "..", "invoice");
    await fs.mkdir(invoiceDir, { recursive: true });

    
    const htmlFileName = fileName.endsWith(".html") ? fileName : `${fileName}.html`;
    const htmlPath = path.join(invoiceDir, htmlFileName);
    await fs.writeFile(htmlPath, html, "utf8");

    
    const pdfFileName = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
    const pdfPath = path.join(invoiceDir, pdfFileName);

    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: 'C:\\Users\\Administrator\\.cache\\puppeteer\\chrome\\win64-141.0.7390.76\\chrome-win64\\chrome.exe',
      args: [
        "--no-sandbox", 
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu"
      ]
    });

    try {
      const page = await browser.newPage();

      
      
      
      const base = baseDir
        ? `file://${path.resolve(baseDir)}/`
        : `file://${path.dirname(htmlPath)}/`;

      
      const htmlWithBase = html.includes("<base ")
        ? html
        : html.replace(
            /<head([^>]*)>/i,
            `<head$1><base href="${base}">`
          );

      await page.setContent(htmlWithBase, { waitUntil: "networkidle0" });

      
      await page.pdf({
        path: pdfPath,
        format: "A4",             
        printBackground: true,    
        preferCSSPageSize: true,  
        margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" },
      });
    } finally {
      await browser.close();
    }

    
    try {
      if (process.platform === "win32") {
        
        
        if (printerName) {
          
          const cmd = `powershell -NoProfile -Command "Start-Process -FilePath '${pdfPath.replace(/'/g, "''")}' -Verb PrintTo -ArgumentList '${printerName.replace(/'/g, "''")}' -WindowStyle Hidden"`;
          await execAsync(cmd);
        } else {
          const cmd = `powershell -NoProfile -Command "Start-Process -FilePath '${pdfPath.replace(/'/g, "''")}' -Verb Print -WindowStyle Hidden"`;
          await execAsync(cmd);
        }
      } else {
        
        const args = [];
        if (printerName) args.push("-d", printerName);
        args.push(pdfPath);
        await execFileAsync("lp", args);
      }
    } catch (printErr) {
      
      console.error("🖨️ PDF print failed:", printErr);
      return res.status(500).json({
        success: false,
        message: "Printed PDF could not be sent to printer",
        error: printErr.message,
        pdfPath,
      });
    }

    return res.json({
      success: true,
      message: "HTML rendered with styles and sent to printer",
      printer: printerName || "default",
      pdfPath,
      htmlPath,
    });
  } catch (err) {
    console.error("❌ /print-html-styled error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to print styled HTML",
      error: err.message,
    });
  }
});


module.exports = router;
