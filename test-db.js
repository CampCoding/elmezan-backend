const { connectDB, executeQuery } = require("./config/database");
require("dotenv").config({ path: "./config.env" });

async function testDatabase() {
  try {
    
    
    
    
    

    // Test connection
    const pool = await connectDB();
    

    // Test simple query
    const testQuery = "SELECT 1 as test";
    const result = await executeQuery(testQuery);
    

    // Test parameterized query
    const paramQuery = "SELECT ? as param1, ? as param2";
    const paramResult = await executeQuery(paramQuery, ["hello", "world"]);
    

    // Test if Users table exists
    const usersQuery = "SELECT TOP 1 User_Name FROM Users";
    const usersResult = await executeQuery(usersQuery);
    

    

  } catch (error) {
    console.error("❌ Database test failed:", error);
    console.error("Error details:", error.message);
  }
}

testDatabase();

