const express = require("express");
const { executeQuery } = require("../config/database");
const router = express.Router();

// Get all captains (based on Document.txt CAPTAN_TB requirement)
router.get("/", async (req, res) => {
  try {
    // Query based on Document.txt - CAPTAN_TB table
    const query = `
      SELECT *
      FROM CAPTAN_TB 
      ORDER BY CAPTAN_NAME
    `;

    const captains = await executeQuery(query);

    const formattedCaptains = captains.map((captain) => ({
      id: captain.CAPTAN_NO,
      name: captain.CAPTAN_NAME,
      captainNumber: captain.CAPTAN_NO,
    }));

    res.json({
      success: true,
      captains: formattedCaptains,
      total: formattedCaptains.length,
    });
  } catch (error) {
    console.error("Error fetching captains:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch captains",
      error: error.message,
    });
  }
});

router.post("/checkcaptain", async (req, res) => {
  try {
    // Query based on Document.txt - CAPTAN_TB table
    const { captainName, password } = req.body;
     const query = `
      SELECT *
        FROM CAPTAN_TB 
        WHERE CAPTAN_NAME = ? AND PASSWORD = ?
    `;

    const captains = await executeQuery(query, [captainName, password]);
    if (captains.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Captain not found",
      });
    }
    res.json({
      success: true,
      captain: captains[0],
    });
  } catch (error) {
    console.error("Error fetching captains:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch captains",
      error: error.message,
    });
  }
});
// Get specific captain by number
router.get("/:captainNo", async (req, res) => {
  try {
    const { captainNo } = req.params;

    const query = `
      SELECT CAPTAN_NO, CAPTAN_NAME 
      FROM CAPTAN_TB 
      WHERE CAPTAN_NO = ?
    `;

    const captains = await executeQuery(query, [captainNo]);

    if (captains.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Captain not found",
      });
    }

    const captain = captains[0];

    res.json({
      success: true,
      captain: {
        id: captain.CAPTAN_NO,
        name: captain.CAPTAN_NAME,
        captainNumber: captain.CAPTAN_NO,
      },
    });
  } catch (error) {
    console.error("Error fetching captain:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch captain",
      error: error.message,
    });
  }
});

module.exports = router;
