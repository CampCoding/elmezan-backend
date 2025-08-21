const sql = require("mssql");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

// SQL Server configuration
const sqlServerConfig = {    
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT, 10) || 1433,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  }
};

// SQLite configuration for development
const sqliteConfig = {
  filename: path.join(__dirname, "../data/almizan.db"),
  mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
};

let dbType = process.env.DB_TYPE || "sqlserver";
let sqlServerPool = null;

// Database connection function
async function connectDB() {
  try {
    if (dbType === "sqlite") {
      // For SQLite, we'll use a different approach
      console.log("📁 Using SQLite database");
      return null; // SQLite connection will be handled differently
    } else {
      // SQL Server connection with pooling
      if (!sqlServerPool) {
        sqlServerPool = await sql.connect(sqlServerConfig);
        console.log("🔌 Connected to SQL Server database");
      }
      return sqlServerPool;
    }
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    throw error;
  }
}

// Query execution function
async function executeQuery(query, params = []) {
  try {
    if (dbType === "sqlite") {
      // SQLite query execution
      const sqlite3 = require("sqlite3").verbose();
      const db = new sqlite3.Database(sqliteConfig.filename);

      return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
          db.close();
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    } else {
      // SQL Server query execution
      const pool = await connectDB();
      const request = pool.request();

      // Replace ? placeholders with named parameters for SQL Server
      let sqlServerQuery = query;
      params.forEach((param, index) => {
        const paramName = `param${index}`;
        sqlServerQuery = sqlServerQuery.replace('?', `@${paramName}`);
        request.input(paramName, param);
      });

      const result = await request.query(sqlServerQuery);
      return result.recordset;
    }
  } catch (error) {
    console.error("❌ Query execution failed:", error);
    throw error;
  }
}

// Close database connection
async function closeDB() {
  try {
    if (dbType !== "sqlite" && sqlServerPool) {
      await sqlServerPool.close();
      sqlServerPool = null;
      console.log("🔌 Database connection closed");
    }
  } catch (error) {
    console.error("❌ Error closing database:", error);
  }
}

module.exports = {
  connectDB,
  executeQuery,
  closeDB,
  sqlServerConfig,
  sqliteConfig,
};
