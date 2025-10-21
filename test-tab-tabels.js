const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api/tab_tabels';

// دالة مساعدة للطباعة
function log(message, data = null) {
  
  if (data) {
    
  }
}

// دالة مساعدة للتعامل مع الأخطاء
function handleError(error, operation) {
  console.error(`❌ Error in ${operation}:`, error.response?.data || error.message);
}

async function testTabTabelsAPI() {
  try {
    log('🚀 Starting Tab_tabels API tests...');

    // 1. اختبار جلب جميع الطاولات
    log('📋 1. Testing GET /api/tab_tabels');
    try {
      const response = await axios.get(BASE_URL);
      log('✅ Successfully fetched all tables:', response.data);
    } catch (error) {
      handleError(error, 'fetching all tables');
    }

    // 2. اختبار جلب الطاولات مجمعة
    log('📋 2. Testing GET /api/tab_tabels/groups');
    try {
      const response = await axios.get(`${BASE_URL}/groups`);
      log('✅ Successfully fetched grouped tables:', response.data);
    } catch (error) {
      handleError(error, 'fetching grouped tables');
    }

    // 3. اختبار إضافة طاولة جديدة
    log('📋 3. Testing POST /api/tab_tabels');
    try {
      const newTable = {
        Tb_no: "7",
        Tb_sala: "صالة"
      };
      const response = await axios.post(BASE_URL, newTable);
      log('✅ Successfully added new table:', response.data);
    } catch (error) {
      handleError(error, 'adding new table');
    }

    // 4. اختبار إضافة طاولة أخرى
    log('📋 4. Testing POST /api/tab_tabels (second table)');
    try {
      const newTable2 = {
        Tb_no: "8",
        Tb_sala: "حديقة"
      };
      const response = await axios.post(BASE_URL, newTable2);
      log('✅ Successfully added second table:', response.data);
    } catch (error) {
      handleError(error, 'adding second table');
    }

    // 5. اختبار إضافة طاولة مكررة (يجب أن تفشل)
    log('📋 5. Testing POST /api/tab_tabels (duplicate table)');
    try {
      const duplicateTable = {
        Tb_no: "7",
        Tb_sala: "صالة"
      };
      const response = await axios.post(BASE_URL, duplicateTable);
      log('❌ Unexpected success for duplicate table:', response.data);
    } catch (error) {
      log('✅ Correctly rejected duplicate table:', error.response?.data);
    }

    // 6. اختبار إضافة عدة طاولات دفعة واحدة
    log('📋 6. Testing POST /api/tab_tabels/bulk');
    try {
      const bulkTables = {
        tables: [
          { Tb_no: "9", Tb_sala: "صالة" },
          { Tb_no: "10", Tb_sala: "حديقة" },
          { Tb_no: "11", Tb_sala: "صالة" }
        ]
      };
      const response = await axios.post(`${BASE_URL}/bulk`, bulkTables);
      log('✅ Successfully added bulk tables:', response.data);
    } catch (error) {
      handleError(error, 'adding bulk tables');
    }

    // 7. اختبار تعديل طاولة
    log('📋 7. Testing PUT /api/tab_tabels/:id');
    try {
      const updateData = {
        Tb_no: "12",
        Tb_sala: "حديقة"
      };
      const response = await axios.put(`${BASE_URL}/1`, updateData);
      log('✅ Successfully updated table:', response.data);
    } catch (error) {
      handleError(error, 'updating table');
    }

    // 8. اختبار جلب الطاولات بعد التعديل
    log('📋 8. Testing GET /api/tab_tabels (after updates)');
    try {
      const response = await axios.get(BASE_URL);
      log('✅ Successfully fetched updated tables:', response.data);
    } catch (error) {
      handleError(error, 'fetching updated tables');
    }

    // 9. اختبار جلب الطاولات مجمعة بعد التعديل
    log('📋 9. Testing GET /api/tab_tabels/groups (after updates)');
    try {
      const response = await axios.get(`${BASE_URL}/groups`);
      log('✅ Successfully fetched updated grouped tables:', response.data);
    } catch (error) {
      handleError(error, 'fetching updated grouped tables');
    }

    // 10. اختبار حذف طاولة
    log('📋 10. Testing DELETE /api/tab_tabels/:id');
    try {
      const response = await axios.delete(`${BASE_URL}/1`);
      log('✅ Successfully deleted table:', response.data);
    } catch (error) {
      handleError(error, 'deleting table');
    }

    // 11. اختبار جلب الطاولات بعد الحذف
    log('📋 11. Testing GET /api/tab_tabels (after deletion)');
    try {
      const response = await axios.get(BASE_URL);
      log('✅ Successfully fetched tables after deletion:', response.data);
    } catch (error) {
      handleError(error, 'fetching tables after deletion');
    }

    log('🎉 All tab_tabels API tests completed!');

  } catch (error) {
    console.error('💥 Test suite failed:', error.message);
  }
}

// تشغيل الاختبارات
if (require.main === module) {
  testTabTabelsAPI();
}

module.exports = { testTabTabelsAPI };
