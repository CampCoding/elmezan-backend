const express = require("express");
const { executeQuery } = require("../config/database");
const fs = require("fs");
const path = require("path");
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

    // Check orders.json for pending orders
    let pendingOrders = [];
    try {
      const ordersData = fs.readFileSync(path.join(__dirname, "orders.json"), "utf8");
      const orders = JSON.parse(ordersData);
      pendingOrders = orders.filter(order => 
        order.status === "pending" && 
        order.tableNumber && 
        order.tableNumber !== ""
      );
    } catch (error) {
      console.error("Error reading orders.json:", error);
    }

    // Create a map of booked tables from orders.json
    const bookedTablesMap = {};
    pendingOrders.forEach((order) => {
      const tableNumber = parseInt(order.tableNumber);
      if (tableNumber) {
        bookedTablesMap[tableNumber] = {
          fromDate: order.orderDate,
          toDate: order.orderDate,
          customerName: order.customerName || "Pending Order",
          note: order.notes || "Pending order",
          source: "orders.json",
          orderNumber: order.orderNumber
        };
      }
    });

    // Format tables with availability status
    const formattedTables = tables.map((table) => {
      const isBooked = bookedTablesMap[table.FOOD_TABLE_NO];

      return {
        id: table.NO,
        tableNumber: table.FOOD_TABLE_NO,
        areaId: table.seq,
        areaName: table.HALL_NAME,
        status: isBooked ? "reserved" : "available",
        availability: {
          isAvailable: !isBooked,
          isReserved: !!isBooked,
          currentBooking: isBooked
            ? {
                fromDate: isBooked.fromDate,
                toDate: isBooked.toDate,
                customerName: isBooked.customerName,
                note: isBooked.note,
                source: isBooked.source,
                orderNumber: isBooked.orderNumber
              }
            : null,
        },
      };
    });

    res.json({
      success: true,
      areaId: parseInt(areaId),
      tables: formattedTables,
      summary: {
        total: formattedTables.length,
        available: formattedTables.filter((t) => t.status === "available")
          .length,
        reserved: formattedTables.filter((t) => t.status === "reserved").length,
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

    // Check orders.json for pending orders for this table
    let currentBooking = null;
    try {
      const ordersData = fs.readFileSync(path.join(__dirname, "orders.json"), "utf8");
      const orders = JSON.parse(ordersData);
      const pendingOrder = orders.find(order => 
        order.status === "pending" && 
        parseInt(order.tableNumber) === table.FOOD_TABLE_NO
      );

      if (pendingOrder) {
        currentBooking = {
          inv_seq: pendingOrder.orderNumber,
          INV_DATE: pendingOrder.orderDate,
          to_date: pendingOrder.orderDate,
          PAID: 0,
          CUSTOMER_NAME: pendingOrder.customerName || "Pending Order",
          INV_NOTE: pendingOrder.notes || "Pending order",
          COST: pendingOrder.totalAmount || 0,
          source: "orders.json"
        };
      }
    } catch (error) {
      console.error("Error reading orders.json:", error);
    }

    res.json({
      success: true,
      table: {
        id: table.NO,
        tableNumber: table.FOOD_TABLE_NO,
        areaId: table.seq,
        areaName: table.HALL_NAME,
        status: currentBooking ? "reserved" : "available",
        currentBooking: currentBooking
          ? {
              bookingId: currentBooking.inv_seq,
              fromDate: currentBooking.INV_DATE,
              toDate: currentBooking.to_date,
              customerName: currentBooking.CUSTOMER_NAME,
              note: currentBooking.INV_NOTE,
              bookingDate: currentBooking.INV_DATE,
              cost: currentBooking.COST,
              source: currentBooking.source
            }
          : null,
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

    // Check orders.json for pending orders that might conflict
    let orderConflicts = [];
    try {
      const ordersData = fs.readFileSync(path.join(__dirname, "orders.json"), "utf8");
      const orders = JSON.parse(ordersData);
      const pendingOrders = orders.filter(order => 
        order.status === "pending" && 
        parseInt(order.tableNumber) === tableNumber
      );
      
      // Add pending orders as conflicts
      pendingOrders.forEach(order => {
        orderConflicts.push({
          bookingId: order.orderNumber,
          fromDate: order.orderDate,
          toDate: order.orderDate,
          customerName: order.customerName || "Pending Order",
          source: "orders.json"
        });
      });
    } catch (error) {
      console.error("Error reading orders.json:", error);
    }

    const isAvailable = orderConflicts.length === 0;

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
