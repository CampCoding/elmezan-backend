const express = require('express');
const { executeQuery } = require('../config/database');
const router = express.Router();

// Get all users for login selection (based on Document.txt requirements)
router.get('/login-options', async (req, res) => {
  try {
    // Query based on Document.txt - Open_ProgramQ view with specific conditions
    const query = `
      SELECT User_Name, Admin, auto_no 
      FROM Open_ProgramQ 
      WHERE (auto_no = 5) OR (auto_no = 6)
      ORDER BY User_Name
    `;

    const users = await executeQuery(query);

    const formattedUsers = users.map(user => ({
      id: user.auto_no,
      username: user.User_Name,
      admin: user.Admin === 1,
      isAdmin: user.Admin === 2,
      displayName: user.User_Name
    }));

    res.json({
      success: true,
      users: formattedUsers,
      total: formattedUsers.length
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

// Get users with admin privileges (based on Document2.txt requirements)
router.get('/admin-users', async (req, res) => {
  try {
    // Query based on Document2.txt - more restrictive admin check
    const query = `
      SELECT User_Name, Admin, auto_no 
      FROM Open_ProgramQ 
      WHERE ((auto_no = 5) AND (Admin = 2)) OR ((auto_no = 6) AND (Admin = 2))
      ORDER BY User_Name
    `;

    const users = await executeQuery(query);

    const formattedUsers = users.map(user => ({
      id: user.auto_no,
      username: user.User_Name,
      admin: user.Admin === 1,
      isAdmin: user.Admin === 2,
      displayName: user.User_Name
    }));

    res.json({
      success: true,
      users: formattedUsers,
      total: formattedUsers.length
    });

  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin users',
      error: error.message
    });
  }
});

// Get all users (for admin purposes)
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT 
        u.User_Name,
        u.Admin,
        u.auto_no,
        u.SPEC,
        u.CHE
      FROM Users u
      ORDER BY u.User_Name
    `;

    const users = await executeQuery(query);

    const formattedUsers = users.map(user => ({
      id: user.auto_no,
      username: user.User_Name,
      admin: user.Admin === 1,
      isAdmin: user.Admin === 2,
      special: user.SPEC === 1,
      check: user.CHE === '1',
      displayName: user.User_Name
    }));

    res.json({
      success: true,
      users: formattedUsers,
      total: formattedUsers.length
    });

  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

// Get specific user by ID
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const query = `
      SELECT 
        u.User_Name,
        u.Admin,
        u.auto_no,
        u.SPEC,
        u.CHE
      FROM Users u
      WHERE u.auto_no = ?
    `;

    const users = await executeQuery(query, [userId]);

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
        isAdmin: user.Admin === 2,
        special: user.SPEC === 1,
        check: user.CHE === '1',
        displayName: user.User_Name
      }
    });

  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user',
      error: error.message
    });
  }
});

module.exports = router;
