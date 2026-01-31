-- إنشاء جدول الأجهزة المصرح بها
CREATE TABLE Authorized_Devices (
    id INT IDENTITY(1,1) PRIMARY KEY,
    device_serial NVARCHAR(255) UNIQUE NOT NULL,
    device_password NVARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT GETDATE(),
    device_info NVARCHAR(MAX) NULL
);

-- إضافة بيانات تجريبية
INSERT INTO Authorized_Devices (device_serial, device_password, device_info)
VALUES ('78BE4365F15B4982', 'admin123', 'Demo Device - Windows x64');