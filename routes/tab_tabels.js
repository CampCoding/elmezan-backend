const express = require("express");
const { executeQuery, executeStoredProcedure } = require("../config/database");
const { initializeTabTabels } = require("../config/init-tab-tabels");
const router = express.Router();

// Debug endpoint to check available tables
router.get("/debug", async (req, res) => {
  try {
    // Get all table names in the database
    const tablesQuery = `
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `;
    
    const tables = await executeQuery(tablesQuery);
    
         // Also try to get table structure if Tab_tables exists
     let tableStructure = null;
     try {
       const structureQuery = `
         SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
         FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_NAME = 'Tab_tables'
         ORDER BY ORDINAL_POSITION
       `;
       tableStructure = await executeQuery(structureQuery);
     } catch (e) {
       
     }
    
    res.json({
      success: true,
      availableTables: tables.map(t => t.TABLE_NAME),
      tabTabelsStructure: tableStructure,
      message: "Debug information retrieved"
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get debug info',
      error: error.message
    });
  }
});

// GET /api/tab-tabels - جلب جميع الطاولات مع معلومات الكابتن والفواتير
router.get("/", async (req, res) => {
  initializeTabTabels()
  try {
    const query = `
      SELECT 
        tt.id, 
        tt.Tb_no, 
        tt.Tb_sala,
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
      ORDER BY tt.Tb_sala, tt.Tb_no
    `;
     
    const rows = await executeQuery(query);
    
    // Get items for tables with active invoices
    const tableNumbers = rows.filter(r => r.inv_seq).map(r => r.Tb_no);
    let itemsByTable = {};
    
    if (tableNumbers.length > 0) {
      const itemsQuery = `
        SELECT 
          i.INV_FT_NO,
          im.auto_seq,
          im.ITEM_NO,
          it.Item_name AS item_name,
          im.QTY,
          im.PRICE,
          im.notice,
          im.PP,
          (CAST(im.QTY AS float) * CAST(im.PRICE AS float)) AS line_total
        FROM INVOICE_MENU im
        JOIN INVOICE i ON im.INV_SEQ = i.inv_seq
        LEFT JOIN ITEM it ON CAST(it.Item_no AS varchar(50)) = CAST(im.ITEM_NO AS varchar(50))
        WHERE i.INV_FT_NO IN (${tableNumbers.map(() => '?').join(', ')})
          AND DATEDIFF(day, i.INV_DATE, GETDATE()) = 0
        ORDER BY im.auto_seq
      `;
      
      const items = await executeQuery(itemsQuery, tableNumbers);
      
      items.forEach(item => {
        if (!itemsByTable[item.INV_FT_NO]) {
          itemsByTable[item.INV_FT_NO] = [];
        }
        itemsByTable[item.INV_FT_NO].push({
          auto_seq: item.auto_seq,
          itemNo: item.ITEM_NO,
          itemName: item.item_name || null,
          qty: item.QTY,
          price: item.PRICE,
          notice: item.notice || '',
          pp: item.PP || 0,
          lineTotal: Number(item.line_total) || 0
        });
      });
    }
    
    // تجميع الطاولات حسب القاعة مع معلومات مفصلة
    const map = {};
    rows.forEach(r => {
      const hall = r.Tb_sala?.trim() || 'Default';
      const tableNo = String(r.Tb_no).trim();
      
      if (!map[hall]) map[hall] = [];
      
      // Calculate invoice total
      const items = itemsByTable[tableNo] || [];
      const invoiceTotal = items.reduce((sum, item) => sum + (item.lineTotal || 0), 0);
      
      // Determine color based on invoice status
      let color = "green";
      if (r.inv_seq) {
        if (r.PAID === 2 && r.PRINTED === 2) {
          color = "yellow";
        } else if (r.PAID === 2 && r.PRINTED === 1) {
          color = "red";
        }
      }
      
      map[hall].push({
        number: tableNo,
        status: r.inv_seq ? "occupied" : "available",
        color,
        captain: r.inv_seq ? {
          captainNo: r.INV_CAPTAIN_NO,
          captainName: r.INV_CASH_NAME || r.CAPTAIN_NAME,
          displayName: r.INV_CASH_NAME || r.CAPTAIN_NAME || "غير محدد"
        } : null,
        invoice: r.inv_seq ? {
          inv_seq: r.inv_seq,
          num1: r.NUM1,
          date: r.INV_DATE,
          paid: r.PAID,
          printed: r.PRINTED,
          locked: r.LOCK,
          note: r.INV_NOTE,
          total: invoiceTotal,
          items: items
        } : null
      });
    });
    
    const result = Object.entries(map).map(([hall, tables], index) => ({ 
      id: index + 1,
      hall: hall, 
      tables: tables.sort((a, b) => parseInt(a.number) - parseInt(b.number))
    }));
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching tab tables:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch tab tables', 
      error: error.message 
    });
  }
});

// GET /api/tab-tabels/groups - جلب الطاولات مجمعة حسب القاعة مع معلومات الكابتن والفواتير
router.get("/groups", async (req, res) => {
  try {
    const query = `
      SELECT 
        tt.Tb_no, 
        tt.Tb_sala,
        i.inv_seq,
        i.INV_CAPTAIN_NO,
        i.INV_CASH_NAME,
        i.PAID,
        i.PRINTED,
        i.LOCK,
        i.INV_DATE,
        i.NUM1,
        i.INV_NOTE,
        c.CAPTAIN_NAME
      FROM Tab_tables tt
      LEFT JOIN (
        SELECT INV_FT_NO, inv_seq, INV_CAPTAIN_NO, INV_CASH_NAME, PAID, PRINTED, LOCK, INV_DATE, NUM1, INV_NOTE,
               ROW_NUMBER() OVER (PARTITION BY INV_FT_NO ORDER BY INV_DATE DESC, inv_seq DESC) AS rn
        FROM INVOICE
        WHERE INV_FT_NO IS NOT NULL
          AND DATEDIFF(day, INV_DATE, GETDATE()) = 0
      ) i ON tt.Tb_no = i.INV_FT_NO AND i.rn = 1
      LEFT JOIN CAPTAN_TB c ON i.INV_CAPTAIN_NO = c.CAPTAIN_NO
      ORDER BY tt.Tb_sala, tt.Tb_no
    `;
     
    const rows = await executeQuery(query);
    
    // Get items for tables with active invoices
    const tableNumbers = rows.filter(r => r.inv_seq).map(r => r.Tb_no);
    let itemsByTable = {};
    
    if (tableNumbers.length > 0) {
      const itemsQuery = `
        SELECT 
          i.INV_FT_NO,
          im.auto_seq,
          im.ITEM_NO,
          it.Item_name AS item_name,
          im.QTY,
          im.PRICE,
          im.notice,
          im.PP,
          (CAST(im.QTY AS float) * CAST(im.PRICE AS float)) AS line_total
        FROM INVOICE_MENU im
        JOIN INVOICE i ON im.INV_SEQ = i.inv_seq
        LEFT JOIN ITEM it ON CAST(it.Item_no AS varchar(50)) = CAST(im.ITEM_NO AS varchar(50))
        WHERE i.INV_FT_NO IN (${tableNumbers.map(() => '?').join(', ')})
          AND DATEDIFF(day, i.INV_DATE, GETDATE()) = 0
        ORDER BY im.auto_seq
      `;
      
      const items = await executeQuery(itemsQuery, tableNumbers);
      
      items.forEach(item => {
        if (!itemsByTable[item.INV_FT_NO]) {
          itemsByTable[item.INV_FT_NO] = [];
        }
        itemsByTable[item.INV_FT_NO].push({
          auto_seq: item.auto_seq,
          itemNo: item.ITEM_NO,
          itemName: item.item_name || null,
          qty: item.QTY,
          price: item.PRICE,
          notice: item.notice || '',
          pp: item.PP || 0,
          lineTotal: Number(item.line_total) || 0
        });
      });
    }
    
    const map = {};
    
    rows.forEach(r => {
      const hall = r.Tb_sala?.trim() || 'Default';
      const tableNo = String(r.Tb_no).trim();
      
      if (!map[hall]) map[hall] = [];
      
      // Calculate invoice total
      const items = itemsByTable[tableNo] || [];
      const invoiceTotal = items.reduce((sum, item) => sum + (item.lineTotal || 0), 0);
      
      // Determine color based on invoice status
      let color = "green";
      if (r.inv_seq) {
        if (r.PAID === 2 && r.PRINTED === 2) {
          color = "yellow";
        } else if (r.PAID === 2 && r.PRINTED === 1) {
          color = "red";
        }
      }
      
      map[hall].push({
        number: tableNo,
        status: r.inv_seq ? "occupied" : "available",
        color,
        captain: r.inv_seq ? {
          captainNo: r.INV_CAPTAIN_NO,
          captainName: r.INV_CASH_NAME || r.CAPTAIN_NAME,
          displayName: r.INV_CASH_NAME || r.CAPTAIN_NAME || "غير محدد"
        } : null,
        invoice: r.inv_seq ? {
          inv_seq: r.inv_seq,
          num1: r.NUM1,
          date: r.INV_DATE,
          paid: r.PAID,
          printed: r.PRINTED,
          locked: r.LOCK,
          note: r.INV_NOTE,
          total: invoiceTotal,
          items: items
        } : null
      });
    });
    
    const result = Object.entries(map).map(([hall, tables], index) => ({ 
      id: index + 1,
      hall: hall, 
      tables: tables.sort((a, b) => parseInt(a.number) - parseInt(b.number))
    }));
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching table groups:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch table groups', 
      error: error.message 
    });
  }
});

// POST /api/tab-tabels - إضافة طاولة جديدة
router.post("/", async (req, res) => {
  try {
    const { Tb_no, Tb_sala } = req.body;
    
    if (!Tb_no || !Tb_sala) {
      return res.status(400).json({
        success: false,
        message: "Tb_no and Tb_sala are required"
      });
    }
    
    // التحقق من عدم وجود طاولة بنفس الرقم في نفس القاعة
    const checkQuery = `
      SELECT id FROM Tab_tables 
      WHERE Tb_no = ? AND Tb_sala = ?
    `;
    
    const existing = await executeQuery(checkQuery, [Tb_no, Tb_sala]);
    
    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Table already exists in this hall"
      });
    }
    
    // Get the next available ID
    const maxIdQuery = `SELECT ISNULL(MAX(id), 0) + 1 as nextId FROM Tab_tables`;
    const maxIdResult = await executeQuery(maxIdQuery);
    const nextId = maxIdResult[0].nextId;
    
    const insertQuery = `
      INSERT INTO Tab_tables (id, Tb_no, Tb_sala) 
      VALUES (?, ?, ?)
    `;
    
    await executeQuery(insertQuery, [nextId, Tb_no, Tb_sala]);
    
    res.json({
      success: true,
      message: "Table added successfully"
    });
  } catch (error) {
    console.error('Error adding table:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add table',
      error: error.message
    });
  }
});

// PUT /api/tab-tabels/:id - تعديل طاولة
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { Tb_no, Tb_sala } = req.body;
    
    if (!Tb_no || !Tb_sala) {
      return res.status(400).json({
        success: false,
        message: "Tb_no and Tb_sala are required"
      });
    }
    
    // التحقق من وجود الطاولة
    const checkQuery = `SELECT id FROM Tab_tables WHERE id = ?`;
    const existing = await executeQuery(checkQuery, [id]);
    
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Table not found"
      });
    }
    
    // التحقق من عدم وجود طاولة بنفس الرقم في نفس القاعة (باستثناء الطاولة الحالية)
    const duplicateQuery = `
      SELECT id FROM Tab_tables 
      WHERE Tb_no = ? AND Tb_sala = ? AND id != ?
    `;
    
    const duplicate = await executeQuery(duplicateQuery, [Tb_no, Tb_sala, id]);
    
    if (duplicate.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Table already exists in this hall"
      });
    }
    
    const updateQuery = `
      UPDATE Tab_tables 
      SET Tb_no = ?, Tb_sala = ?, updated_at = GETDATE()
      WHERE id = ?
    `;
    
    await executeQuery(updateQuery, [Tb_no, Tb_sala, id]);
    
    res.json({
      success: true,
      message: "Table updated successfully"
    });
  } catch (error) {
    console.error('Error updating table:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update table',
      error: error.message
    });
  }
});

// DELETE /api/tab-tabels/:id - حذف طاولة
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // التحقق من وجود الطاولة
    const checkQuery = `SELECT id, Tb_no, Tb_sala FROM Tab_tables WHERE id = ?`;
    const existing = await executeQuery(checkQuery, [id]);
    
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Table not found"
      });
    }
    
    const table = existing[0];
    
    // تنفيذ stored procedure A1 للتحقق من الحالة
    try {
      const procedureResult = await executeStoredProcedure('A1', {
        tableNo: table.Tb_no,
        hall: table.Tb_sala
      });
      
      // إذا كان lock = 1 و PP = 1، لا يتم الحذف
      if (procedureResult && procedureResult.length > 0) {
        const result = procedureResult[0];
        if (result.lock === 1 && result.PP === 1) {
          return res.json({
            success: false,
            message: "Cannot delete table - it is locked and printed"
          });
        }
        
        // إذا كان PP = 1 و lock = 0 (مطبوعة للمطبخ)
        if (result.PP === 1 && result.lock === 0) {
          // هنا يمكن إضافة رسالة تأكيدية للحذف
          
          
          // تنفيذ الإجراءات المطلوبة
          await executeStoredProcedure('t00_BACK', {});
          await executeStoredProcedure('b00', {});
          await executeStoredProcedure('APPEND_DELETED_ITEMS', {
            tableNo: table.Tb_no,
            hall: table.Tb_sala
          });
        }
      }
    } catch (procedureError) {
      console.warn('Stored procedure execution failed, proceeding with deletion:', procedureError);
    }
    
    // حذف الطاولة
    const deleteQuery = `DELETE FROM Tab_tables WHERE id = ?`;
    await executeQuery(deleteQuery, [id]);
    
    res.json({
      success: true,
      message: "Table deleted successfully"
    });
  } catch (error) {
    console.error('Error deleting table:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete table',
      error: error.message
    });
  }
});

// POST /api/tab-tabels/bulk - إضافة عدة طاولات دفعة واحدة
router.post("/bulk", async (req, res) => {
  try {
    const { tables } = req.body;
    
    if (!Array.isArray(tables) || tables.length === 0) {
      return res.status(400).json({
        success: false,
        message: "tables array is required"
      });
    }
    
    const results = [];
    
    for (const table of tables) {
      const { Tb_no, Tb_sala } = table;
      
      if (!Tb_no || !Tb_sala) {
        results.push({
          Tb_no,
          Tb_sala,
          success: false,
          message: "Tb_no and Tb_sala are required"
        });
        continue;
      }
      
      try {
        // التحقق من عدم وجود طاولة بنفس الرقم في نفس القاعة
        const checkQuery = `
          SELECT id FROM Tab_tables 
          WHERE Tb_no = ? AND Tb_sala = ?
        `;
        
        const existing = await executeQuery(checkQuery, [Tb_no, Tb_sala]);
        
        if (existing.length > 0) {
          results.push({
            Tb_no,
            Tb_sala,
            success: false,
            message: "Table already exists in this hall"
          });
          continue;
        }
        
        // Get the next available ID for this table
        const maxIdQuery = `SELECT ISNULL(MAX(id), 0) + 1 as nextId FROM Tab_tables`;
        const maxIdResult = await executeQuery(maxIdQuery);
        const nextId = maxIdResult[0].nextId;
        
        const insertQuery = `
          INSERT INTO Tab_tables (id, Tb_no, Tb_sala) 
          VALUES (?, ?, ?)
        `;
        
        await executeQuery(insertQuery, [nextId, Tb_no, Tb_sala]);
        
        results.push({
          Tb_no,
          Tb_sala,
          success: true,
          message: "Table added successfully"
        });
      } catch (error) {
        results.push({
          Tb_no,
          Tb_sala,
          success: false,
          message: error.message
        });
      }
    }
    
    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('Error adding bulk tables:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add bulk tables',
      error: error.message
    });
  }
});

// GET /api/tab-tabels/table/:tableNumber - جلب معلومات طاولة محددة مع الكابتن والفواتير
router.get("/table/:tableNumber", async (req, res) => {
  try {
    const { tableNumber } = req.params;

    const query = `
      SELECT 
        tt.id, 
        tt.Tb_no, 
        tt.Tb_sala,
        i.inv_seq,
        i.INV_CAPTAIN_NO,
        i.INV_CASH_NAME,
        i.PAID,
        i.PRINTED,
        i.LOCK,
        i.INV_DATE,
        i.NUM1,
        i.INV_NOTE,
        c.CAPTAIN_NAME
      FROM Tab_tables tt
      LEFT JOIN (
        SELECT INV_FT_NO, inv_seq, INV_CAPTAIN_NO, INV_CASH_NAME, PAID, PRINTED, LOCK, INV_DATE, NUM1, INV_NOTE,
               ROW_NUMBER() OVER (PARTITION BY INV_FT_NO ORDER BY INV_DATE DESC, inv_seq DESC) AS rn
        FROM INVOICE
        WHERE INV_FT_NO IS NOT NULL
          AND DATEDIFF(day, INV_DATE, GETDATE()) = 0
      ) i ON tt.Tb_no = i.INV_FT_NO AND i.rn = 1
      LEFT JOIN CAPTAN_TB c ON i.INV_CAPTAIN_NO = c.CAPTAIN_NO
      WHERE tt.Tb_no = ?
    `;

    const rows = await executeQuery(query, [tableNumber]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Table not found"
      });
    }

    const table = rows[0];

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
        color = "yellow";
      } else if (table.PAID === 2 && table.PRINTED === 1) {
        color = "red";
      }
    }

    res.json({
      success: true,
      table: {
        id: table.id,
        tableNumber: table.Tb_no,
        hall: table.Tb_sala,
        status: table.inv_seq ? "occupied" : "available",
        color,
        captain: table.inv_seq ? {
          captainNo: table.INV_CAPTAIN_NO,
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
          items: items
        } : null
      }
    });
  } catch (error) {
    console.error('Error fetching table info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch table info',
      error: error.message
    });
  }
});

module.exports = router;
