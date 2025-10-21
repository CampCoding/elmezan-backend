const { executeQuery } = require("./database");

// البيانات الأولية للطاولات
const initialTables = [
  { Tb_no: "1", Tb_sala: "صالة" },
  { Tb_no: "2", Tb_sala: "صالة" },
  { Tb_no: "3", Tb_sala: "صالة" },
  { Tb_no: "4", Tb_sala: "حديقة" },
  { Tb_no: "5", Tb_sala: "حديقة" },
  { Tb_no: "6", Tb_sala: "صالة" }
];

// دالة لإضافة البيانات الأولية
async function initializeTabTabels() {
  try {
    
    
    // التحقق من وجود البيانات
    const checkQuery = `SELECT COUNT(*) as count FROM Tab_tables`;
    const result = await executeQuery(checkQuery);
    const existingCount = result[0]?.count || 0;
    
    if (existingCount > 0) {
      
      return;
    }
    
    // إضافة البيانات الأولية
  
    
    
    
    // عرض البيانات المضافة
    const displayQuery = `
      SELECT Tb_no, Tb_sala 
      FROM Tab_tables 
      ORDER BY Tb_sala, Tb_no
    `;
    
    const tables = await executeQuery(displayQuery);
    
    
    const grouped = {};
    tables.forEach(t => {
      const hall = t.Tb_sala;
      if (!grouped[hall]) grouped[hall] = [];
      grouped[hall].push(t.Tb_no);
    });
    
    Object.entries(grouped).forEach(([hall, tableNos]) => {
      
    });
    
  } catch (error) {
    console.error("❌ Error initializing Tab_tables:", error);
    throw error;
  }
}

// تصدير الدالة للاستخدام في الملفات الأخرى
module.exports = { initializeTabTabels };

// تشغيل التهيئة إذا تم تشغيل الملف مباشرة
if (require.main === module) {
  initializeTabTabels()
    .then(() => {
      
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Tab_tables initialization script failed:", error);
      process.exit(1);
    });
}
