const express = require("express");
const { executeQuery } = require("../config/database");
const router = express.Router();

// Get all areas/halls
router.get("/", async (req, res) => {
  try {
    // Query to get all halls/areas from HALLS table
    const query = `
      SELECT HALL_NO, HALL_NAME 
      FROM HALLS 
      ORDER BY HALL_NO
    `;

    const areas = await executeQuery(query);

    // Map to more user-friendly names
    const areaNames = {
      1: "Youth Lounge",
      2: "Indoor",
      3: "Terrace Garden",
      4: "All Areas",
    };

    const formattedAreas = areas.map((area) => ({
      id: area.HALL_NO,
      name: areaNames[area.HALL_NO] || area.HALL_NAME || `Area ${area.HALL_NO}`,
      originalName: area.HALL_NAME,
    }));

    res.json({
      success: true,
      areas: formattedAreas,
    });
  } catch (error) {
    console.error("Error fetching areas:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch areas",
      error: error.message,
    });
  }
});

// Get specific area by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT HALL_NO, HALL_NAME 
      FROM HALLS 
      WHERE HALL_NO = ?
    `;

    const areas = await executeQuery(query, [id]);

    if (areas.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Area not found",
      });
    }

    const area = areas[0];
    const areaNames = {
      1: "Youth Lounge",
      2: "Indoor",
      3: "Terrace Garden",
      4: "All Areas",
    };

    res.json({
      success: true,
      area: {
        id: area.HALL_NO,
        name:
          areaNames[area.HALL_NO] || area.HALL_NAME || `Area ${area.HALL_NO}`,
        originalName: area.HALL_NAME,
      },
    });
  } catch (error) {
    console.error("Error fetching area:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch area",
      error: error.message,
    });
  }
});

// Get area statistics (number of tables, availability, etc.)
router.get("/:id/stats", async (req, res) => {
  try {
    const { id } = req.params;

    // Get total tables in this area
    const tablesQuery = `
      SELECT COUNT(*) as totalTables
      FROM FOOD_HALLS 
      WHERE seq = ?
    `;

    // Get available tables (not currently booked)
    // Using the correct columns from your INVOICE table schema
    const availableQuery = `
      SELECT COUNT(*) as availableTables
      FROM FOOD_HALLS fh
      LEFT JOIN INVOICE inv ON fh.FOOD_TABLE_NO = inv.INV_FT_NO 
        AND inv.PAID = 0
        AND GETDATE() BETWEEN inv.INV_DATE AND DATEADD(day, 1, inv.INV_DATE)
      WHERE fh.seq = ? AND inv.inv_seq IS NULL
    `;

    const [totalResult, availableResult] = await Promise.all([
      executeQuery(tablesQuery, [id]),
      executeQuery(availableQuery, [id]),
    ]);

    const totalTables = totalResult[0]?.totalTables || 0;
    const availableTables = availableResult[0]?.availableTables || 0;
    const reservedTables = totalTables - availableTables;

    res.json({
      success: true,
      stats: {
        totalTables,
        availableTables,
        reservedTables,
        availabilityPercentage:
          totalTables > 0
            ? Math.round((availableTables / totalTables) * 100)
            : 0,
      },
    });
  } catch (error) {
    console.error("Error fetching area stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch area statistics",
      error: error.message,
    });
  }
});

module.exports = router;
