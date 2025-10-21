const sql = require("mssql");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const os = require("os");

// Function to get current IP address
function getCurrentIP() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    const interface = interfaces[interfaceName];
    for (const alias of interface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost'; // fallback
}

// SQL Server configuration
const sqlServerConfig = {    
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: getCurrentIP(),
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
      
      return null; // SQLite connection will be handled differently
    } else {
      // SQL Server connection with pooling
      if (!sqlServerPool) {
        sqlServerPool = await sql.connect(sqlServerConfig);
        
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

// Execute a stored procedure
async function executeStoredProcedure(procedureName, params = {}) {
  try {
    if (dbType === "sqlite") {
      console.warn(`⚠️ Stored procedures are not supported in SQLite. Skipping ${procedureName}.`);
      return [];
    }

    const pool = await connectDB();
    const request = pool.request();

    // Support both array and object params
    if (Array.isArray(params)) {
      params.forEach((paramValue, index) => {
        const paramName = `param${index}`;
        request.input(paramName, paramValue);
      });
    } else if (params && typeof params === "object") {
      Object.entries(params).forEach(([name, value]) => {
        // name should not include leading '@'
        const safeName = name.startsWith('@') ? name.slice(1) : name;
        request.input(safeName, value);
      });
    }

    const result = await request.execute(procedureName);
    // Return primary recordset or all
    return result.recordsets && result.recordsets.length > 1
      ? result.recordsets
      : result.recordset || [];
  } catch (error) {
    console.error(`❌ Stored procedure execution failed: ${procedureName}`, error);
    throw error;
  }
}

// Close database connection
async function closeDB() {
  try {
    if (dbType !== "sqlite" && sqlServerPool) {
      await sqlServerPool.close();
      sqlServerPool = null;
      
    }
  } catch (error) {
    console.error("❌ Error closing database:", error);
  }
}

module.exports = {
  connectDB,
  executeQuery,
  executeStoredProcedure,
  closeDB,
  sqlServerConfig,
  sqliteConfig,
};
