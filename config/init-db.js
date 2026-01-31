const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Database file path
const dbPath = path.join(__dirname, "../data/almizan.db");

// Create database connection
const db = new sqlite3.Database(dbPath);

// SQL statements to create tables based on your schema
const createTables = [ 
  // Users table for authentication (exact match from schema.json)
  `CREATE TABLE IF NOT EXISTS Users (
    User_Name NVARCHAR(255),
    Password NVARCHAR(255),
    Re_Password NVARCHAR(255),
    Admin INTEGER,
    auto_no INTEGER PRIMARY KEY,
    CH_PASS NVARCHAR(255),
    F_F INTEGER,
    rr INTEGER,
    ch VARCHAR(255),
    SPEC INTEGER,
    CHE VARCHAR(255)
  )`,

  // HALLS table for areas (exact match from schema.json)
  `CREATE TABLE IF NOT EXISTS HALLS (
    HALL_NO INTEGER PRIMARY KEY,
    HALL_NAME NVARCHAR(255)
  )`,

  // FOOD_HALLS table for tables in each area (exact match from schema.json)
  `CREATE TABLE IF NOT EXISTS FOOD_HALLS (
    NO INTEGER PRIMARY KEY,
    FOOD_TABLE_NO NVARCHAR(255),
    seq INTEGER
  )`,

  // CAPTAN_TB table for staff (exact match from schema.json)
  `CREATE TABLE IF NOT EXISTS CAPTAN_TB (
    CAPTAN_NO INTEGER PRIMARY KEY,
    CAPTAN_NAME NVARCHAR(255),
    PASSWORD VARCHAR(255)
  )`,

  // INVOICE table for bookings (exact match from schema.json - key columns)
  `CREATE TABLE IF NOT EXISTS INVOICE (
    inv_seq INTEGER PRIMARY KEY,
    SEQ_NO CHAR(255),
    INV_DATE DATETIME,
    MENU_TYPE INTEGER,
    M_NAME VARCHAR(255),
    TYPE INTEGER,
    INV_CAPTAIN_NO INTEGER,
    INV_CASH_NAME VARCHAR(255),
    INV_NOTE VARCHAR(255),
    PAID INTEGER,
    CUSTOMER_NAME INTEGER,
    COST REAL,
    DISCOUNT REAL,
    PER REAL,
    MASAREEF REAL,
    SUPP VARCHAR(255),
    "check" REAL,
    PAY REAL,
    STAY REAL,
    TRACE REAL,
    MM INTEGER,
    SOLD_TYPE INTEGER,
    PAY_TYPE INTEGER,
    MUF_GOM INTEGER,
    EXCHANGE REAL,
    INV_FT_NO INTEGER
  )`,

  // Open_ProgramQ view (we'll create as a table for SQLite)
  `CREATE TABLE IF NOT EXISTS Open_ProgramQ (
    User_Name NVARCHAR(255),
    Admin INTEGER,
    auto_no INTEGER PRIMARY KEY
  )`,

  // MENU_TYPE table for menu categories (exact match from schema.json)
  `CREATE TABLE IF NOT EXISTS MENU_TYPE (
    MENU_NO INTEGER PRIMARY KEY,
    MENU_NAME VARCHAR(255)
  )`,

  // ITEM table for menu items (key columns from schema.json)
  `CREATE TABLE IF NOT EXISTS ITEM (
    Item_no VARCHAR(255) PRIMARY KEY,
    XX INTEGER,
    THE_TYPE VARCHAR(255),
    Item_name NVARCHAR(255),
    ITEM_TYPE INTEGER,
    MENU_TYPE INTEGER,
    Balance REAL,
    Item_Price REAL,
    ITEM_PRICE_SAFARI REAL,
    Item_Sale REAL,
    Item_Sale_Gom REAL,
    Item_kst REAL,
    p_1 REAL,
    P_2 REAL,
    P_3 REAL,
    CLASS INTEGER,
    ZZ INTEGER,
    PP INTEGER,
    QTY_GOM REAL,
    QQ INTEGER,
    min_value INTEGER
  )`,

  // INVOICE_MENU table for order details (key columns from schema.json)
  `CREATE TABLE IF NOT EXISTS INVOICE_MENU (
    auto_seq INTEGER PRIMARY KEY,
    INV_SEQ INTEGER,
    ITEM_NO VARCHAR(255),
    S_PRICE REAL,
    F_PRICE REAL,
    QTY REAL,
    P REAL,
    N_QTY REAL,
    notice VARCHAR(255),
    PRICE REAL
  )`,

  // License table for device activation and licensing
  `CREATE TABLE IF NOT EXISTS License (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_serial VARCHAR(255) UNIQUE NOT NULL,
    license_key VARCHAR(255) UNIQUE NOT NULL,
    is_activated INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    activated_at DATETIME,
    device_info TEXT
  )`,
];

// Sample data for testing
const insertSampleData = [
  // Insert sample halls
  `INSERT OR IGNORE INTO HALLS (HALL_NO, HALL_NAME) VALUES 
    (1, 'Youth Lounge - Indoor'),
    (2, 'Terrace Garden'),
    (3, 'Main Hall'),
    (4, 'VIP Area')`,

  // Insert sample users
  `INSERT OR IGNORE INTO Users (User_Name, Password, Admin, auto_no, SPEC, CHE) VALUES 
    ('admin', 'admin123', 2, 5, 1, '1'),
    ('user1', 'user123', 1, 6, 0, '0'),
    ('manager', 'manager123', 2, 7, 1, '1')`,

  // Insert sample Open_ProgramQ entries
  `INSERT OR IGNORE INTO Open_ProgramQ (User_Name, Admin, auto_no) VALUES 
    ('admin', 2, 5),
    ('user1', 1, 6),
    ('manager', 2, 7)`,

  // Insert sample staff
  `INSERT OR IGNORE INTO CAPTAN_TB (CAPTAN_NO, CAPTAN_NAME, PASSWORD) VALUES 
    (1, 'John Smith', 'staff123'),
    (2, 'Sarah Johnson', 'staff456'),
    (3, 'Mike Wilson', 'staff789')`,

  // Insert sample tables
  `INSERT OR IGNORE INTO FOOD_HALLS (NO, FOOD_TABLE_NO, seq) VALUES 
    (1, 'T1', 1),
    (2, 'T2', 1),
    (3, 'T3', 1),
    (4, 'T4', 2),
    (5, 'T5', 2),
    (6, 'T6', 3),
    (7, 'T7', 3),
    (8, 'T8', 4)`,

  // Insert sample menu categories (الأقسام)
  `INSERT OR IGNORE INTO MENU_TYPE (MENU_NO, MENU_NAME) VALUES 
    (1, 'بيتزا'),
    (2, 'شاورما'),
    (3, 'مشروبات'),
    (4, 'سلطات'),
    (5, 'حلويات'),
    (6, 'مقبلات'),
    (7, 'وجبات رئيسية')`,

  // Insert sample menu items (الأصناف)
  `INSERT OR IGNORE INTO ITEM (Item_no, Item_name, MENU_TYPE, Item_Price, Item_Sale, Balance, THE_TYPE) VALUES 
    ('P001', 'بيتزا مارجريتا', 1, 15.0, 15.0, 50, 'بيتزا'),
    ('P002', 'بيتزا شيتون', 1, 16.5, 16.5, 30, 'بيتزا'),
    ('P003', 'بيتزا هوائي', 1, 16.0, 16.0, 25, 'بيتزا'),
    ('P004', 'بيتزا مكسيكية', 1, 19.0, 19.0, 20, 'بيتزا'),
    ('P005', 'بيتزا ماكس بورج', 1, 20.0, 20.0, 15, 'بيتزا'),
    ('P006', 'بيتزا فاين', 1, 18.5, 18.5, 18, 'بيتزا'),
    ('P007', 'بيتزا فيفر شيتو', 1, 17.5, 17.5, 22, 'بيتزا'),
    ('P008', 'بيتزا بيبروني', 1, 18.0, 18.0, 25, 'بيتزا')`,

  `INSERT OR IGNORE INTO ITEM (Item_no, Item_name, MENU_TYPE, Item_Price, Item_Sale, Balance, THE_TYPE) VALUES 
    ('S001', 'شاورما دجاج', 2, 12.0, 12.0, 40, 'شاورما'),
    ('S002', 'شاورما لحم', 2, 14.0, 14.0, 35, 'شاورما'),
    ('S003', 'شاورما مكس', 2, 15.0, 15.0, 30, 'شاورما'),
    ('D001', 'كولا', 3, 3.0, 3.0, 100, 'مشروب'),
    ('D002', 'عصير برتقال', 3, 4.0, 4.0, 80, 'مشروب'),
    ('D003', 'عصير تفاح', 3, 4.0, 4.0, 75, 'مشروب'),
    ('SA01', 'سلطة خضراء', 4, 8.0, 8.0, 60, 'سلطة'),
    ('SA02', 'سلطة سيزر', 4, 10.0, 10.0, 45, 'سلطة')`,

  // Insert sample bookings
  `INSERT OR IGNORE INTO INVOICE (inv_seq, SEQ_NO, INV_DATE, INV_FT_NO, CUSTOMER_NAME, COST, PAID) VALUES 
    (1, 'B001', datetime('now'), 'T1', 1, 50.00, 0),
    (2, 'B002', datetime('now', '+1 hour'), 'T3', 2, 75.00, 1),
    (3, 'B003', datetime('now', '+2 hours'), 'T5', 3, 100.00, 0)`,

  // Insert sample license (سيتم تحديثه بالسيريال الحقيقي عند التفعيل الأول)
  `INSERT OR IGNORE INTO License (device_serial, license_key, is_activated, device_info) VALUES
    ('78BE4365F15B4982', 'AL-MIZAN-2024-001', 0, 'Demo Device - Windows x64')`,
];

// Initialize database
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    

    // Create tables
    let tablesCreated = 0;
    createTables.forEach((sql, index) => {
      db.run(sql, (err) => {
        if (err) {
          console.error(`❌ Error creating table ${index + 1}:`, err);
          reject(err);
          return;
        }

        tablesCreated++;
        

        if (tablesCreated === createTables.length) {
          

          // Insert sample data
          let dataInserted = 0;
          insertSampleData.forEach((sql, index) => {
            db.run(sql, (err) => {
              if (err) {
                console.error(
                  `❌ Error inserting sample data ${index + 1}:`,
                  err
                );
                // Don't reject here, just log the error
              } else {
                
              }

              dataInserted++;
              if (dataInserted === insertSampleData.length) {
                
                db.close();
                resolve();
              }
            });
          });
        }
      });
    });
  });
}

// Export the initialization function
module.exports = { initializeDatabase };

// If this file is run directly, initialize the database
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Database initialization failed:", error);
      process.exit(1);
    });
}
