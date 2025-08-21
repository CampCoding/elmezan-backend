const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config({ path: "./config.env" });

const app = express();
const PORT = process.env.PORT || 3000;

// Import routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const areaRoutes = require("./routes/areas");
const tableRoutes = require("./routes/tables"); 
const bookingRoutes = require("./routes/bookings");
const captainRoutes = require("./routes/captains");
const menuRoutes = require("./routes/menu");
const orderRoutes = require("./routes/orders");

// Import database functions for testing
const { connectDB, executeQuery } = require("./config/database");

// Middleware
app.use(cors());
app.use(morgan("combined"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/areas", areaRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/captains", captainRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/orders", orderRoutes);

// Database connection test endpoint
app.get("/api/test-db", async (req, res) => {
  try {
    console.log("🔍 Testing database connection...");

    // Test basic connection
    const pool = await connectDB();
    console.log("✅ Database connection successful");

    // Test a simple query
    const testQuery = "SELECT 1 as test";
    const result = await executeQuery(testQuery);
    console.log("✅ Test query successful:", result);

    res.json({
      success: true,
      message: "Database connection successful",
      connection: "Connected",
      testQuery: result,
      config: {
        dbType: process.env.DB_TYPE,
        server: process.env.DB_SERVER,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
      },
    });
  } catch (error) {
    console.error("❌ Database test failed:", error);
    res.status(500).json({
      success: false,
      message: "Database connection failed",
      error: error.message,
      config: {
        dbType: process.env.DB_TYPE,
        server: process.env.DB_SERVER,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
      },
    });
  }
});

// Simple health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "AlMizan server is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Root endpoint - API information
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "AlMizan API Server",
    version: "1.0.0",
    // endpoints: {
    //   auth: "/api/auth",
    //   users: "/api/users",
    //   areas: "/api/areas",
    //   tables: "/api/tables",
    //   bookings: "/api/bookings",
    //   test: "/api/test-db",
    //   health: "/api/health",
    // },
    // documentation: "Check README.md for API usage details",
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "development" ? err.message : {},
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    // availableEndpoints: [
    //   "/api/auth",
    //   "/api/users",
    //   "/api/areas",
    //   "/api/tables",
    //   "/api/bookings",
    //   "/api/test-db",
    //   "/api/health",
    // ],
  });
});

app.listen(PORT, () => {
  console.log(`🚀 AlMizan server running on port ${PORT}`);
  console.log(
    `🔌 Database: ${process.env.DB_TYPE} on ${process.env.DB_SERVER}`
  );
  console.log(`📊 Database: ${process.env.DB_NAME}`);
  console.log(`👤 User: ${process.env.DB_USER}`);
  console.log(`🌐 API available at http://localhost:${PORT}/api`);
  console.log(
    `🔍 Test database connection: http://localhost:${PORT}/api/test-db`
  );
  console.log(`📖 API info: http://localhost:${PORT}/`);
});
