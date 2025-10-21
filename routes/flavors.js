const express = require("express");
const { executeQuery } = require("../config/database");
const router = express.Router();

// List flavors from nkha table
router.get("/", async (_req, res) => {
  try {
    const rows = await executeQuery(`SELECT Item_no, Item_name, Item_Price, class FROM nkha ORDER BY Item_name`);
    const flavors = rows.map(r => ({
      id: r.Item_no,
      name: r.Item_name,
      price: r.Item_Price,
      class: r.class
    }));
    res.json({ success: true, flavors, total: flavors.length });
  } catch (error) {
    console.error("Error fetching flavors:", error);
    res.status(500).json({ success: false, message: "Failed to fetch flavors", error: error.message });
  }
});

// Build combo code like 1 + 16 => 116
router.post("/combo", async (req, res) => {
  try {
    const { a, b } = req.body;
    if (a == null || b == null) {
      return res.status(400).json({ success: false, message: "a and b required" });
    }
    const combo = `${a}${b}`;
    res.json({ success: true, combo });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to build combo", error: error.message });
  }
});

module.exports = router;


