const express = require("express");
const { executeQuery } = require("../config/database");
// Removed fs and path imports - no longer needed
const router = express.Router();

// Get all tables in a specific area
router.get("/area/:areaId", async (req, res) => {
  try {
    const { areaId } = req.params;

    // Get tables from FOOD_HALLS table for the specific area
    const tablesQuery = `
      SELECT 
        fh.NO,
        fh.FOOD_TABLE_NO,
        fh.seq,
        h.HALL_NAME
      FROM FOOD_HALLS fh
      JOIN HALLS h ON fh.seq = h.HALL_NO 
      WHERE fh.seq = ?
      ORDER BY fh.FOOD_TABLE_NO
    `;

    const tables = await executeQuery(tablesQuery, [areaId]);

    // Removed orders.json dependency - using invoice-based workflow instead

    // Determine color/status from INVOICE: green=new/empty, red=PAID=2&PRINTED=1, yellow=PAID=2&PRINTED=2
    const colorQuery = `
      WITH latest AS (
        SELECT INV_FT_NO, PAID, PRINTED,
               ROW_NUMBER() OVER (PARTITION BY INV_FT_NO ORDER BY INV_DATE DESC, inv_seq DESC) AS rn
        FROM INVOICE
        WHERE INV_FT_NO IS NOT NULL
          AND DATEDIFF(day, INV_DATE, GETDATE()) = 0 
      )
      SELECT INV_FT_NO,
             CASE 
               WHEN PAID = 2 AND PRINTED = 2 THEN 'yellow'
               WHEN PAID = 2 AND PRINTED = 1 THEN 'red'
               ELSE 'green'
             END AS color
      FROM latest 
      WHERE rn = 1
    `;
    const colors = await executeQuery(colorQuery);
    const colorMap = {};
    colors.forEach(c => { 
      const key = String(c.INV_FT_NO).trim();
      colorMap[key] = c.color || "green";
    });

    // Format tables with availability status and color
    const formattedTables = tables.map((table) => {
      const tableKey = String(table.FOOD_TABLE_NO).trim();
      const color = colorMap[tableKey] || "green";

      return {
        id: table.NO,
        tableNumber: table.FOOD_TABLE_NO,
        areaId: table.seq,
        areaName: table.HALL_NAME,
        status: "available",
        color,
        availability: {
          isAvailable: true,
          isReserved: false,
          currentBooking: null,
        },
      };
    });

    res.json({
      success: true,
      areaId: parseInt(areaId),
      tables: formattedTables,
      summary: {
        total: formattedTables.length,
        available: formattedTables.length,
        reserved: 0,
      },
    });
  } catch (error) {
    console.error("Error fetching tables:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tables",
      error: error.message,
    });
  }
});

// Grouped tables by halls using existing schema (HALLS + FOOD_HALLS)
// GET /api/tables/groups
// Response: { groups: [ { hall: 'صالة', tables: [1,2, ...] }, ... ] }
router.get("/groups", async (_req, res) => {
  try {
    const query = `
      SELECT h.HALL_NAME AS hallName, fh.FOOD_TABLE_NO AS tableNumber
      FROM FOOD_HALLS fh
      JOIN HALLS h ON fh.seq = h.HALL_NO
      ORDER BY h.HALL_NAME, fh.FOOD_TABLE_NO
    `;

    const rows = await executeQuery(query);
    const map = {};
    rows.forEach(r => {
      const hall = (r.hallName || '').trim();
      const num = r.tableNumber;
      if (!map[hall]) map[hall] = [];
      map[hall].push(num);
    });
    const groups = Object.entries(map).map(([hall, tables]) => ({ hall, tables }));
    res.json({ success: true, groups });
  } catch (error) {
    console.error('Error fetching table groups:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch table groups', error: error.message });
  }
});

// Get specific table details
router.get("/:tableId", async (req, res) => { 
  try {
    const { tableId } = req.params;

    const tableQuery = `
      SELECT 
        fh.NO,
        fh.FOOD_TABLE_NO,
        fh.seq,
        h.HALL_NAME
      FROM FOOD_HALLS fh
      JOIN HALLS h ON fh.seq = h.HALL_NO
      WHERE fh.NO = ?
    `;

    const tables = await executeQuery(tableQuery, [tableId]);

    if (tables.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Table not found",
      });
    }

    const table = tables[0];

    // Removed orders.json dependency - using invoice-based workflow instead

    res.json({
      success: true,
      table: {
        id: table.NO,
        tableNumber: table.FOOD_TABLE_NO,
        areaId: table.seq,
        areaName: table.HALL_NAME,
        status: "available",
        currentBooking: null,
      },
    });
  } catch (error) {
    console.error("Error fetching table:", error); 
    res.status(500).json({
      success: false,
      message: "Failed to fetch table",
      error: error.message,
    });
  }
});

// Get table availability for a date range
router.get("/:tableId/availability", async (req, res) => {
  try {
    const { tableId } = req.params;
    const { fromDate, toDate } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "fromDate and toDate are required",
      });
    }

    // Get table info
    const tableQuery = `
      SELECT FOOD_TABLE_NO FROM FOOD_HALLS WHERE NO = ?
    `;

    const tables = await executeQuery(tableQuery, [tableId]);

    if (tables.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Table not found",
      });
    }

    const tableNumber = tables[0].FOOD_TABLE_NO;

    // Removed orders.json dependency - using invoice-based workflow instead
    const orderConflicts = [];
    const isAvailable = true;

    res.json({
      success: true,
      tableId: parseInt(tableId),
      tableNumber,
      requestedDates: {
        fromDate,
        toDate,
      },
      availability: {
        isAvailable,
        conflicts: orderConflicts,
      },
    });
  } catch (error) {
    console.error("Error checking table availability:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check table availability",
      error: error.message,
    });
  }
});

module.exports = router;