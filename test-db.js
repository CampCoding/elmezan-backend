const { connectDB, executeQuery } = require("./config/database");
require("dotenv").config({ path: "./config.env" });

async function testDatabase() {
  try {
    console.log("🔍 Testing database connection...");
    console.log("DB_TYPE:", process.env.DB_TYPE);
    console.log("DB_SERVER:", process.env.DB_SERVER);
    console.log("DB_NAME:", process.env.DB_NAME);
    console.log("DB_USER:", process.env.DB_USER);

    // Test connection
    const pool = await connectDB();
    console.log("✅ Database connection successful");

    // Test simple query
    const testQuery = "SELECT 1 as test";
    const result = await executeQuery(testQuery);
    console.log("✅ Test query successful:", result);

    // Test parameterized query
    const paramQuery = "SELECT ? as param1, ? as param2";
    const paramResult = await executeQuery(paramQuery, ["hello", "world"]);
    console.log("✅ Parameterized query successful:", paramResult);

    // Test if Users table exists
    const usersQuery = "SELECT TOP 1 User_Name FROM Users";
    const usersResult = await executeQuery(usersQuery);
    console.log("✅ Users table query successful:", usersResult);

    console.log("🎉 All database tests passed!");

  } catch (error) {
    console.error("❌ Database test failed:", error);
    console.error("Error details:", error.message);
  }
}

testDatabase();

