# Tab_tabels API Documentation

## نظرة عامة
هذا الـ API يدير جدول `Tab_tabels` الذي يحتوي على الطاولات والقاعات في المطعم.

## هيكل الجدول
```sql
CREATE TABLE Tab_tabels (
  id INT IDENTITY(1,1) PRIMARY KEY,
  Tb_no VARCHAR(50) NOT NULL,        -- رقم الطاولة
  Tb_sala VARCHAR(100) NOT NULL,     -- اسم القاعة
  created_at DATETIME DEFAULT GETDATE(),
  updated_at DATETIME DEFAULT GETDATE()
)
```

## البيانات الأولية
```javascript
[
  { Tb_no: "1", Tb_sala: "صالة" },
  { Tb_no: "2", Tb_sala: "صالة" },
  { Tb_no: "3", Tb_sala: "صالة" },
  { Tb_no: "4", Tb_sala: "حديقة" },
  { Tb_no: "5", Tb_sala: "حديقة" },
  { Tb_no: "6", Tb_sala: "صالة" }
]
```

## Endpoints

### 1. جلب جميع الطاولات
**GET** `/api/tab-tabels`

**الاستجابة:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "Tb_no": "1",
      "Tb_sala": "صالة",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ],
  "groups": [
    {
      "hall": "صالة",
      "tables": [
        {
          "id": 1,
          "tableNo": "1",
          "hall": "صالة"
        }
      ]
    }
  ]
}
```

### 2. جلب الطاولات مجمعة حسب القاعة
**GET** `/api/tab-tabels/groups`

**الاستجابة:**
```json
{
  "success": true,
  "groups": [
    {
      "hall": "صالة",
      "tables": ["1", "2", "3", "6"]
    },
    {
      "hall": "حديقة",
      "tables": ["4", "5"]
    }
  ]
}
```

### 3. إضافة طاولة جديدة
**POST** `/api/tab-tabels`

**البيانات المطلوبة:**
```json
{
  "Tb_no": "7",
  "Tb_sala": "صالة"
}
```

**الاستجابة:**
```json
{
  "success": true,
  "message": "Table added successfully"
}
```

### 4. تعديل طاولة
**PUT** `/api/tab-tabels/:id`

**البيانات المطلوبة:**
```json
{
  "Tb_no": "8",
  "Tb_sala": "حديقة"
}
```

**الاستجابة:**
```json
{
  "success": true,
  "message": "Table updated successfully"
}
```

### 5. حذف طاولة
**DELETE** `/api/tab-tabels/:id`

**الاستجابة:**
```json
{
  "success": true,
  "message": "Table deleted successfully"
}
```

**ملاحظة:** عند الحذف، يتم تنفيذ stored procedure `A1` للتحقق من حالة الطاولة:
- إذا كان `lock = 1` و `PP = 1`: لا يتم الحذف
- إذا كان `PP = 1` و `lock = 0`: يتم تنفيذ الإجراءات التالية:
  - `t00_BACK`
  - `b00`
  - `APPEND_DELETED_ITEMS`

### 6. إضافة عدة طاولات دفعة واحدة
**POST** `/api/tab-tabels/bulk`

**البيانات المطلوبة:**
```json
{
  "tables": [
    { "Tb_no": "7", "Tb_sala": "صالة" },
    { "Tb_no": "8", "Tb_sala": "حديقة" },
    { "Tb_no": "9", "Tb_sala": "صالة" }
  ]
}
```

**الاستجابة:**
```json
{
  "success": true,
  "results": [
    {
      "Tb_no": "7",
      "Tb_sala": "صالة",
      "success": true,
      "message": "Table added successfully"
    }
  ]
}
```

## أمثلة الاستخدام

### إضافة طاولة جديدة
```bash
curl -X POST http://localhost:3000/api/tab-tabels \
  -H "Content-Type: application/json" \
  -d '{"Tb_no": "10", "Tb_sala": "صالة"}'
```

### جلب الطاولات مجمعة
```bash
curl http://localhost:3000/api/tab-tabels/groups
```

### تعديل طاولة
```bash
curl -X PUT http://localhost:3000/api/tab-tabels/1 \
  -H "Content-Type: application/json" \
  -d '{"Tb_no": "11", "Tb_sala": "حديقة"}'
```

### حذف طاولة
```bash
curl -X DELETE http://localhost:3000/api/tab-tabels/1
```

## رسائل الخطأ

### 400 Bad Request
```json
{
  "success": false,
  "message": "Tb_no and Tb_sala are required"
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Table not found"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Failed to add table",
  "error": "Error details"
}
```

## ملاحظات مهمة
1. لا يمكن إضافة طاولة بنفس الرقم في نفس القاعة
2. عند الحذف، يتم التحقق من حالة الطاولة عبر stored procedures
3. البيانات الأولية تضاف تلقائياً عند بدء التطبيق
4. جميع الطاولات مرتبة حسب القاعة ثم رقم الطاولة
