const express = require("express");
const { executeQuery } = require("../config/database");
const router = express.Router();
const fs = require("fs");
const path = require("path");
// Create a new order (based on your frontend ordering interface)
router.post("/", async (req, res) => {
  try { 
    const { tableNumber, items, customerName, captainId, totalAmount, notes } = req.body;
    // Add New Order To Orders.json
    const newOrder = {
      tableNumber, 
      items,
      customerName, 
      captainId,
      totalAmount,
      notes, 
      status: "pending",

    };
    // array of orders 
    const orders = JSON.parse(fs.readFileSync(path.join(__dirname, "orders.json"), "utf8"));
    // Put Order Number And Date To Order
    newOrder.orderNumber = orders.length + 1;
    // Date Time (yyyy-mm-dd hh:mm:ss)
    newOrder.orderDate = new Date().toISOString().split("T")[0] + " " + new Date().toISOString().split("T")[1].split(".")[0];
    // Last Order In First
    orders.unshift(newOrder);
    fs.writeFileSync(path.join(__dirname, "orders.json"), JSON.stringify(orders, null, 2));
    

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      order: newOrder,
    });


    
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message,
    });
  }
});


router.post("/", async (req, res) => {
  try {
    const { tableNumber, items, customerName, captainId, totalAmount, notes } = req.body;
    // Add New Order To Orders.json
    const newOrder = {
      tableNumber,
      items,
      customerName,
      captainId,
      totalAmount,
      notes,
      status: "pending",

    };
    // array of orders
    const orders = JSON.parse(fs.readFileSync(path.join(__dirname, "orders.json"), "utf8"));
    // Put Order Number And Date To Order
    newOrder.orderNumber = orders.length + 1;
    // Date Time (yyyy-mm-dd hh:mm:ss)
    newOrder.orderDate = new Date().toISOString().split("T")[0] + " " + new Date().toISOString().split("T")[1].split(".")[0];
    // Last Order In First
    orders.unshift(newOrder);
    fs.writeFileSync(path.join(__dirname, "orders.json"), JSON.stringify(orders, null, 2));
    

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      order: newOrder,
    });


    
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message,
    });
  }
});

// Get orders for a specific table
router.get("/table/:tableNumber", async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const orders = JSON.parse(fs.readFileSync(path.join(__dirname, "orders.json"), "utf8"));
    const formattedOrders = orders.filter((order) => order.tableNumber == parseInt(tableNumber) && order.status === "pending");

    res.json({
      success: true,
      orders: formattedOrders,
      total: formattedOrders.length,
    });
  } catch (error) {
    console.error("Error fetching table orders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
});

// Get all orders
router.get("/", async (req, res) => {
  try {
    const query = `
      SELECT TOP 100
        inv_seq as order_id,
        INV_FT_NO as table_number,
        CUSTOMER_NAME as customer_name,
        COST as total_amount,
        INV_NOTE as order_details,
        INV_DATE as order_date,
        PAID as is_paid
      FROM INVOICE 
      WHERE INV_NOTE LIKE '%طلب:%'
      ORDER BY INV_DATE DESC
    `;

    const orders = await executeQuery(query);

    const formattedOrders = orders.map((order) => ({
      id: order.order_id,
      tableNumber: order.table_number,
      customerName: order.customer_name,
      totalAmount: order.total_amount,
      orderDetails: order.order_details,
      orderDate: order.order_date,
      status: order.is_paid ? "paid" : "pending",
    }));

    res.json({
      success: true,
      orders: formattedOrders,
      total: formattedOrders.length,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
});

// Update order status (mark as paid)
router.put("/:orderId/pay", async (req, res) => {
  try {
    const { orderId } = req.params;
    const orders = JSON.parse(fs.readFileSync(path.join(__dirname, "orders.json"), "utf8"));

    const order = orders.find((order) => order.orderNumber == parseInt(orderId) && order.status === "pending");
    const orderPaid = orders.find((order) => order.orderNumber == parseInt(orderId) && order.status === "paid");
   
    if (orderPaid) {
      return res.status(400).json({
        success: false,
        message: "Order already paid",
      });
    }
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }
    order.status = "paid";
    fs.writeFileSync(path.join(__dirname, "orders.json"), JSON.stringify(orders, null, 2)); 
  
    res.json({
      success: true,
      message: "Order marked as paid",
    });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update order",
      error: error.message,
    });
  }
});

module.exports = router;
