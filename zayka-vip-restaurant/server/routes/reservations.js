const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAuth, requireAdmin } = require('../middleware/auth');

// 1. BOOK A TABLE
router.post('/', verifyToken, (req, res) => {
  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      guests_count,
      reservation_date,
      reservation_time,
      seating_area,
      special_requests
    } = req.body;

    if (!customer_name || !customer_phone || !reservation_date || !reservation_time || !guests_count) {
      return res.status(400).json({ success: false, message: 'Name, phone, date, time, and number of guests are required.' });
    }

    const reservationCode = 'RES-' + Math.floor(1000 + Math.random() * 9000);
    const id = 'res_' + uuidv4().slice(0, 8);
    const userId = req.user ? req.user.id : null;

    db.prepare(`
      INSERT INTO reservations (
        id, reservation_code, user_id, customer_name, customer_email,
        customer_phone, guests_count, reservation_date, reservation_time,
        seating_area, special_requests, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      id,
      reservationCode,
      userId,
      customer_name.trim(),
      (customer_email || '').trim().toLowerCase(),
      customer_phone.trim(),
      parseInt(guests_count),
      reservation_date,
      reservation_time,
      seating_area || 'Standard Dining',
      special_requests || ''
    );

    const created = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

    return res.status(201).json({
      success: true,
      message: `Table reservation request received! Your VIP booking code is ${reservationCode}.`,
      reservation: created
    });
  } catch (error) {
    console.error('Reservation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to submit reservation.' });
  }
});

// 2. MY RESERVATIONS (Customer)
router.get('/my', requireAuth, (req, res) => {
  try {
    const reservations = db.prepare(`
      SELECT * FROM reservations 
      WHERE user_id = ? 
      ORDER BY reservation_date DESC, reservation_time DESC
    `).all(req.user.id);

    return res.json({ success: true, count: reservations.length, reservations });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch reservations.' });
  }
});

// 3. ALL RESERVATIONS (Admin)
router.get('/all', requireAdmin, (req, res) => {
  try {
    const { status, date } = req.query;
    let query = 'SELECT * FROM reservations WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    if (date) {
      query += ' AND reservation_date = ?';
      params.push(date);
    }

    query += ' ORDER BY reservation_date ASC, reservation_time ASC';

    const reservations = db.prepare(query).all(...params);
    return res.json({ success: true, count: reservations.length, reservations });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch reservations.' });
  }
});

// 4. UPDATE RESERVATION STATUS (Admin)
router.put('/:id/status', requireAdmin, (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'cancelled', 'completed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid reservation status.' });
    }

    db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(status, req.params.id);
    const updated = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);

    return res.json({ success: true, message: `Reservation status updated to ${status}.`, reservation: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update reservation.' });
  }
});

module.exports = router;
