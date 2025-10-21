// getPrintersUnicode.js
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const iconv = require("iconv-lite");

// Remove hidden bidi/zero-width marks, BOM, and normalize to NFC
function normalizeArabic(s = "") {
  return s
    .replace(/\uFEFF/g, "") // BOM
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "") // bidi/ZW
    .normalize("NFC")
    .trim();
}

async function getPrintersUnicode() {
  // Prefer PowerShell Get-Printer with explicit Unicode output
  const psCmd = [
    '$ErrorActionPreference="Stop";',
    "[Console]::OutputEncoding=[System.Text.Encoding]::Unicode;",
    "Get-Printer | Select-Object -ExpandProperty Name"
  ].join(" ");

    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -Command "${psCmd}"`,
      { encoding: "buffer", windowsHide: true, maxBuffer: 1024 * 1024 }
    );


    const text = iconv.decode(stdout, "utf16le");
    const names = text
      .split(/\r?\n/)
      .map(normalizeArabic)
      .filter(Boolean);

    // dedupe while preserving order
    return names;

}

module.exports = { getPrintersUnicode, normalizeArabic };
