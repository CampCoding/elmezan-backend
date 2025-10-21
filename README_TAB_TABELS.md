# جدول Tab_tabels - نظام إدارة الطاولات والقاعات

## نظرة عامة
تم إنشاء نظام متكامل لإدارة الطاولات والقاعات في المطعم باستخدام جدول `Tab_tabels`. هذا النظام يتيح إدارة الطاولات حسب القاعات وعرضها في واجهة المستخدم بشكل منظم.

## المميزات

### ✅ المميزات المنجزة
1. **إنشاء الجدول تلقائياً**: يتم إنشاء جدول `Tab_tabels` تلقائياً عند بدء التطبيق
2. **البيانات الأولية**: إضافة البيانات الأولية كما طلبت في المثال
3. **API كامل**: endpoints للإضافة والتعديل والحذف
4. **التجميع حسب القاعة**: عرض الطاولات مجمعة حسب القاعة
5. **التحقق من التكرار**: منع إضافة طاولة بنفس الرقم في نفس القاعة
6. **إضافة دفعة واحدة**: إمكانية إضافة عدة طاولات دفعة واحدة
7. **التحقق عند الحذف**: تنفيذ stored procedures للتحقق من حالة الطاولة

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

## النتيجة المتوقعة

عند عرض شاشة الطاولات، ستظهر أزرار الأمر:
- **صالة**: تحتوي على الطاولات 1, 2, 3, 6
- **حديقة**: تحتوي على الطاولات 4, 5

## API Endpoints

### 1. جلب جميع الطاولات
```
GET /api/tab-tabels
```

### 2. جلب الطاولات مجمعة حسب القاعة
```
GET /api/tab-tabels/groups
```

### 3. إضافة طاولة جديدة
```
POST /api/tab-tabels
Body: { "Tb_no": "7", "Tb_sala": "صالة" }
```

### 4. تعديل طاولة
```
PUT /api/tab-tabels/:id
Body: { "Tb_no": "8", "Tb_sala": "حديقة" }
```

### 5. حذف طاولة
```
DELETE /api/tab-tabels/:id
```

### 6. إضافة عدة طاولات دفعة واحدة
```
POST /api/tab-tabels/bulk
Body: { "tables": [{ "Tb_no": "9", "Tb_sala": "صالة" }] }
```

## منطق الحذف

عند حذف طاولة، يتم تنفيذ الإجراءات التالية:

1. **تنفيذ stored procedure A1** للتحقق من حالة الطاولة
2. **إذا كان lock = 1 و PP = 1**: لا يتم الحذف وينتهي الأمر
3. **إذا كان PP = 1 و lock = 0** (مطبوعة للمطبخ):
   - عرض رسالة تأكيدية للحذف
   - تنفيذ `t00_BACK`
   - تنفيذ `b00`
   - تنفيذ `APPEND_DELETED_ITEMS`
4. **حذف الطاولة من الجدول**

## التثبيت والتشغيل

### 1. تثبيت المتطلبات
```bash
npm install
```

### 2. تشغيل الخادم
```bash
npm start
# أو للتطوير
npm run dev
```

### 3. تهيئة البيانات الأولية (تلقائية)
البيانات الأولية تضاف تلقائياً عند بدء التطبيق، أو يمكن تشغيلها يدوياً:
```bash
npm run init-tab-tabels
```

### 4. اختبار الـ API
```bash
npm run test-tab-tabels
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

## الاستجابة المتوقعة

### جلب الطاولات مجمعة
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

## الملفات المضافة

1. **`Server/routes/tab_tabels.js`**: ملف الـ routes الرئيسي
2. **`Server/config/init-tab-tabels.js`**: ملف تهيئة البيانات الأولية
3. **`Server/test-tab-tabels.js`**: ملف اختبار الـ API
4. **`Server/TAB_TABELS_API.md`**: توثيق مفصل للـ API
5. **`Server/README_TAB_TABELS.md`**: هذا الملف

## التحديثات المطلوبة

1. **`Server/server.js`**: إضافة الـ route الجديد
2. **`Server/package.json`**: إضافة axios و scripts جديدة

## ملاحظات مهمة

1. ✅ تم إنشاء الجدول `Tab_tabels` مع الحقول المطلوبة
2. ✅ تم إضافة البيانات الأولية كما طلبت
3. ✅ تم إنشاء endpoints للإضافة والتعديل والحذف
4. ✅ تم تنفيذ منطق الحذف مع stored procedures
5. ✅ تم إضافة التجميع حسب القاعة
6. ✅ تم إضافة الاختبارات والتوثيق

## الخطوات التالية

1. تشغيل الخادم: `npm start`
2. اختبار الـ API: `npm run test-tab-tabels`
3. دمج الـ API مع واجهة المستخدم
4. إضافة المزيد من الميزات حسب الحاجة

## الدعم

لأي استفسارات أو مشاكل، يرجى مراجعة:
- ملف `TAB_TABELS_API.md` للتوثيق المفصل
- ملف `test-tab-tabels.js` لأمثلة الاستخدام
- سجلات الخادم للتشخيص
