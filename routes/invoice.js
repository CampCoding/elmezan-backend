const express = require("express");
const { executeQuery, executeStoredProcedure } = require("../config/database");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const puppeteer = require("puppeteer");
const {getPrintersUnicode, normalizeArabic} = require("../utils/getAllPrins");
let printPdfLib;
try {
  // Optional dependency: pdf-to-printer
  printPdfLib = require("pdf-to-printer");
} catch (_) {
  printPdfLib = null;
}






// Helper: compute next NUM1 for today 
async function getNextDailyNum1() {
  const query = `
    SELECT ISNULL(MAX(NUM1), 0) + 1 AS nextNum 
    FROM INVOICE
    WHERE DATEDIFF(day, INV_DATE, GETDATE()) = 0
  `;
  const result = await executeQuery(query);
  return result[0]?.nextNum || 1;
}

// Open a new table: create invoice with daily NUM1 and optional captain
router.post("/open", async (req, res) => {
  try {
    const { tableNumber, captainNo, captainName, note, menuType } = req.body;

    if (!tableNumber) {
      return res.status(400).json({ success: false, message: "tableNumber is required" });
    }

    const nextNum1 = await getNextDailyNum1();

    const insertQuery = `
      INSERT INTO INVOICE (
        INV_FT_NO, INV_DATE, NUM1, INV_CAPTAIN_NO, INV_CASH_NAME, INV_NOTE, MENU_TYPE, PAID, PRINTED, LOCK
      )
      OUTPUT Inserted.inv_seq AS inv_seq
      VALUES (?, GETDATE(), ?, ?, ?, ?, ?, 0, 0, 0)
    `;

    const values = [
      tableNumber,
      nextNum1,
      captainNo || 0,
      captainName || "",
      note || "",
      menuType || null,
    ];

    const inserted = await executeQuery(insertQuery, values);
    const invSeq = inserted[0]?.inv_seq;

    // Optionally persist captain name if provided (store to a text field INV_CASH_NAME to keep a display copy)
    // Optional post-update in case UI changes captain name later
    if (captainName && invSeq) {
      await executeQuery(`UPDATE INVOICE SET INV_CASH_NAME = ? WHERE inv_seq = ?`, [captainName, invSeq]);
    }

    res.status(201).json({
      success: true,
      message: "Table opened and invoice created",
      invoice: {
        inv_seq: invSeq,
        tableNumber,
        num1: nextNum1,
        captainNo: captainNo || null,
        captainName: captainName || null,
      },
    });
  } catch (error) {
    console.error("Error opening table:", error);
    res.status(500).json({ success: false, message: "Failed to open table", error: error.message });
  }
});

// Assign/Change captain for an invoice
router.post("/:invSeq/captain", async (req, res) => {
  try {
    const { invSeq } = req.params;
    const { captainNo, captainName } = req.body;
    if (!captainNo && !captainName) {
      return res.status(400).json({ success: false, message: "captainNo or captainName required" });
    }

    // Only update captain information; do NOT delete items or change PAID here
    await executeQuery(
      `UPDATE INVOICE 
       SET INV_CAPTAIN_NO = COALESCE(?, INV_CAPTAIN_NO), 
           INV_CASH_NAME = COALESCE(?, INV_CASH_NAME)
       WHERE inv_seq = ?`,
      [captainNo || null, captainName || null, invSeq]
    );

    res.json({ success: true, message: "Captain assigned/updated successfully" });
  } catch (error) {
    console.error("Error assigning captain:", error);
    res.status(500).json({ success: false, message: "Failed to assign captain", error: error.message });
  }
});

// Print flow: run SPs and set LOCK / PRINTED status
// Note: If stored procedures don't exist, the endpoint will still update invoice status
// but printing functionality will be limited. Check your database for actual SP names.
// body: { printType: 'kitchen' | 'bill' }
router.post("/:invSeq/print", async (req, res) => {
  try {
    const { invSeq } = req.params;
    const { printType } = req.body;

    const [invoice] = await executeQuery(`SELECT inv_seq, PAID, PRINTED, LOCK FROM INVOICE WHERE inv_seq = ?`, [invSeq]);
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }

    // Execute b1 first (if exists)
    try {
      await executeStoredProcedure("b1", { inv_seq: invSeq });
    } catch (e) {
      console.warn("Warning: SP b1 not found or failed, continuing...", e.message);
    }

    // If already paid, do nothing per spec
    if (invoice.PAID === 1) {
      return res.json({ success: true, message: "Already paid; no action taken" });
    }

    // Lock the invoice to avoid re-print
    await executeQuery(`UPDATE INVOICE SET LOCK = 1 WHERE inv_seq = ?`, [invSeq]);

    // Execute group SPs 1_Q .. 14_Q (if they exist)
    const groupProcedures = Array.from({ length: 14 }, (_, i) => `${i + 1}_Q`);
    for (const sp of groupProcedures) {
      try {
        await executeStoredProcedure(sp, { inv_seq: invSeq });
      } catch (e) {
        console.warn(`Warning: SP ${sp} not found or failed:`, e.message);
      }
    }

    // Execute fol reports
    try { await executeStoredProcedure("Test_fol", { inv_seq: invSeq }); } catch (e) { console.warn("Test_fol failed", e.message); }
    try { await executeStoredProcedure("TEST_FOL1", { inv_seq: invSeq }); } catch (e) { console.warn("TEST_FOL1 failed", e.message); }

    // Customer bill report on 'cash' printer (handled inside report)
    if (printType === "bill") {
      try { await executeStoredProcedure("NEW_FATOR", { inv_seq: invSeq }); } catch (e) { console.warn("NEW_FATOR failed", e.message); }
    }

    // Finalize with P11
    try { await executeStoredProcedure("P11", { inv_seq: invSeq }); } catch (e) { console.warn("P11 failed", e.message); }

    // Update status fields according to print type
    if (printType === "kitchen") {
      await executeQuery(`UPDATE INVOICE SET PAID = 2, PRINTED = 1 WHERE inv_seq = ?`, [invSeq]);
    } else if (printType === "bill") {
      await executeQuery(`UPDATE INVOICE SET PAID = 2, PRINTED = 2 WHERE inv_seq = ?`, [invSeq]);
    }

    res.json({ success: true, message: "Print procedures executed", lock: 1 });
  } catch (error) {
    console.error("Error printing invoice:", error);
    res.status(500).json({ success: false, message: "Failed to execute print flow", error: error.message });
  }
});


// Delete an item from INVOICE_MENU with LOCK/PP rules
// Note: If stored procedures don't exist, the endpoint will still delete the item
// but inventory/printing functionality will be limited. Check your database for actual SP names.
router.delete("/:invSeq/items/:autoSeq", async (req, res) => {
  try {
    const { invSeq, autoSeq } = req.params;

    const [inv] = await executeQuery(`SELECT LOCK FROM INVOICE WHERE inv_seq = ?`, [invSeq]);
    if (!inv) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    if (inv.LOCK === 1) {
      return res.status(403).json({ success: false, message: "Locked invoice; deletion not allowed" });
    }

    // Execute A1 first (inventory system hook) - if it exists
    try { await executeStoredProcedure("A1", { inv_seq: invSeq, auto_seq: autoSeq }); } catch (e) { console.warn("A1 SP not found or failed:", e.message); }

    const [item] = await executeQuery(`SELECT TOP 1 * FROM INVOICE_MENU WHERE auto_seq = ? AND INV_SEQ = ?`, [autoSeq, invSeq]);
    if (!item) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    // Rule: if lock = 1 AND PP = 1 => do nothing
    if (inv.LOCK === 1 && item.PP === 1) {
      return res.status(403).json({ success: false, message: "Locked and printed item; deletion not allowed" });
    }

    // Backup and stock corrections
    const runBackAndDel = async () => {
      try { await executeStoredProcedure("t00_BACK", { inv_seq: invSeq, auto_seq: autoSeq }); } catch (e) { console.warn("t00_BACK SP not found or failed:", e.message); }
      try { await executeStoredProcedure("b00", { inv_seq: invSeq, auto_seq: autoSeq }); } catch (e) { console.warn("b00 SP not found or failed:", e.message); }

      // Send deleted values to INVOICE_MENU_BACK
      try {
        await executeQuery(
          `INSERT INTO INVOICE_MENU_BACK (INV_SEQ, ITEM_NO, QTY, P, C, pp, NOTICE, THE_DATE, INV_FT_NO, NUM1, perc)
           SELECT i.INV_SEQ, i.ITEM_NO, i.QTY, i.P, CAST(i.PRICE AS varchar), i.PP, i.notice, GETDATE(), inv.INV_FT_NO, inv.NUM1, i.PER
           FROM INVOICE_MENU i
           JOIN INVOICE inv ON inv.inv_seq = i.INV_SEQ
           WHERE i.auto_seq = ? AND i.INV_SEQ = ?`,
          [autoSeq, invSeq]
        );
      } catch (e) { console.warn("Insert into INVOICE_MENU_BACK failed", e.message); }

      try { await executeStoredProcedure("DEL_WIN10", { inv_seq: invSeq, auto_seq: autoSeq }); } catch (e) { console.warn("DEL_WIN10 SP not found or failed:", e.message); }
    };

    // If item was printed and invoice not locked, optional confirmation should be handled client-side
    // Proceed with same back-and-delete sequence for both PP states
    await runBackAndDel();

    // Append deleted items snapshot (for audit) - if SP exists
    try { await executeStoredProcedure("APPEND_DELETED_ITEMS", { inv_seq: invSeq, auto_seq: autoSeq }); } catch (e) { console.warn("APPEND_DELETED_ITEMS SP not found or failed:", e.message); }

    // Finally, remove the item from INVOICE_MENU
    await executeQuery(`DELETE FROM INVOICE_MENU WHERE auto_seq = ? AND INV_SEQ = ?`, [autoSeq, invSeq]);

    // Print deletion notice to kitchen via d_1 - if SP exists
    try { await executeStoredProcedure("d_1", { inv_seq: invSeq }); } catch (e) { console.warn("d_1 SP not found or failed:", e.message); }

    res.json({ success: true, message: "Item deleted and inventory updated" });
  } catch (error) {
    console.error("Error deleting invoice item:", error);
    res.status(500).json({ success: false, message: "Failed to delete item", error: error.message });
  }
});

// Check paid procedure for red/yellow table entry
// Note: If check_paid SP doesn't exist, this will return basic invoice status
router.post("/:invSeq/check-paid", async (req, res) => {
  try {
    const { invSeq } = req.params;

    // Try to execute the stored procedure if it exists
    try {
      const result = await executeStoredProcedure("check_paid", { inv_seq: invSeq });
      res.json({ success: true, result, source: "stored_procedure" });
    } catch (spError) {
      console.warn("Warning: check_paid SP not found, returning basic invoice status:", spError.message);

      // Fallback: return basic invoice status from database
      const [invoice] = await executeQuery(`
        SELECT inv_seq, PAID, PRINTED, LOCK, INV_FT_NO, NUM1, INV_DATE, INV_CASH_NAME
        FROM INVOICE WHERE inv_seq = ?
      `, [invSeq]);

      if (!invoice) {
        return res.status(404).json({ success: false, message: "Invoice not found" });
      }

      res.json({
        success: true,
        message: "check_paid SP not available, returning basic status",
        result: {
          inv_seq: invoice.inv_seq,
          table_number: invoice.INV_FT_NO,
          num1: invoice.NUM1,
          date: invoice.INV_DATE,
          captain: invoice.INV_CASH_NAME,
          status: {
            paid: invoice.PAID,
            printed: invoice.PRINTED,
            locked: invoice.LOCK
          },
          table_color: invoice.PRINTED === 2 ? "yellow" : (invoice.PRINTED === 1 ? "red" : "green")
        },
        source: "database_fallback"
      });
    }
  } catch (error) {
    console.error("Error in check-paid endpoint:", error);
    res.status(500).json({ success: false, message: "Failed to check invoice status", error: error.message });
  }
});

// Settle/Pay an invoice (return table to green)
// POST /api/invoice/:invSeq/pay
router.post("/:invSeq/pay", async (req, res) => {
  try {
    const { invSeq } = req.params;
    const rows = await executeQuery(`SELECT inv_seq FROM INVOICE WHERE inv_seq = ?`, [invSeq]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }

    await executeQuery(`UPDATE INVOICE SET PAID = 1 WHERE inv_seq = ?`, [invSeq]);
    await executeQuery(`DELETE FROM INVOICE_MENU WHERE INV_SEQ = ?`, [invSeq]);

    res.json({ success: true, message: "Invoice settled (PAID=1). Table will show green." });
  } catch (error) {
    console.error("Error settling invoice:", error);
    res.status(500).json({ success: false, message: "Failed to settle invoice", error: error.message });
  }
});

// Utility: get today's next NUM1
router.get("/today/next-num1", async (_req, res) => {
  try {
    const nextNum1 = await getNextDailyNum1();
    res.json({ success: true, nextNum1 });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to compute next NUM1", error: error.message });
  }
});

// List invoices with optional filters
// GET /api/invoice?from=YYYY-MM-DD&to=YYYY-MM-DD&tableNumber=12&paid=0|1|2&printed=0|1|2
router.get("/", async (req, res) => {
  try {
    const { from, to, tableNumber, paid, printed } = req.query;
    const where = [];
    const params = [];

    if (from) { where.push("INV_DATE >= ?"); params.push(from); }
    if (to) { where.push("INV_DATE < DATEADD(day, 1, ?)"); params.push(to); }
    if (tableNumber) { where.push("INV_FT_NO = ?"); params.push(tableNumber); }
    if (paid !== undefined) { where.push("PAID = ?"); params.push(paid); }
    if (printed !== undefined) { where.push("PRINTED = ?"); params.push(printed); }

    const query = `
			SELECT inv_seq, NUM1, INV_DATE, INV_FT_NO, INV_CAPTAIN_NO, INV_CASH_NAME,
			       PAID, PRINTED, LOCK, COST, CUSTOMER_NAME, INV_NOTE
			FROM INVOICE
			${where.length ? "WHERE " + where.join(" AND ") : ""}
			ORDER BY INV_DATE DESC
		`;

    const invoices = await executeQuery(query, params);
    if (invoices.length === 0) {
      return res.json({ success: true, invoices: [], total: 0, summary: { totalAmount: 0, totalPaidAmount: 0, totalUnpaidAmount: 0, totalPrintedUnsettledAmount: 0 } });
    }

    // Fetch items for all invoices and include item names
    const invSeqs = invoices.map(r => r.inv_seq);
    const placeholders = invSeqs.map(() => '?').join(', ');
    const itemsQuery = `
			SELECT i.INV_SEQ, i.auto_seq, i.ITEM_NO, it.Item_name AS item_name, i.QTY, i.PRICE, i.notice, i.PP,
			       (CAST(i.QTY AS float) * CAST(i.PRICE AS float)) AS line_total
			FROM INVOICE_MENU i
			LEFT JOIN ITEM it ON CAST(it.Item_no AS varchar(50)) = CAST(i.ITEM_NO AS varchar(50))
			WHERE i.INV_SEQ IN (${placeholders})
			ORDER BY i.INV_SEQ, i.auto_seq
		`;
    const itemRows = await executeQuery(itemsQuery, invSeqs);

    const itemsByInvoice = {};
    const totalsByInvoice = {};
    for (const row of itemRows) {
      const key = row.INV_SEQ;
      if (!itemsByInvoice[key]) itemsByInvoice[key] = [];
      const lineTotal = Number(row.line_total) || 0;
      itemsByInvoice[key].push({
        auto_seq: row.auto_seq,
        itemNo: row.ITEM_NO,
        itemName: row.item_name || null,
        qty: row.QTY,
        price: row.PRICE,
        notice: row.notice || '',
        pp: row.PP || 0,
        lineTotal
      });
      totalsByInvoice[key] = (totalsByInvoice[key] || 0) + lineTotal;
    }

    const enriched = invoices.map(inv => ({
      ...inv,
      captain: inv.INV_CASH_NAME,
      items: itemsByInvoice[inv.inv_seq] || [],
      invoiceTotal: +(totalsByInvoice[inv.inv_seq] || 0)
    }));

    // Summary totals
    const totalAmount = enriched.reduce((s, r) => s + (Number(r.invoiceTotal) || 0), 0);
    const totalPaidAmount = enriched.filter(r => r.PAID === 1).reduce((s, r) => s + (Number(r.invoiceTotal) || 0), 0);
    const totalPrintedUnsettledAmount = enriched.filter(r => r.PAID === 2).reduce((s, r) => s + (Number(r.invoiceTotal) || 0), 0);
    const totalUnpaidAmount = totalAmount - totalPaidAmount;

    res.json({ success: true, invoices: enriched, total: enriched.length, summary: { totalAmount, totalPaidAmount, totalUnpaidAmount, totalPrintedUnsettledAmount } });
  } catch (error) {
    console.error("Error listing invoices:", error);
    res.status(500).json({ success: false, message: "Failed to list invoices", error: error.message });
  }
});

// Get a single invoice with its items
router.get("/:invSeq", async (req, res) => {
  try {
    const { invSeq } = req.params;
    const invRows = await executeQuery(
      `SELECT inv_seq, NUM1, INV_DATE, INV_FT_NO, INV_CAPTAIN_NO, INV_CASH_NAME,
              PAID, PRINTED, LOCK, COST, CUSTOMER_NAME, INV_NOTE
       FROM INVOICE WHERE inv_seq = ?`,
      [invSeq]
    );
    if (!invRows.length) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    const items = await executeQuery(
      `SELECT auto_seq, INV_SEQ, ITEM_NO, QTY, P, F_PRICE, S_PRICE, PRICE, notice, PP
       FROM INVOICE_MENU WHERE INV_SEQ = ? ORDER BY auto_seq`,
      [invSeq]
    );
    res.json({ success: true, invoice: invRows[0], items });
  } catch (error) {
    console.error("Error fetching invoice:", error);
    res.status(500).json({ success: false, message: "Failed to fetch invoice", error: error.message });
  }
});

// Test endpoint to check available stored procedures
router.get("/test-sps", async (_req, res) => {
  try {
    const query = `
      SELECT ROUTINE_NAME 
      FROM INFORMATION_SCHEMA.ROUTINES 
      WHERE ROUTINE_TYPE = 'PROCEDURE' 
      AND ROUTINE_SCHEMA = 'dbo'
      ORDER BY ROUTINE_NAME
    `;
    const sps = await executeQuery(query);
    res.json({
      success: true,
      message: "Available stored procedures",
      storedProcedures: sps.map(sp => sp.ROUTINE_NAME),
      total: sps.length
    });
  } catch (error) {
    console.error("Error checking stored procedures:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check stored procedures",
      error: error.message
    });
  }
});

// Get table information with captain and invoice details (using Tab_tables)
// GET /api/invoice/table/:tableNumber
router.get("/table/:tableNumber", async (req, res) => {
  try {
    const { tableNumber } = req.params;

    // Get table info with current invoice and captain from Tab_tables
    const tableQuery = `
      SELECT 
        tt.id AS tableId,
        tt.Tb_no,
        tt.Tb_sala AS areaName,
        i.inv_seq,
        i.INV_CAPTAIN_NO,
        i.INV_CASH_NAME,
        i.PAID,
        i.PRINTED,
        i.LOCK,
        i.INV_DATE,
        i.NUM1,
        i.INV_NOTE
        FROM Tab_tables tt
      LEFT JOIN (
        SELECT INV_FT_NO, inv_seq, INV_CAPTAIN_NO, INV_CASH_NAME, PAID, PRINTED, LOCK, INV_DATE, NUM1, INV_NOTE,
               ROW_NUMBER() OVER (PARTITION BY INV_FT_NO ORDER BY INV_DATE DESC, inv_seq DESC) AS rn
        FROM INVOICE
        WHERE INV_FT_NO IS NOT NULL
          AND DATEDIFF(day, INV_DATE, GETDATE()) = 0
      ) i ON tt.Tb_no = i.INV_FT_NO AND i.rn = 1
      WHERE tt.Tb_no = ?
    `;

    const tables = await executeQuery(tableQuery, [tableNumber]);

    if (tables.length === 0) {
      return res.status(404).json({ success: false, message: "Table not found" });
    }

    const table = tables[0];

    // Get items if table has an active invoice
    let items = [];
    let invoiceTotal = 0;

    if (table.inv_seq) {
      const itemsQuery = `
        SELECT 
          im.auto_seq,
          im.ITEM_NO,
          it.Item_name AS item_name,
          im.QTY,
          im.PRICE,
          im.notice,
          im.PP,
          (CAST(im.QTY AS float) * CAST(im.PRICE AS float)) AS line_total
        FROM INVOICE_MENU im
        LEFT JOIN ITEM it ON CAST(it.Item_no AS varchar(50)) = CAST(im.ITEM_NO AS varchar(50))
        WHERE im.INV_SEQ = ?
        ORDER BY im.auto_seq
      `;

      items = await executeQuery(itemsQuery, [table.inv_seq]);
      invoiceTotal = items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0);

      items = items.map(item => ({
        auto_seq: item.auto_seq,
        itemNo: item.ITEM_NO,
        itemName: item.item_name || null,
        qty: item.QTY,
        price: item.PRICE,
        notice: item.notice || '',
        pp: item.PP || 0,
        lineTotal: Number(item.line_total) || 0
      }));
    }

    // Determine color based on invoice status
    let color = "green";
    if (table.inv_seq) {
      if (table.PAID === 2 && table.PRINTED === 2) {
        color = "yellow"; // قائمة الحساب مطبوعة
      } else if (table.PAID === 2 && table.PRINTED === 1) {
        color = "red"; // أوردر المطبخ مطبوع
      }
    }

    // If table is not green (i.e., has printed states), build details from check_paid stored procedure if available
    let checkPaid = null;
    if (table.inv_seq && color !== "green") {
      try {
        checkPaid = await executeStoredProcedure("check_paid", { inv_seq: table.inv_seq });
      } catch (e) {
        console.warn("check_paid SP failed or missing:", e.message);
      }
    }
    // await executeQuery(`DELETE FROM INVOICE_MENU WHERE INV_SEQ = ?`, [invSeq]);

    res.json({
      success: true,
      table: {
        id: table.tableId,
        tableNumber: table.Tb_no,
        areaName: table.areaName,
        status: table.inv_seq ? "occupied" : "available",
        color,
        captain: table.inv_seq ? {
          captainNo: table?.INV_CAPTAIN_NO,
          captainName: table.INV_CASH_NAME || table.CAPTAIN_NAME,
          displayName: table.INV_CASH_NAME || table.CAPTAIN_NAME || "غير محدد"
        } : null,
        invoice: table.inv_seq ? {
          inv_seq: table.inv_seq,
          num1: table.NUM1,
          date: table.INV_DATE,
          paid: table.PAID,
          printed: table.PRINTED,
          locked: table.LOCK,
          note: table.INV_NOTE,
          total: invoiceTotal,
          items: items,
          check_paid: checkPaid
        } : null
      }
    });
  } catch (error) {
    console.error("Error fetching table info:", error);
    res.status(500).json({ success: false, message: "Failed to fetch table info", error: error.message });
  }
});

// Clear/Reset table status - make table available again
// POST /api/invoice/table/:tableNumber/clear
router.post("/table/:tableNumber/clear", async (req, res) => {
  try {
    const { tableNumber } = req.params;

    // Get the current invoice for this table
    const [currentInvoice] = await executeQuery(`
      SELECT inv_seq, PAID, PRINTED, LOCK 
      FROM INVOICE 
      WHERE INV_FT_NO = ? 
        AND DATEDIFF(day, INV_DATE, GETDATE()) = 0
      ORDER BY inv_seq DESC
    `, [tableNumber]);

    if (currentInvoice) {
      // If invoice exists and is not paid, mark it as paid to make table available
      if (currentInvoice.PAID !== 1) {
        await executeQuery(`UPDATE INVOICE SET PAID = 1 WHERE inv_seq = ?`, [currentInvoice.inv_seq]);
      }
    }

    res.json({
      success: true,
      message: "Table cleared and made available",
      tableNumber: tableNumber
    });
  } catch (error) {
    console.error("Error clearing table:", error);
    res.status(500).json({ success: false, message: "Failed to clear table", error: error.message });
  }
});

// Lock and clear invoice: set PAID=1, remove items, and clear captain fields
// POST /api/invoice/:invSeq/lock-and-clear
router.post("/:invSeq/lock-and-clear", async (req, res) => {
  try {
    const { invSeq } = req.params;
    // Read current invoice status first
    const rows = await executeQuery(`SELECT inv_seq, PRINTED FROM INVOICE WHERE inv_seq = ?`, [invSeq]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    const printedStatus = Number(rows[0]?.PRINTED ?? 0);

    // If invoice has NOT been fully printed for client (PRINTED != 2), return stock back
    if (printedStatus !== 2) {
      try {
        const items = await executeQuery(
          `SELECT ITEM_NO, QTY FROM INVOICE_MENU WHERE INV_SEQ = ?`,
          [invSeq]
        );
        for (const it of items) {
          const itemNo = it?.ITEM_NO;
          const qty = Number(it?.QTY || 0);
          if (!itemNo || !Number.isFinite(qty) || qty <= 0) continue;
          // Add back quantity to stock balance
          await executeQuery(
            `UPDATE ITEM SET Balance = CAST(Balance AS float) + CAST(? AS float)
             WHERE CAST(Item_no AS varchar(50)) = CAST(? AS varchar(50))`,
            [qty, itemNo]
          );
        }
      } catch (stockErr) {
        console.warn("Failed to return stock to ITEM balance during lock-and-clear:", stockErr?.message);
      }
    }

    // Reset invoice flags prior to deletion for consistency
    try { await executeQuery(`UPDATE INVOICE SET PAID = 0, PRINTED = 0 WHERE inv_seq = ?`, [invSeq]); } catch {}

    // Delete items
    await executeQuery(`DELETE FROM INVOICE_MENU WHERE INV_SEQ = ?`, [invSeq]);
    // Clear captain and mark paid
    await executeQuery(`DELETE FROM INVOICE WHERE inv_seq = ?`, [invSeq]);

    return res.json({ success: true, message: "Invoice locked and cleared (items and captain removed)" });
  } catch (error) {
    console.error("Error lock-and-clear invoice:", error);
    return res.status(500).json({ success: false, message: "Failed to lock and clear invoice", error: error.message });
  }
});

module.exports = router;

// Ensure a temp print directory that won't trigger frontend HMR reloads
const PRINT_DIR = path.join(os.tmpdir(), "elmezan_print");
if (!fs.existsSync(PRINT_DIR)) {
  try { fs.mkdirSync(PRINT_DIR, { recursive: true }); } catch { }
}

// === Print invoice as TEXT using PowerShell ===
// POST /api/invoice/:invSeq/print-text { printerName? }
const TEXT_WIDTH = 42;
const padRight = (t = "", w = TEXT_WIDTH) => (String(t).length >= w ? String(t).slice(0, w) : String(t) + " ".repeat(w - String(t).length));
const padLeft = (t = "", w = TEXT_WIDTH) => (String(t).length >= w ? String(t).slice(-w) : " ".repeat(w - String(t).length) + String(t));
const center = (t = "", w = TEXT_WIDTH) => {
  const s = String(t);
  if (s.length >= w) return s.slice(0, w);
  const l = Math.floor((w - s.length) / 2);
  return " ".repeat(l) + s + " ".repeat(w - s.length - l);
};
const line = (ch = "─", w = TEXT_WIDTH) => ch.repeat(w);

function formatInvoiceTextServer(invoice, items) {
  const date = new Date();
  const dateStr = date.toLocaleDateString("ar-SA");
  const timeStr = date.toLocaleTimeString("ar-SA");

  const header = [center("الميزان", TEXT_WIDTH), center(line(), TEXT_WIDTH)].join("\n");
  const topInfo = [
    padRight(`القائمة ${invoice.NUM1 ?? ""}`, TEXT_WIDTH),
    padRight(`تاريخ ${dateStr}`.padStart(TEXT_WIDTH / 2), TEXT_WIDTH),
    padRight(`الوقت ${timeStr}`.padStart(TEXT_WIDTH / 2), TEXT_WIDTH),
  ].join("\n");

  const tableBox = (() => {
    const table = String(invoice.INV_FT_NO ?? "");
    const boxWidth = 8;
    const content = center(table, boxWidth - 2);
    const top = "┌" + "─".repeat(boxWidth - 2) + "┐";
    const mid = "│" + content + "│";
    const bot = "└" + "─".repeat(boxWidth - 2) + "┘";
    return [top, mid, bot].join("\n");
  })();

  const columnsHeader = (() => {
    const qtyW = 6;
    const nameW = TEXT_WIDTH - qtyW - 2;
    return padLeft("العدد", qtyW) + "  " + padLeft("المادة".padStart(nameW), nameW);
  })();

  const itemLines = items.map((it) => {
    const qtyW = 6;
    const nameW = TEXT_WIDTH - qtyW - 2;
    const qty = padLeft(String(it.QTY ?? 0), qtyW);
    const name = padRight(String(it.item_name || it.ITEM_NO || ""), nameW);
    return qty + "  " + name;
  });

  const body = [line(), columnsHeader, line(), ...itemLines, line()].join("\n");
  const total = items.reduce((s, it) => s + Number(it.line_total || 0), 0);
  const footer = [padRight(`الملاحظات: ${invoice.INV_NOTE || ""}`, TEXT_WIDTH), center(line(), TEXT_WIDTH)].join("\n");

  return [
    header,
    topInfo,
    tableBox,
    padLeft("", TEXT_WIDTH),
    body,
    padLeft(`المجموع: ${Number(total).toFixed(0)}`, TEXT_WIDTH),
    footer,
  ].join("\n");
}

router.post("/:invSeq/print-text", async (req, res) => {
  try {
    const { invSeq } = req.params;
    const { printerName } = req.body || {};

    // Load invoice + items
    const [inv] = await executeQuery(
      `SELECT inv_seq, NUM1, INV_FT_NO, INV_DATE, INV_NOTE FROM INVOICE WHERE inv_seq = ?`,
      [invSeq]
    );
    if (!inv) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    const items = await executeQuery(
      `SELECT im.auto_seq, im.ITEM_NO, it.Item_name AS item_name, im.QTY, im.PRICE,
              (CAST(im.QTY AS float) * CAST(im.PRICE AS float)) AS line_total
       FROM INVOICE_MENU im
       LEFT JOIN ITEM it ON CAST(it.Item_no AS varchar(50)) = CAST(im.ITEM_NO AS varchar(50))
       WHERE im.INV_SEQ = ?
       ORDER BY im.auto_seq`,
      [invSeq]
    );

    const textContent = formatInvoiceTextServer(inv, items);

    // Save to OS temp directory to avoid dev server reloads
    const filePath = path.join(PRINT_DIR, `invoice_${invSeq}.txt`);
    fs.writeFileSync(filePath, textContent, { encoding: "utf8" });

    // Print via PowerShell on Windows; fallback to default 'print' or CUPS on other OS
    if (process.platform === "win32") {
      const safePath = filePath.replace(/'/g, "''");
      if (printerName) {
        const safePrinter = String(printerName).replace(/'/g, "''");
        const cmd = `powershell -NoProfile -Command "Start-Process -FilePath '${safePath}' -Verb PrintTo -ArgumentList '${safePrinter}' -WindowStyle Hidden"`;
        await execAsync(cmd);
      } else {
        const cmd = `powershell -NoProfile -Command "Start-Process -FilePath '${safePath}' -Verb Print -WindowStyle Hidden"`;
        await execAsync(cmd);
      }
    } else {
      const args = printerName ? [`-d`, printerName, filePath] : [filePath];
      await execAsync(`lp ${args.map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(" ")}`);
    }

    return res.json({ success: true, message: "Text printed", filePath, printer: printerName || "default" });
  } catch (error) {
    console.error("print-text error:", error);
    return res.status(500).json({ success: false, message: "Failed to print text", error: error.message });
  }
});

// === Print invoice as STYLED HTML silently (PDF -> PrintTo) ===
// POST /api/invoice/:invSeq/print-html { printerName? }
router.post("/:invSeq/print-html", async (req, res) => {
  // ===== Helpers ============================================================
  const normalizeArabic = (s = "") =>
    String(s)
      .normalize("NFC")
      .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
      .trim();

  const safeForFile = (s = "") =>
    String(s).replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "cat";

  async function htmlToPdf(htmlStr, outBaseName /* no ext */) {
    const htmlPath = path.join(PRINT_DIR, `${outBaseName}.html`);
    const pdfPath = path.join(PRINT_DIR, `${outBaseName}.pdf`);
    fs.writeFileSync(htmlPath, htmlStr, "utf8");

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
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
    await page.pdf({
      path: pdfPath,
      printBackground: true,
      width: "80mm",
      margin: { top: "4mm", right: "4mm", bottom: "4mm", left: "4mm" },
    });
    await browser.close();
    return { htmlPath, pdfPath };
  }

  async function printPdfFile(pdfPath, targetPrinter /* string | undefined */) {
    // Preferred: pdf-to-printer
    if (printPdfLib && typeof printPdfLib.print === "function") {
      try {
        const opts = {};
        if (targetPrinter) opts.printer = String(targetPrinter);
        await printPdfLib.print(pdfPath, opts);
        return { ok: true, method: "pdf-to-printer", printer: targetPrinter || "default" };
      } catch (e) {
        // continue to fallback
      }
    }

    // Fallbacks
    try {
      if (process.platform === "win32") {
        const safePdf = pdfPath.replace(/'/g, "''");
        if (targetPrinter) {
          const safePrinter = String(targetPrinter).replace(/'/g, "''");
          await execAsync(
            `powershell -NoProfile -Command "Start-Process -FilePath '${safePdf}' -Verb PrintTo -ArgumentList '${safePrinter}' -WindowStyle Hidden"`
          );
        } else {
          await execAsync(
            `powershell -NoProfile -Command "Start-Process -FilePath '${safePdf}' -Verb Print -WindowStyle Hidden"`
          );
        }
      } else {
        const args = targetPrinter ? ["-d", targetPrinter, pdfPath] : [pdfPath];
        await execAsync(`lp ${args.map(a => `'${String(a).replace(/'/g, "'\\''")}'`).join(" ")}`);
      }
      return { ok: true, method: "os-fallback", printer: targetPrinter || "default" };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), printer: targetPrinter || "default" };
    }
  }

const buildKitchenHtml = (inv, categoryName, catItems, dateStr, timeStr) => `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>${categoryName}</title></head>
<body style="margin:0;padding:0;font-family:Tahoma,Arial,sans-serif;color:#000;">
  <div style="width:70mm;margin:0 auto;padding:6mm 4mm;box-sizing:border-box;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div style="font-size:14px;font-weight:700;">${"الميزان"}</div>
      <div style="font-size:14px;font-weight:700;">${dateStr} - ${timeStr}</div>
    </div>
    <div style="border:2px solid #000;padding:4px 6px;margin-bottom:8px;text-align:center;font-weight:700;font-size:16px;">
      ${categoryName}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr>
          <th style="border-bottom:1px solid #000;padding:3px 4px;">الملاحظات</th>

          <th style="border-bottom:1px solid #000;padding:3px 4px;width:18mm;">العدد</th>
          <th style="border-bottom:1px solid #000;padding:3px 4px;">المادة</th>
        </tr>
      </thead>
      <tbody>
        ${catItems.map(r => `
          <tr>
            <td style="border-bottom:1px solid #000;padding:4px 4px;text-align:center;">${r?.notice || ""}</td>
            <td style="border-bottom:1px solid #000;padding:4px 4px;text-align:center;">${r.QTY}</td>
              <td style="border-bottom:1px solid #000;padding:4px 4px;">${r.item_name || r.ITEM_NO}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div style="margin-top:6mm;height:2mm;background:#000;"></div>
  </div>
</body>
</html>`;

const buildFullHtml = (inv, items, dateStr, timeStr, wasPrintedBefore) => `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>فاتورة ${inv.NUM1}</title>
</head>
<body style="margin:0;padding:0;font-family:Tahoma, Arial, sans-serif; color:#000;">
  <div style="width:70mm;margin:0 auto;padding:6mm 4mm;box-sizing:border-box;">
    <div style="display:grid;grid-template-columns:1fr auto;align-items:end;margin-bottom:2mm;font-size:14px;font-weight:700;">
      <div style="justify-self:start;letter-spacing:.2px;">${"الميزان"} ${wasPrintedBefore ? '<span style="font-size:11px;font-weight:700;margin-inline-start:6px;">للمتابعة</span>' : ''}</div>
      <div style="justify-self:end;display:flex;align-items:center;gap:6px;font-weight:700;">
        <span>القائمة</span><span>${inv.NUM1 || ""}</span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6mm;font-size:12px;margin-bottom:2mm;">
      <div style="display:flex;align-items:center;gap:4px;"><span style="font-weight:700;">تاريخ</span><span>${dateStr}</span></div>
      <div style="display:flex;align-items:center;gap:4px;"><span style="font-weight:700;">الوقت</span><span>${timeStr}</span></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:6mm;margin-bottom:3mm;">
      <div style="display:flex;gap:12px;font-size:12px;">
        <div style="padding:2px 8px;border:1px solid #000;border-radius:2px;font-weight:700;text-decoration:underline;">صالة</div>
        <div style="padding:2px 8px;border:1px solid #000;border-radius:2px;font-weight:700;text-decoration:underline;">صالة</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="display:grid;place-items:center;width:22mm;height:12mm;border:2px solid #333;background:#fff;">
          <div style="font-size:18px;font-weight:700;line-height:1;">${inv.INV_FT_NO || ""}</div>
        </div>
        <div style="margin-top:1.2mm;font-size:12px;font-weight:700;">الطاولة</div>
      </div>
    </div>

    <div style="border-top:3px solid #000;margin:3mm 0 2mm;"></div>

    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr>
         <th style="border-bottom:1px solid #000;padding:3px 4px;text-align:center;font-weight:700;text-decoration:underline;">المادة</th>
         <th style="border-bottom:1px solid #000;padding:3px 4px;text-align:center;font-weight:700;width:16mm;text-decoration:underline;">العدد</th>
          <th style="border-bottom:1px solid #000;padding:3px 4px;text-align:center;font-weight:700;width:28mm;text-decoration:underline;">الملاحظات</th>
          
         
        </tr>
      </thead>
      <tbody>
        ${items.map(r => `
          <tr>
          <td style="border-bottom:1px solid #000;padding:4px 4px;text-align:center;vertical-align:middle;">${r?.item_name || r?.ITEM_NO}</td>
            
            <td style="border-bottom:1px solid #000;padding:4px 4px;text-align:center;vertical-align:middle;width:16mm;">${r.QTY}</td>
            <td style="border-bottom:1px solid #000;padding:4px 4px;text-align:right;vertical-align:middle;width:28mm;">${r?.notice || ""}</td>
            
          </tr>
        `).join("")}
      </tbody>
    </table>

    <div style="margin-top:4mm;height:10mm;background:#333;"></div>
  </div>
</body>
</html>`;

  // ===== Route Body =========================================================
  const printers = await getPrintersUnicode(); // -> array of names
  console.log("Printers:", printers.map(p => p));

  try {
    const { invSeq } = req.params;
    const { printerName } = req.body || {};
    await executeQuery(`UPDATE INVOICE SET PAID = 0, PRINTED = 1 WHERE inv_seq = ?`, [invSeq]);

    // Load header
    const [inv] = await executeQuery(
      `SELECT inv_seq, NUM1, INV_FT_NO, INV_DATE, INV_CASH_NAME, INV_NOTE, PRINTED
       FROM INVOICE WHERE inv_seq = ?`,
      [invSeq]
    );
    if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });

    // Load items
    const items = await executeQuery(
      `SELECT im.auto_seq, im.ITEM_NO, it.Item_name AS item_name, im.QTY, im.PRICE,
              (CAST(im.QTY AS float) * CAST(im.PRICE AS float)) AS line_total,
              cc.CLASS_NAME AS category_name
       FROM INVOICE_MENU im
       LEFT JOIN ITEM it ON CAST(it.Item_no AS varchar(50)) = CAST(im.ITEM_NO AS varchar(50))
       LEFT JOIN CLASSCODE cc ON CAST(it.CLASS AS varchar(50)) = CAST(cc.CLASS_NO AS varchar(50))
       WHERE im.INV_SEQ = ?
       ORDER BY im.auto_seq`,
      [invSeq]
    );

    const total = items.reduce((s, r) => s + (Number(r.line_total) || 0), 0);
    const date = new Date(inv.INV_DATE || Date.now());
    const dateStr = new Date(date).toLocaleDateString("ar-SA");
    const timeStr = new Date(date).toLocaleTimeString("ar-SA");
    const wasPrintedBefore = Number(inv.PRINTED || 0) > 0;

    // Group by category
    const groupedItems = items.reduce((acc, item) => {
      const key = item.category_name || "غير مصنف";
      (acc[key] = acc[key] || []).push(item);
      return acc;
    }, {});
    console.log(groupedItems);

    // Build normalized printer map
    const printersByNorm = new Map();
    (printers || []).forEach((p) => printersByNorm.set(normalizeArabic(p), p));

    // 1) Print each category to its own printer
    const perCategoryResults = [];
    for (const [catName, catItems] of Object.entries(groupedItems)) {
      const matchPrinter = printersByNorm.get(normalizeArabic(catName));
      if (!matchPrinter) {
        perCategoryResults.push({
          category: catName,
          printed: false,
          reason: "no matching printer by name",
        });
        continue;
      }

      const catHtml = buildKitchenHtml(inv, catName, catItems, dateStr, timeStr);
      const base = `invoice_${invSeq}_cat_${safeForFile(catName)}`;
      const { pdfPath: catPdfPath } = await htmlToPdf(catHtml, base);
      const r = await printPdfFile(catPdfPath, matchPrinter);
      perCategoryResults.push({
        category: catName,
        printed: !!r.ok,
        printer: matchPrinter,
        method: r.method || "unknown",
        error: r.ok ? undefined : r.error,
      });
    }

    // 2) Print the full invoice to default (or to req.body.printerName if provided)
    const fullHtml = buildFullHtml(inv, items, dateStr, timeStr, wasPrintedBefore);
    const fullBase = `invoice_${invSeq}_full`;
    const { htmlPath, pdfPath } = await htmlToPdf(fullHtml, fullBase);

    const finalPrint = await printPdfFile(pdfPath, printerName /* undefined => default */);
    const finalOk = !!finalPrint.ok;

    // Update status only if the final invoice printed OK
    if (finalOk) {
      try {
        await executeQuery(`UPDATE INVOICE SET PAID = 2, PRINTED = 1 WHERE inv_seq = ?`, [invSeq]);
      } catch (_) {}
    }

    return res.json({
      success: finalOk,
      message: finalOk ? "Printed kitchen tickets by category and final invoice" : "Printing finished with errors",
      totals: { items: items.length, amount: total },
      perCategoryResults,
      final: {
        ok: finalOk,
        method: finalPrint.method || "unknown",
        printer: finalPrint.printer || (printerName || "default"),
        error: finalOk ? undefined : finalPrint.error,
        pdfPath,
        htmlPath,
      },
    });
  } catch (err) {
    console.error("print-html error:", err);
    return res.status(500).json({ success: false, message: "Failed to print HTML", error: err.message });
  }
});


router.post("/:invSeq/print-html-priced", async (req, res) => {
  // ===== Helpers (يمكنك رفعها لمستوى أعلى وإعادة استخدامها) ==============
  const normalizeArabic = (s = "") =>
    String(s).normalize("NFC").replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").trim();

  const safeForFile = (s = "") =>
    String(s).replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "invoice";

  const fmtNum = (n) => Number(n ?? 0).toLocaleString("ar-EG");
  const fmtMoney = (n) => Number(n ?? 0).toLocaleString("ar-EG"); // أضف رمز العملة لو حابب

  async function htmlToPdf(htmlStr, outBaseName /* no ext */) {
    const htmlPath = path.join(PRINT_DIR, `${outBaseName}.html`);
    const pdfPath = path.join(PRINT_DIR, `${outBaseName}.pdf`);
    fs.writeFileSync(htmlPath, htmlStr, "utf8");

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
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
    await page.pdf({
      path: pdfPath,
      printBackground: true,
      width: "80mm",
      margin: { top: "4mm", right: "4mm", bottom: "4mm", left: "4mm" },
    });
    await browser.close();
    return { htmlPath, pdfPath };
  }

  async function printPdfFile(pdfPath, targetPrinter /* string | undefined */) {
    // pdf-to-printer أولاً
    if (printPdfLib && typeof printPdfLib.print === "function") {
      try {
        const opts = {};
        if (targetPrinter) opts.printer = String(targetPrinter);
        await printPdfLib.print(pdfPath, opts);
        return { ok: true, method: "pdf-to-printer", printer: targetPrinter || "default" };
      } catch (_) {}
    }
    // نظام التشغيل fallback
    try {
      if (process.platform === "win32") {
        const safePdf = pdfPath.replace(/'/g, "''");
        if (targetPrinter) {
          const safePrinter = String(targetPrinter).replace(/'/g, "''");
          await execAsync(`powershell -NoProfile -Command "Start-Process -FilePath '${safePdf}' -Verb PrintTo -ArgumentList '${safePrinter}' -WindowStyle Hidden"`);
        } else {
          await execAsync(`powershell -NoProfile -Command "Start-Process -FilePath '${safePdf}' -Verb Print -WindowStyle Hidden"`);
        }
      } else {
        const args = targetPrinter ? ["-d", targetPrinter, pdfPath] : [pdfPath];
        await execAsync(`lp ${args.map(a => `'${String(a).replace(/'/g, "'\\''")}'`).join(" ")}`);
      }
      return { ok: true, method: "os-fallback", printer: targetPrinter || "default" };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), printer: targetPrinter || "default" };
    }
  }

  const buildPricedHtml = (inv, items, dateStr, timeStr, wasPrintedBefore) => `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>فاتورة ${inv.NUM1 ?? ""}</title>
  <style>
    * { box-sizing: border-box; }
    table { width:100%; border-collapse: collapse; }
    th, td { padding: 4px; border-bottom: 1px solid #000; }
    .right { text-align: right; }
    .center { text-align: center; }
    .left { text-align: left; }
  </style>
</head>
<body style="margin:0;padding:0;font-family:Tahoma, Arial, sans-serif;color:#000;">
  <div style="width:70mm;margin:0 auto;padding:6mm 4mm;">
    <!-- Header -->
     <div style="justify-self:center;margin:auto;text-align:center;width:100%;font-size:18px;font-weight:900;margin-bottom:2mm;">${"الميزان"}</div>
    <div style="display:grid;grid-template-columns:1fr 2fr;align-items:end;margin-bottom:2mm;font-size:14px;font-weight:700;">
     
      <div style="justify-self:end;display:flex;align-items:center;gap:6px;">
        <span>القائمة</span><span style="font-size:18px;font-weight:900;padding:16px; padding-left:32px;padding-right:32px;width:100%;text-align:center;border:1px solid #000;border-radius:1px;">${inv.NUM1 ?? ""}</span>
      </div>
    </div>

    <!-- Date / Time -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6mm;font-size:12px;margin-bottom:3mm;">
      <div class="right"><span style="font-weight:700;">تاريخ</span> ${dateStr}</div>
      <div class="right"><span style="font-weight:700;">الوقت</span> ${timeStr}</div>
    </div>

    <div style="border-top:3px solid #000;margin:3mm 0 2mm;"></div>

    <!-- Items with prices -->
    <table style="font-size:12px;">
      <thead>
        <tr>
          <th class="right">المادة</th>
          <th class="center" style="width:14mm;">العدد</th>
          <th class="center" style="width:20mm;">سعر الوحدة</th>
          <th class="center" style="width:22mm;">الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(r => {
          const qty = Number(r.QTY || 0);
          const price = Number(r.PRICE || 0);
          const line = Number(r.line_total ?? (qty * price));
          const name = r.item_name || r.ITEM_NO || "";
          return `
            <tr>
              <td class="right">${name}</td>
              <td class="center">${fmtNum(qty)}</td>
              <td class="center">${fmtMoney(price)}</td>
              <td class="center">${fmtMoney(line)}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>

    <!-- Totals -->
    <div style="margin-top:4mm;border-top:2px solid #000;padding-top:3mm;">
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:13px;">
        <div>الإجمالي الكلي</div>
        <div>${fmtMoney(items.reduce((s, r) => s + Number(r.line_total ?? (Number(r.QTY||0)*Number(r.PRICE||0))), 0))}</div>
      </div>
    </div>

    

    <div style="margin-top:4mm;height:2mm;background:#000;"></div>
  </div>
</body>
</html>`;

  // ===== Route Body =========================================================
  try {
    const { invSeq } = req.params;
    const { printerName } = req.body || {};
    await executeQuery(`UPDATE INVOICE SET PAID = 2, PRINTED = 2 WHERE inv_seq = ?`, [invSeq]);
    // Load header
    const [inv] = await executeQuery(
      `SELECT inv_seq, NUM1, INV_FT_NO, INV_DATE, INV_CASH_NAME, INV_NOTE, PRINTED
       FROM INVOICE WHERE inv_seq = ?`,
      [invSeq]
    );
    if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });

    // Load items
    const items = await executeQuery(
      `SELECT im.auto_seq, im.ITEM_NO, it.Item_name AS item_name, im.QTY, im.PRICE,
              (CAST(im.QTY AS float) * CAST(im.PRICE AS float)) AS line_total
       FROM INVOICE_MENU im
       LEFT JOIN ITEM it ON CAST(it.Item_no AS varchar(50)) = CAST(im.ITEM_NO AS varchar(50))
       WHERE im.INV_SEQ = ?
       ORDER BY im.auto_seq`,
      [invSeq]
    );

    const date = new Date(inv.INV_DATE || Date.now());
    const dateStr = new Date(date).toLocaleDateString("ar-SA");
    const timeStr = new Date(date).toLocaleTimeString("ar-SA");
    const wasPrintedBefore = Number(inv.PRINTED || 0) > 0;

    // Build priced HTML for ALL items (no per-category tickets here)
    const pricedHtml = buildPricedHtml(inv, items, dateStr, timeStr, wasPrintedBefore);
    const base = `invoice_${invSeq}_priced`;
    const { htmlPath, pdfPath } = await htmlToPdf(pricedHtml, base);

    // Print once (default or specific printer)
    const result = await printPdfFile(pdfPath, printerName /* undefined => default */);
    const ok = !!result.ok;

    if (ok) {
      try {
        await executeQuery(`UPDATE INVOICE SET PAID = 2, PRINTED = 2 WHERE inv_seq = ?`, [invSeq]);
      } catch (_) {}
    }

    return res.json({
      success: ok,
      message: ok ? "Printed one priced invoice for all items" : "Failed to print priced invoice",
      final: {
        ok,
        method: result.method || "unknown",
        printer: result.printer || (printerName || "default"),
        error: ok ? undefined : result.error,
        pdfPath,
        htmlPath,
      },
      totals: {
        items: items.length,
        amount: items.reduce((s, r) => s + Number(r.line_total ?? (Number(r.QTY||0)*Number(r.PRICE||0))), 0),
      },
    });
  } catch (err) {
    console.error("print-html-priced error:", err);
    return res.status(500).json({ success: false, message: "Failed to print priced invoice", error: err.message });
  }
});


// Print to kitchen (PRINTED=1) then print customer bill (PRINTED=2)
// POST /api/invoice/:invSeq/print-both { kitchenPrinter?: string, clientPrinter?: string }
router.post("/:invSeq/print-both", async (req, res) => {
  try {
    const { invSeq } = req.params;
    const { kitchenPrinter, clientPrinter } = req.body || {};

    // Load invoice + items
    const [inv] = await executeQuery(
      `SELECT inv_seq, NUM1, INV_FT_NO, INV_DATE, INV_CASH_NAME, INV_NOTE FROM INVOICE WHERE inv_seq = ?`,
      [invSeq]
    );
    if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });

    const items = await executeQuery(
      `SELECT im.auto_seq, im.ITEM_NO, it.Item_name AS item_name, im.QTY, im.PRICE,
              (CAST(im.QTY AS float) * CAST(im.PRICE AS float)) AS line_total
       FROM INVOICE_MENU im
       LEFT JOIN ITEM it ON CAST(it.Item_no AS varchar(50)) = CAST(im.ITEM_NO AS varchar(50))
       WHERE im.INV_SEQ = ?
       ORDER BY im.auto_seq`,
      [invSeq]
    );

    // 1) Kitchen print: set PRINTED=1 first
    try { await executeQuery(`UPDATE INVOICE SET PAID = 2, PRINTED = 1 WHERE inv_seq = ?`, [invSeq]); } catch { }

    // Generate a simple kitchen ticket
    const date = new Date(inv.INV_DATE || Date.now());
    const dateStr = new Date(date).toLocaleDateString('ar-SA');
    const timeStr = new Date(date).toLocaleTimeString('ar-SA');

    const kitchenHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>مطبخ ${inv.NUM1}</title>
<style>body{margin:0;font-family:Tahoma,Arial}.c{width:70mm;margin:0 auto;padding:6mm 4mm}.h{display:flex;justify-content:space-between;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #000;padding:4px;text-align:center}
</style></head><body><div class="c">
  <div class="h"><span>مطبخ</span><span>القائمة ${inv.NUM1 || ''}</span></div>
  <div class="h" style="margin-top:2mm"><span>تاريخ ${dateStr}</span><span>الوقت ${timeStr}</span></div>
  <div class="h" style="margin-top:2mm"><span>الطاولة</span><span>${inv.INV_FT_NO || ''}</span></div>
  <table style="margin-top:3mm"><thead><tr><th>المادة</th><th>العدد</th></tr></thead><tbody>
  ${items.map(r => `<tr><td>${r.item_name || r.ITEM_NO}</td><td>${r.QTY}</td></tr>`).join('')}
  </tbody></table>
</div></body></html>`;

    const kitchenHtmlPath = path.join(PRINT_DIR, `invoice_${invSeq}_kitchen.html`);
    const kitchenPdfPath = path.join(PRINT_DIR, `invoice_${invSeq}_kitchen.pdf`);
    fs.writeFileSync(kitchenHtmlPath, kitchenHtml, 'utf8');

    // Render to PDF and print to kitchen printer
    {
      const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.goto(`file://${kitchenHtmlPath}`);
      await page.pdf({ path: kitchenPdfPath, printBackground: true, width: '80mm', margin: { top: '4mm', right: '4mm', bottom: '4mm', left: '4mm' } });
      await browser.close();
    }

    let kitchenPrinted = false;
    if (printPdfLib && typeof printPdfLib.print === 'function') {
      try { await printPdfLib.print(kitchenPdfPath, kitchenPrinter ? { printer: String(kitchenPrinter) } : {}); kitchenPrinted = true; } catch { }
    }
    if (!kitchenPrinted) {
      if (process.platform === 'win32') {
        const safe = kitchenPdfPath.replace(/'/g, "''");
        const cmd = kitchenPrinter
          ? `powershell -NoProfile -Command "Start-Process -FilePath '${safe}' -Verb PrintTo -ArgumentList '${String(kitchenPrinter).replace(/'/g, "''")}' -WindowStyle Hidden"`
          : `powershell -NoProfile -Command "Start-Process -FilePath '${safe}' -Verb Print -WindowStyle Hidden"`;
        try { await execAsync(cmd); } catch { }
      } else {
        const args = kitchenPrinter ? [`-d`, kitchenPrinter, kitchenPdfPath] : [kitchenPdfPath];
        try { await execAsync(`lp ${args.map(a => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ')}`); } catch { }
      }
    }

    // 2) Customer bill using same logic as /print-html (sets PRINTED=2)
    req.body = { printerName: clientPrinter || null };
    // Reuse implementation by calling the same helper inline
    // Build the same customer HTML as in /print-html
    const total = items.reduce((s, r) => s + (Number(r.line_total) || 0), 0);
    const clientHtml = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8" />
    <title>فاتورة ${inv.NUM1}</title></head>
    <body style="margin:0;padding:0;font-family:Tahoma, Arial, text-align:right; direction:rtl; sans-serif;color:#000;">
      <div style="width:70mm;margin:0 auto;padding:6mm 4mm;box-sizing:border-box;">
        <div style="display:grid;grid-template-columns:1fr auto;align-items:end;margin-bottom:2mm;font-size:14px;font-weight:700;">
          <div style="justify-self:start;letter-spacing:.2px;">الميزان</div>
          <div style="justify-self:end;display:flex;align-items:center;gap:6px;font-weight:700;"><span>القائمة</span><span>${inv.NUM1 || ''}</span></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr; gap:6mm;font-size:12px;margin-bottom:2mm;">
          <div style="display:flex;gap:4px"><span style="font-weight:700">تاريخ</span><span>${dateStr}</span></div>
          <div style="display:flex;gap:4px"><span style="font-weight:700">الوقت</span><span>${timeStr}</span></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:6mm;margin-bottom:3mm;">
          <div style="display:flex;gap:12px;font-size:12px;"><div style="padding:2px 8px;border:1px solid #000;border-radius:2px;font-weight:700;text-decoration:underline;">صالة</div><div style="padding:2px 8px;border:1px solid #000;border-radius:2px;font-weight:700;text-decoration:underline;">صالة</div></div>
          <div style="display:flex;flex-direction:column;align-items:center;"><div style="display:grid;place-items:center;width:22mm;height:12mm;border:2px solid #333;background:#fff;"><div style="font-size:18px;font-weight:700;line-height:1;">${inv.INV_FT_NO || ''}</div></div><div style="margin-top:1.2mm;font-size:12px;font-weight:700;">الطاولة</div></div>
        </div>
        <div style="border-top:3px solid #000;margin:3mm 0 2mm;"></div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr><th style="border-bottom:1px solid #000;padding:3px 4px;text-align:center;font-weight:700;width:28mm;text-decoration:underline;">الملاحظات</th><th style="border-bottom:1px solid #000;padding:3px 4px;text-align:center;font-weight:700;width:16mm;text-decoration:underline;">العدد</th><th style="border-bottom:1px solid #000;padding:3px 4px;text-align:center;font-weight:700;text-decoration:underline;">المادة</th></tr></thead>
          <tbody>${items.map(r => `<tr><td style="border-bottom:1px solid #000;padding:4px 4px;text-align:right;vertical-align:middle;width:28mm;"></td><td style="border-bottom:1px solid #000;padding:4px 4px;text-align:center;vertical-align:middle;width:16mm;">${r.QTY}</td><td style="border-bottom:1px solid #000;padding:4px 4px;text-align:center;vertical-align:middle;">${r.item_name || r.ITEM_NO}</td></tr>`).join('')}</tbody>
        </table>
        <div style="margin-top:4mm;height:10mm;background:#333;"></div>
      </div>
    </body></html>`;

    const clientHtmlPath = path.join(PRINT_DIR, `invoice_${invSeq}_client.html`);
    const clientPdfPath = path.join(PRINT_DIR, `invoice_${invSeq}_client.pdf`);
    fs.writeFileSync(clientHtmlPath, clientHtml, 'utf8');
    {
      const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.goto(`file://${clientHtmlPath}`);
      await page.pdf({ path: clientPdfPath, printBackground: true, width: '80mm', margin: { top: '4mm', right: '4mm', bottom: '4mm', left: '4mm' } });
      await browser.close();
    }
    let clientPrinted = false;
    if (printPdfLib && typeof printPdfLib.print === 'function') {
      try { await printPdfLib.print(clientPdfPath, clientPrinter ? { printer: String(clientPrinter) } : {}); clientPrinted = true; } catch { }
    }
    if (!clientPrinted) {
      if (process.platform === 'win32') {
        const safe = clientPdfPath.replace(/'/g, "''");
        const cmd = clientPrinter
          ? `powershell -NoProfile -Command "Start-Process -FilePath '${safe}' -Verb PrintTo -ArgumentList '${String(clientPrinter).replace(/'/g, "''")}' -WindowStyle Hidden"`
          : `powershell -NoProfile -Command "Start-Process -FilePath '${safe}' -Verb Print -WindowStyle Hidden"`;
        try { await execAsync(cmd); } catch { }
      } else {
        const args = clientPrinter ? [`-d`, clientPrinter, clientPdfPath] : [clientPdfPath];
        try { await execAsync(`lp ${args.map(a => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ')}`); } catch { }
      }
    }

    // Mark final state PRINTED=2
    try { await executeQuery(`UPDATE INVOICE SET PAID = 2, PRINTED = 2 WHERE inv_seq = ?`, [invSeq]); } catch { }

    return res.json({ success: true, message: 'Printed to kitchen and client', kitchenPrinter: kitchenPrinter || 'default', clientPrinter: clientPrinter || 'default' });
  } catch (err) {
    console.error('print-both error:', err);
    return res.status(500).json({ success: false, message: 'Failed to print both', error: err.message });
  }
});

// Add items to an open invoice
// POST /api/invoice/:invSeq/items
router.post("/:invSeq/items", async (req, res) => {
  console.log("stockRows")
  console.log(req.body)
  try {
    const { invSeq } = req.params;
    const { itemNo, qty, price, notice, pp } = req.body;

    if (!itemNo || !qty || !price) {
      return res.status(400).json({ success: false, message: "itemNo, qty, and price are required" });
    }

    try {
      const stockRows = await executeQuery(`SELECT Balance FROM ITEM WHERE CAST(Item_no AS varchar(50)) = CAST(? AS varchar(50))`, [itemNo]);
      console.log(stockRows)
      const currentBalance = Number(stockRows?.[0]?.Balance ?? 0);
      console.log("stockRows", stockRows)
      // if (currentBalance < Number(qty)) {
      //   return res.status(409).json({ success: false, message: `Insufficient stock. Available: ${currentBalance}` });
      // }
    } catch (e) {
      console.warn("Stock check failed (continuing):", e.message);
    }

    const insertQuery = `
      INSERT INTO INVOICE_MENU (INV_SEQ, ITEM_NO, QTY, P, F_PRICE, S_PRICE, PRICE, notice, PP)
      OUTPUT Inserted.auto_seq AS auto_seq
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)
    `;

    const values = [
      invSeq,
      itemNo,
      qty,
      price, // F_PRICE
      price, // S_PRICE
      price, // PRICE
      notice || "",
      pp || 0
    ];

    const inserted = await executeQuery(insertQuery, values);
    const autoSeq = inserted[0]?.auto_seq;

    // 2) Deduct stock
    try {
      await executeQuery(
        `UPDATE ITEM SET Balance = CAST(Balance AS float) - CAST(? AS float) WHERE CAST(Item_no AS varchar(50)) = CAST(? AS varchar(50))`,
        [qty, itemNo]
      );
    } catch (e) {
      console.warn("Stock decrement failed:", e.message);
    }

    res.status(201).json({
      success: true,
      message: "Item added to invoice",
      item: {
        auto_seq: autoSeq,
        inv_seq: invSeq,
        itemNo,
        qty,
        price,
        notice: notice || "",
        pp: pp || 0
      }
    });
  } catch (error) {
    console.error("Error adding item to invoice:", error);
    res.status(500).json({ success: false, message: "Failed to add item", error: error.message });
  }
});

// Update item in invoice
router.put("/:invSeq/items", async (req, res) => {
  try {
    const { invSeq } = req.params;
    let { itemNo, qty, price, notice, pp } = req.body;

    // Force numbers
    qty = Number(qty);
    price = Number(price);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ success: false, message: "Invalid qty" });
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ success: false, message: "Invalid price" });

    // 1) Read the existing invoice line
    const checkQuery = `
      SELECT auto_seq, QTY, PRICE, notice, PP
      FROM INVOICE_MENU
      WHERE INV_SEQ = ? AND ITEM_NO = ?
    `;
    console.log(checkQuery)
    const existing = await executeQuery(checkQuery, [invSeq, itemNo]);
    if (!existing?.length) {
      return res.status(404).json({ success: false, message: "Item not found in invoice" });
    }
    const current = existing[0];
    const oldQty = Number(current.QTY) || 0;
    const deltaQty = qty - oldQty; // +ve = increase, -ve = decrease

    // 2) Adjust stock FIRST using an atomic, conditional update
    if (deltaQty >= 0) {
      // Try to decrement only if enough stock; if 0 rows affected => not enough
      const dec = await executeQuery(
        `
        UPDATE ITEM
        SET Balance = CAST(Balance AS float) - CAST(? AS float)
        WHERE CAST(Item_no AS varchar(50)) = CAST(? AS varchar(50))
          AND CAST(Balance AS float) >= CAST(? AS float)
        `,
        [deltaQty, itemNo, deltaQty]
      );
      const changed = dec?.affectedRows ?? dec?.rowCount ?? dec?.rowsAffected?.[0] ?? 0;
      if (!changed) {
        return res.status(409).json({
          success: false,
          message: "الكمية غير كافية لزيادة العدد المطلوب.",
        });
      }
    } else if (deltaQty < 0) {
      // Return stock when reducing the line quantity
      await executeQuery(
        `
        UPDATE ITEM
        SET Balance = CAST(Balance AS float) + CAST(? AS float)
        WHERE CAST(Item_no AS varchar(50)) = CAST(? AS varchar(50))
        `,
        [Math.abs(deltaQty), itemNo]
      );
    }
    // If deltaQty === 0, stock unchanged

    // 3) Update the invoice line
    await executeQuery(
      `
      UPDATE INVOICE_MENU
      SET QTY = ?,
          F_PRICE = ?,
          S_PRICE = ?,
          PRICE = ?,
          notice = ?,
          PP = ?
      WHERE INV_SEQ = ? AND ITEM_NO = ?
      `,
      [
        qty,
        price, // F_PRICE
        price, // S_PRICE
        price, // PRICE
        notice ?? current.notice ?? "",
        pp ?? current.PP ?? 0,
        invSeq,
        itemNo,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Item updated in invoice",
      item: {
        auto_seq: current.auto_seq,
        inv_seq: invSeq,
        itemNo,
        qty,
        price,
        notice: notice ?? current.notice ?? "",
        pp: pp ?? current.PP ?? 0,
      },
    });
  } catch (error) {
    console.error("Error updating item in invoice:", error);
    return res.status(500).json({ success: false, message: "Failed to update item", error: error.message });
  }
});


// Delete item from invoice
router.delete("/:invSeq/items/:itemNo", async (req, res) => {
  try {
    const { invSeq, itemNo } = req.params;

    if (!itemNo) {
      return res.status(400).json({ success: false, message: "itemNo is required" });
    }

    // First, check if the item exists in the invoice
    const checkQuery = `
      SELECT auto_seq, ITEM_NO, QTY, PRICE, notice 
      FROM INVOICE_MENU 
      WHERE INV_SEQ = ? AND ITEM_NO = ?
    `;

    const existingItem = await executeQuery(checkQuery, [invSeq, itemNo]);

    if (existingItem.length === 0) {
      return res.status(404).json({ success: false, message: "Item not found in invoice" });
    }

    // Delete the item
    const deleteQuery = `
      DELETE FROM INVOICE_MENU 
      WHERE INV_SEQ = ? AND ITEM_NO = ?
    `;

    await executeQuery(deleteQuery, [invSeq, itemNo]);

    // Return stock
    try {
      await executeQuery(
        `UPDATE ITEM SET Balance = CAST(Balance AS float) + CAST(? AS float) WHERE CAST(Item_no AS varchar(50)) = CAST(? AS varchar(50))`,
        [existingItem[0].QTY, itemNo]
      );
    } catch (e) {
      console.warn("Stock increment (delete by item) failed:", e.message);
    }

    res.status(200).json({
      success: true,
      message: "Item deleted from invoice",
      deletedItem: {
        auto_seq: existingItem[0].auto_seq,
        inv_seq: invSeq,
        itemNo: existingItem[0].ITEM_NO,
        qty: existingItem[0].QTY,
        price: existingItem[0].PRICE,
        notice: existingItem[0].notice
      }
    });
  } catch (error) {
    console.error("Error deleting item from invoice:", error);
    res.status(500).json({ success: false, message: "Failed to delete item", error: error.message });
  }
});

// Update specific item in invoice by auto_seq
router.put("/:invSeq/items/auto/:autoSeq", async (req, res) => {
  try {
    const { invSeq, autoSeq } = req.params;
    const { qty, price, notice, pp } = req.body;

    if (!qty || !price) {
      return res.status(400).json({ success: false, message: "qty and price are required" });
    }

    // First, check if the item exists in the invoice
    const checkQuery = `
      SELECT auto_seq, ITEM_NO, QTY, PRICE, notice, PP 
      FROM INVOICE_MENU 
      WHERE INV_SEQ = ? AND auto_seq = ?
    `;

    const existingItem = await executeQuery(checkQuery, [invSeq, autoSeq]);

    if (existingItem.length === 0) {
      return res.status(404).json({ success: false, message: "Item not found in invoice" });
    }

    const currentItem = existingItem[0];

    // Compute delta and check stock if increasing
    const deltaQty = Number(qty) - Number(currentItem.QTY);
    if (deltaQty > 0) {
      try {
        const stockRows = await executeQuery(`SELECT Balance FROM ITEM WHERE CAST(Item_no AS varchar(50)) = CAST(? AS varchar(50))`, [currentItem.ITEM_NO]);
        const currentBalance = Number(stockRows?.[0]?.Balance ?? 0);
        // if (currentBalance < deltaQty) {
        //   return res.status(409).json({ success: false, message: `Insufficient stock for increase. Available: ${currentBalance}` });
        // }
      } catch (e) {
        console.warn("Stock check (auto update) failed (continuing):", e.message);
      }
    }

    // Update the item
    const updateQuery = `
      UPDATE INVOICE_MENU 
      SET QTY = ?, 
          F_PRICE = ?, 
          S_PRICE = ?, 
          PRICE = ?, 
          notice = ?, 
          PP = ?
      WHERE INV_SEQ = ? AND auto_seq = ?
    `;

    const values = [
      qty,
      price, // F_PRICE
      price, // S_PRICE
      price, // PRICE
      notice || currentItem.notice || "",
      pp || currentItem.PP || 0,
      invSeq,
      autoSeq
    ];

    await executeQuery(updateQuery, values);

    // Adjust stock after auto update
    try {
      if (deltaQty !== 0) {
        await executeQuery(
          `UPDATE ITEM SET Balance = CAST(Balance AS float) ${deltaQty > 0 ? '-' : '+'} CAST(? AS float) WHERE CAST(Item_no AS varchar(50)) = CAST(? AS varchar(50))`,
          [Math.abs(deltaQty), currentItem.ITEM_NO]
        );
      }
    } catch (e) {
      console.warn("Stock adjustment (auto update) failed:", e.message);
    }

    res.status(200).json({
      success: true,
      message: "Item updated in invoice",
      item: {
        auto_seq: currentItem.auto_seq,
        inv_seq: invSeq,
        itemNo: currentItem.ITEM_NO,
        qty,
        price,
        notice: notice || currentItem.notice || "",
        pp: pp || currentItem.PP || 0
      }
    });
  } catch (error) {
    console.error("Error updating item in invoice:", error);
    res.status(500).json({ success: false, message: "Failed to update item", error: error.message });
  }
});

// Delete specific item from invoice by auto_seq
router.delete("/:invSeq/items/auto/:autoSeq", async (req, res) => {
  try {
    const { invSeq, autoSeq } = req.params;

    if (!autoSeq) {
      return res.status(400).json({ success: false, message: "autoSeq is required" });
    }

    // First, check if the item exists in the invoice
    const checkQuery = `
      SELECT auto_seq, ITEM_NO, QTY, PRICE, notice 
      FROM INVOICE_MENU 
      WHERE INV_SEQ = ? AND auto_seq = ?
    `;

    const existingItem = await executeQuery(checkQuery, [invSeq, autoSeq]);

    if (existingItem.length === 0) {
      return res.status(404).json({ success: false, message: "Item not found in invoice" });
    }

    // Delete the item
    const deleteQuery = `
      DELETE FROM INVOICE_MENU 
      WHERE INV_SEQ = ? AND auto_seq = ?
    `;

    await executeQuery(deleteQuery, [invSeq, autoSeq]);

    // Return stock
    try {
      await executeQuery(
        `UPDATE ITEM SET Balance = CAST(Balance AS float) + CAST(? AS float) WHERE CAST(Item_no AS varchar(50)) = CAST(? AS varchar(50))`,
        [existingItem[0].QTY, existingItem[0].ITEM_NO]
      );
    } catch (e) {
      console.warn("Stock increment (delete by auto) failed:", e.message);
    }

    res.status(200).json({
      success: true,
      message: "Item deleted from invoice",
      deletedItem: {
        auto_seq: existingItem[0].auto_seq,
        inv_seq: invSeq,
        itemNo: existingItem[0].ITEM_NO,
        qty: existingItem[0].QTY,
        price: existingItem[0].PRICE,
        notice: existingItem[0].notice
      }
    });
  } catch (error) {
    console.error("Error deleting item from invoice:", error);
    res.status(500).json({ success: false, message: "Failed to delete item", error: error.message });
  }
});

