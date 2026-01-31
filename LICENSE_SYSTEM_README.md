# نظام الترخيص - AlMizan License System

## نظرة عامة
تم إضافة نظام ترخيص شامل للبرنامج يضمن أن البرنامج لا يعمل إلا على الأجهزة المفعلة.

## الميزات
- ✅ التحقق من سيريال الجهاز تلقائياً
- ✅ تفعيل البرنامج بمفتاح ترخيص
- ✅ منع تشغيل البرنامج بدون ترخيص
- ✅ إدارة مفاتيح الترخيص
- ✅ حماية من النقل بين الأجهزة

## API Endpoints

### 1. التحقق من حالة الترخيص
```
GET /api/license/status
```
**الرد:**
```json
{
  "success": true,
  "isActivated": true/false,
  "license": {
    "id": 1,
    "deviceSerial": "78BE4365F15B4982",
    "licenseKey": "AL-MIZAN-2024-001",
    "activatedAt": "2026-01-19T15:08:45.729Z",
    "deviceInfo": "..."
  },
  "currentDeviceSerial": "78BE4365F15B4982"
}
```

### 2. تفعيل البرنامج
```
POST /api/license/activate
Content-Type: application/json

{
  "licenseKey": "AL-MIZAN-2024-001"
}
```
**الرد:**
```json
{
  "success": true,
  "message": "تم تفعيل البرنامج بنجاح",
  "license": {
    "deviceSerial": "78BE4365F15B4982",
    "licenseKey": "AL-MIZAN-2024-001",
    "activatedAt": "2026-01-19T15:08:45.729Z",
    "deviceInfo": {...}
  }
}
```

### 3. إلغاء تفعيل البرنامج
```
POST /api/license/deactivate
```
**الرد:**
```json
{
  "success": true,
  "message": "تم إلغاء تفعيل البرنامج",
  "deviceSerial": "78BE4365F15B4982"
}
```

### 4. إضافة مفتاح ترخيص جديد
```
POST /api/license/add-license
Content-Type: application/json

{
  "licenseKey": "NEW-LICENSE-KEY",
  "deviceSerial": "OPTIONAL_DEVICE_SERIAL"
}
```

## طريقة عمل النظام

### 1. عند بدء تشغيل البرنامج:
- يقوم الـ middleware بفحص جدول `License`
- يبحث عن سيريال الجهاز الحالي في السجلات المفعلة
- إذا لم يجد ترخيص مفعل: **يمنع الوصول لجميع endpoints**

### 2. استثناءات (endpoints التي تعمل بدون ترخيص):
- `/api/license/*` - جميع endpoints الترخيص
- `/api/health` - حالة السيرفر
- `/api/test-db` - اختبار قاعدة البيانات
- `/api/serial` - الحصول على سيريال الجهاز

### 3. طريقة الحصول على سيريال الجهاز:
يجرب النظام عدة طرق بالترتيب:
1. BIOS Serial Number
2. Motherboard Serial Number
3. Disk Drive Serial Number
4. CPU Processor ID
5. Hash من معلومات النظام (hostname, platform, arch, cpus, memory)

## هيكل قاعدة البيانات

```sql
CREATE TABLE License (
    id INT IDENTITY(1,1) PRIMARY KEY,
    device_serial NVARCHAR(255) NULL,
    license_key NVARCHAR(255) UNIQUE NOT NULL,
    is_activated BIT DEFAULT 0,
    created_at DATETIME DEFAULT GETDATE(),
    activated_at DATETIME NULL,
    device_info NVARCHAR(MAX) NULL
);
```

## كيفية الاستخدام

### 1. إضافة مفتاح ترخيص جديد:
```javascript
// إضافة مفتاح لجهاز محدد
POST /api/license/add-license
{
  "licenseKey": "MY-LICENSE-001",
  "deviceSerial": "DEVICE_SERIAL_HERE"
}

// أو إضافة مفتاح عام
POST /api/license/add-license
{
  "licenseKey": "MY-LICENSE-002"
}
```

### 2. تفعيل البرنامج:
```javascript
POST /api/license/activate
{
  "licenseKey": "MY-LICENSE-001"
}
```

### 3. التحقق من الحالة:
```javascript
GET /api/license/status
```

## أمان النظام

### ✅ المزايا الأمنية:
- سيريال الجهاز مرتبط بالترخيص
- لا يمكن نقل الترخيص بسهولة
- تشفير معلومات الجهاز
- حماية من التلاعب في البيانات

### ⚠️ تحذيرات:
- يعتمد على سيريال الجهاز (قد يتغير عند تغيير الهاردوير)
- لا يحمي من الهجمات على قاعدة البيانات
- يحتاج صيانة دورية للمفاتيح

## اختبار النظام

### 1. اختبار التفعيل:
```bash
# إضافة مفتاح
curl -X POST http://localhost:3000/api/license/add-license \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"TEST-KEY-001"}'

# تفعيل
curl -X POST http://localhost:3000/api/license/activate \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"TEST-KEY-001"}'

# التحقق
curl http://localhost:3000/api/license/status
```

### 2. اختبار الحماية:
```bash
# إلغاء التفعيل
curl -X POST http://localhost:3000/api/license/deactivate

# محاولة الوصول لـ endpoint محمي
curl http://localhost:3000/api/users
# يجب أن يرجع خطأ 403
```

## ملاحظات مهمة

1. **النسخ الاحتياطي**: تأكد من عمل نسخ احتياطي لجدول `License`
2. **إدارة المفاتيح**: راقب المفاتيح المستخدمة والمفعلة
3. **تحديثات**: عند تحديث البرنامج، تأكد من عمل migration للجدول
4. **الدعم**: احتفظ بسجلات التفعيل للدعم الفني

## استكشاف الأخطاء

### خطأ: "البرنامج غير مفعل"
- تأكد من وجود مفتاح ترخيص صحيح
- تأكد من أن المفتاح مفعل للجهاز الحالي
- تحقق من سيريال الجهاز: `GET /api/serial`

### خطأ: "مفتاح الترخيص غير صحيح"
- تأكد من صحة كتابة المفتاح
- تحقق من وجود المفتاح في قاعدة البيانات
- تأكد من أن المفتاح لم يتم تفعيله مسبقاً

### خطأ: "Invalid object name 'License'"
- قم بتشغيل script إنشاء الجدول
- تأكد من اتصال قاعدة البيانات