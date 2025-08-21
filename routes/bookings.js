const express = require('express');
const { executeQuery } = require('../config/database');
const router = express.Router();

// Get all current bookings
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT 
        inv.inv_seq,
        inv.INV_FT_NO,
        inv.from_date,
        inv.to_date,
        inv.ROOM_RESERVE,
        inv.CUSTOMER_NAME,
        inv.INV_NOTE,
        inv.INV_DATE,
        inv.COST,
        fh.seq as areaId,
        h.HALL_NAME
      FROM INVOICE inv
      JOIN FOOD_HALLS fh ON inv.INV_FT_NO = fh.FOOD_TABLE_NO
      JOIN HALLS h ON fh.seq = h.HALL_NO
      WHERE inv.ROOM_RESERVE = 1 
        AND inv.INV_FT_NO IS NOT NULL
        AND GETDATE() BETWEEN inv.from_date AND inv.to_date
      ORDER BY inv.from_date DESC
    `;

    const bookings = await executeQuery(query);

    const formattedBookings = bookings.map(booking => ({
      id: booking.inv_seq,
      tableNumber: booking.INV_FT_NO,
      areaId: booking.areaId,
      areaName: booking.HALL_NAME,
      fromDate: booking.from_date,
      toDate: booking.to_date,
      customerName: booking.CUSTOMER_NAME,
      note: booking.INV_NOTE,
      bookingDate: booking.INV_DATE,
      cost: booking.COST,
      status: 'active'
    }));

    res.json({
      success: true,
      bookings: formattedBookings,
      total: formattedBookings.length
    });

  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
      error: error.message
    });
  }
});

// Create a new booking
router.post('/', async (req, res) => {
  try {
    const { 
      tableNumber, 
      fromDate, 
      toDate, 
      customerName, 
      note, 
      cost = 0 
    } = req.body;

    if (!tableNumber || !fromDate || !toDate || !customerName) {
      return res.status(400).json({
        success: false,
        message: 'Table number, from date, to date, and customer name are required'
      });
    }

    // Check if table is available for the requested dates
    const availabilityQuery = `
      SELECT COUNT(*) as conflictCount
      FROM INVOICE inv
      WHERE inv.INV_FT_NO = ? 
        AND inv.ROOM_RESERVE = 1
        AND (
          (inv.from_date <= ? AND inv.to_date >= ?) OR
          (inv.from_date <= ? AND inv.to_date >= ?) OR
          (inv.from_date >= ? AND inv.to_date <= ?)
        )
    `;

    const conflicts = await executeQuery(availabilityQuery, [
      tableNumber, 
      toDate, fromDate, 
      toDate, fromDate, 
      fromDate, toDate
    ]);

    if (conflicts[0].conflictCount > 0) {
      return res.status(409).json({
        success: false,
        message: 'Table is not available for the requested dates'
      });
    }

    // Create the booking (insert into INVOICE table)
    const insertQuery = `
      INSERT INTO INVOICE (
        INV_FT_NO, 
        from_date, 
        to_date, 
        ROOM_RESERVE, 
        CUSTOMER_NAME, 
        INV_NOTE, 
        INV_DATE, 
        COST,
        ROOM_RESERVE
      ) VALUES (?, ?, ?, 1, ?, ?, GETDATE(), ?, 1)
    `;

    const result = await executeQuery(insertQuery, [
      tableNumber, 
      fromDate, 
      toDate, 
      customerName, 
      note || '', 
      cost
    ]);

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      booking: {
        tableNumber,
        fromDate,
        toDate,
        customerName,
        note,
        cost,
        status: 'confirmed'
      }
    });

  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking',
      error: error.message
    });
  }
});

// Update a booking
router.put('/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { 
      fromDate, 
      toDate, 
      customerName, 
      note, 
      cost 
    } = req.body;

    // Check if booking exists
    const existingQuery = `
      SELECT INV_FT_NO, from_date, to_date
      FROM INVOICE 
      WHERE inv_seq = ? AND ROOM_RESERVE = 1
    `;

    const existing = await executeQuery(existingQuery, [bookingId]);

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = existing[0];

    // Check for conflicts if dates are being changed
    if (fromDate || toDate) {
      const newFromDate = fromDate || booking.from_date;
      const newToDate = toDate || booking.to_date;

      const conflictQuery = `
        SELECT COUNT(*) as conflictCount
        FROM INVOICE inv
        WHERE inv.INV_FT_NO = ? 
          AND inv.ROOM_RESERVE = 1
          AND inv.inv_seq != ?
          AND (
            (inv.from_date <= ? AND inv.to_date >= ?) OR
            (inv.from_date <= ? AND inv.to_date >= ?) OR
            (inv.from_date >= ? AND inv.to_date <= ?)
          )
      `;

      const conflicts = await executeQuery(conflictQuery, [
        booking.INV_FT_NO,
        bookingId,
        newToDate, newFromDate,
        newToDate, newFromDate,
        newFromDate, newToDate
      ]);

      if (conflicts[0].conflictCount > 0) {
        return res.status(409).json({
          success: false,
          message: 'Table is not available for the requested dates'
        });
      }
    }

    // Update the booking
    const updateQuery = `
      UPDATE INVOICE 
      SET 
        from_date = COALESCE(?, from_date),
        to_date = COALESCE(?, to_date),
        CUSTOMER_NAME = COALESCE(?, CUSTOMER_NAME),
        INV_NOTE = COALESCE(?, INV_NOTE),
        COST = COALESCE(?, COST)
      WHERE inv_seq = ?
    `;

    await executeQuery(updateQuery, [
      fromDate, 
      toDate, 
      customerName, 
      note, 
      cost, 
      bookingId
    ]);

    res.json({
      success: true,
      message: 'Booking updated successfully'
    });

  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking',
      error: error.message
    });
  }
});

// Cancel a booking
router.delete('/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;

    // Check if booking exists
    const existingQuery = `
      SELECT INV_FT_NO 
      FROM INVOICE 
      WHERE inv_seq = ? AND ROOM_RESERVE = 1
    `;

    const existing = await executeQuery(existingQuery, [bookingId]);

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Cancel the booking (set ROOM_RESERVE to 0)
    const cancelQuery = `
      UPDATE INVOICE 
      SET ROOM_RESERVE = 0
      WHERE inv_seq = ?
    `;

    await executeQuery(cancelQuery, [bookingId]);

    res.json({
      success: true,
      message: 'Booking cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking',
      error: error.message
    });
  }
});

// Get booking history for a specific table
router.get('/table/:tableNumber', async (req, res) => {
  try {
    const { tableNumber } = req.params;

    const query = `
      SELECT 
        inv.inv_seq,
        inv.from_date,
        inv.to_date,
        inv.CUSTOMER_NAME,
        inv.INV_NOTE,
        inv.INV_DATE,
        inv.COST,
        inv.ROOM_RESERVE
      FROM INVOICE inv
      WHERE inv.INV_FT_NO = ?
      ORDER BY inv.from_date DESC
    `;

    const bookings = await executeQuery(query, [tableNumber]);

    const formattedBookings = bookings.map(booking => ({
      id: booking.inv_seq,
      fromDate: booking.from_date,
      toDate: booking.to_date,
      customerName: booking.CUSTOMER_NAME,
      note: booking.INV_NOTE,
      bookingDate: booking.INV_DATE,
      cost: booking.COST,
      status: booking.ROOM_RESERVE === 1 ? 'active' : 'cancelled'
    }));

    res.json({
      success: true,
      tableNumber,
      bookings: formattedBookings,
      total: formattedBookings.length
    });

  } catch (error) {
    console.error('Error fetching table booking history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch table booking history',
      error: error.message
    });
  }
});

module.exports = router;
