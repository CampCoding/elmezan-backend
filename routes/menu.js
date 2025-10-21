const express = require("express");
const { executeQuery } = require("../config/database");
const router = express.Router();

// Get all menu categories (الأقسام) - بناءً على جدول MENU_TYPE من Schema
router.get("/categories", async (req, res) => {
  try {
    const query = `
      SELECT 
        CLASS_NO as category_id,
        CLASS_NAME as category_name
      FROM CLASSCODE WHERE CLASS_NAME IS NOT NULL
      ORDER BY CLASS_NO
    `;

    const categories = await executeQuery(query);
const [foods] = await executeQuery(`SELECT * FROM ITEM111`);
    const formattedCategories = categories.map((category) => ({
      id: category.category_id,
      name: category.category_name,
      categoryNumber: category.category_id,
    }));

    res.json({
      success: true,
      categories: formattedCategories,
      total: formattedCategories.length,
      foods
    });
  } catch (error) {
    console.error("Error fetching menu categories:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch menu categories",
      error: error.message,
    });
  }
});

// Get menu items by category (الأصناف حسب القسم) - بناءً على جدول ITEM من Schema
router.get("/category/:categoryId/items", async (req, res) => {
  try {
    const { categoryId } = req.params;
    const [items2] = await executeQuery(`SELECT * FROM ITEM`);
    
    const query = `
      SELECT 
        i.Item_no as item_id,
        i.Item_name as item_name,
        i.Item_Price as item_price,
        i.Item_Sale as sale_price,
        i.MENU_TYPE as category_id,
        m.MENU_NAME as category_name,
        i.Balance as stock_balance,
        CASE WHEN i.Balance > 0 THEN 1 ELSE 0 END as available
      FROM ITEM i
      LEFT JOIN MENU_TYPE m ON i.MENU_TYPE = m.MENU_NO
      WHERE i.MENU_TYPE = ?
      ORDER BY i.Item_name
    `;

    const items = await executeQuery(query, [categoryId]);

    const formattedItems = items.map((item) => ({
      id: item.item_id,
      name: item.item_name,
      price: parseFloat(item.item_price) || 0,
      salePrice: parseFloat(item.sale_price) || 0,
      categoryId: item.category_id,
      categoryName: item.category_name,
      stockBalance: parseFloat(item.stock_balance) || 0,
      available: item.available === 1,
    }));

    res.json({
      success: true,
      categoryId: parseInt(categoryId),
      items: formattedItems,
      total: formattedItems.length,
      items2:items2
    });
  } catch (error) {
    console.error("Error fetching menu items by category:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch menu items",
      error: error.message,
    });
  }
});

// Get all menu items (جميع الأصناف) - بناءً على جدول ITEM من Schema
router.get("/", async (req, res) => {
  try {
    const query = `
      SELECT 
       *
      FROM ITEM i
      LEFT JOIN MENU_TYPE m ON i.MENU_TYPE = m.MENU_NO
      ORDER BY m.MENU_NAME, i.Item_name
    `;

    const items = await executeQuery(query);

    const formattedItems = items.map((item) => ({
    
      ...item
    }));

    res.json({
      success: true,
      menuItems: formattedItems,
      total: formattedItems.length,
    });
  } catch (error) {
    console.error("Error fetching menu items:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch menu items",
      error: error.message,
    });
  }
});

// Get specific menu item (صنف محدد) - بناءً على جدول ITEM من Schema
router.get("/item/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;

    const query = `
      SELECT 
        i.Item_no as item_id,
        i.Item_name as item_name,
        i.Item_Price as item_price,
        i.Item_Sale as sale_price,
        i.MENU_TYPE as category_id,
        m.MENU_NAME as category_name,
        i.Balance as stock_balance,
        i.THE_TYPE as item_type,
        CASE WHEN i.Balance > 0 THEN 1 ELSE 0 END as available
      FROM ITEM i
      LEFT JOIN MENU_TYPE m ON i.MENU_TYPE = m.MENU_NO
      WHERE i.Item_no = ?
    `;

    const items = await executeQuery(query, [itemId]);

    if (items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found",
      });
    }

    const item = items[0];

    res.json({
      success: true,
      item: {
        id: item.item_id,
        name: item.item_name,
        price: parseFloat(item.item_price) || 0,
        salePrice: parseFloat(item.sale_price) || 0,
        categoryId: item.category_id,
        categoryName: item.category_name,
        stockBalance: parseFloat(item.stock_balance) || 0,
        itemType: item.item_type,
        available: item.available === 1,
      },
    });
  } catch (error) {
    console.error("Error fetching menu item:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch menu item",
      error: error.message,
    });
  }
});

module.exports = router;
