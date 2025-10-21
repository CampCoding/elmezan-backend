const express = require('express');
const bcrypt = require('bcryptjs');
const { executeQuery } = require('../config/database');
const router = express.Router();

// User login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    // Query to get user from Open_ProgramQ view (as mentioned in Document.txt)
    const query = `
      SELECT User_Name, Admin, auto_no 
      FROM Open_ProgramQ 
      WHERE User_Name = ? AND (auto_no = 5 OR auto_no = 6)
    `;

    const users = await executeQuery(query, [username]);

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const user = users[0];

    // For now, we'll do a simple password check
    // In production, you should hash passwords and compare hashes
    // This is a simplified version based on your schema
    const passwordQuery = `
      SELECT Password FROM Users WHERE User_Name = ?
    `;
    
    const passwordResult = await executeQuery(passwordQuery, [username]);
    
    if (passwordResult.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const storedPassword = passwordResult[0].Password;
    
    // Simple password comparison (in production, use bcrypt.compare)
    if (password !== storedPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Return user info directly (no session storage)
    
    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.auto_no,
        username: user.User_Name,
        admin: user.Admin === 1,
        isAdmin: user.Admin === 2
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    }); 
  }
});

// User logout (for API consistency, but no session to destroy)
router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: 'Logout successful (no active session)'
  });
});

// Check if user credentials are valid (for offline validation)
router.post('/check', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    // Verify credentials against database
    const passwordQuery = `
      SELECT Password FROM Users WHERE User_Name = ?
    `;
    
    const passwordResult = await executeQuery(passwordQuery, [username]);
    
    if (passwordResult.length === 0) {
      return res.json({
        success: true,
        authenticated: false,
        message: 'Invalid credentials'
      });
    }

    const storedPassword = passwordResult[0].Password;
    
    if (password !== storedPassword) {
      return res.json({
        success: true,
        authenticated: false,
        message: 'Invalid credentials'
      });
    }

    // Get user info from Open_ProgramQ
    const userQuery = `
      SELECT User_Name, Admin, auto_no 
      FROM Open_ProgramQ 
      WHERE User_Name = ? AND (auto_no = 5 OR auto_no = 6)
    `;

    const users = await executeQuery(userQuery, [username]);
    
    if (users.length === 0) {
      return res.json({
        success: true,
        authenticated: false,
        message: 'User not found in access list'
      });
    }

    const user = users[0];

    res.json({
      success: true,
      authenticated: true,
      user: {
        id: user.auto_no,
        username: user.User_Name,
        admin: user.Admin === 1,
        isAdmin: user.Admin === 2
      }
    });

  } catch (error) {
    console.error('Authentication check error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication check failed',
      error: error.message
    });
  }
});

// Get current user info (requires credentials in request)
router.post('/me', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    // Verify credentials first
    const passwordQuery = `
      SELECT Password FROM Users WHERE User_Name = ?
    `;
    
    const passwordResult = await executeQuery(passwordQuery, [username]);
    
    if (passwordResult.length === 0 || passwordResult[0].Password !== password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Get user info
    const userQuery = `
      SELECT User_Name, Admin, auto_no 
      FROM Open_ProgramQ 
      WHERE User_Name = ? AND (auto_no = 5 OR auto_no = 6)
    `;

    const users = await executeQuery(userQuery, [username]);
    
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    res.json({
      success: true,
      user: {
        id: user.auto_no,
        username: user.User_Name,
        admin: user.Admin === 1,
        isAdmin: user.Admin === 2
      }
    });

  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user info',
      error: error.message
    });
  }
});

module.exports = router;
