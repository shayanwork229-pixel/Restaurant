const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');

// GET approved reviews (Public)
router.get('/', (req, res) => {
  try {
    const reviews = db.prepare(`
      SELECT r.*, u.avatar 
      FROM reviews r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.is_approved = 1
      ORDER BY r.created_at DESC
    `).all();

    return res.json({ success: true, count: reviews.length, reviews });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
  }
});

// POST submit review
router.post('/', verifyToken, (req, res) => {
  try {
    const { customer_name, rating, comment } = req.body;

    if (!rating || !comment) {
      return res.status(400).json({ success: false, message: 'Rating and comment are required.' });
    }

    const id = 'rev_' + uuidv4().slice(0, 8);
    const userId = req.user ? req.user.id : null;
    const authorName = (req.user && req.user.name) ? req.user.name : (customer_name || 'VIP Patron');

    db.prepare(`
      INSERT INTO reviews (id, user_id, customer_name, rating, comment, is_approved)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, userId, authorName.trim(), Math.min(5, Math.max(1, parseInt(rating))), comment.trim());

    const created = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
    return res.status(201).json({ success: true, message: 'Thank you for your valuable review!', review: created });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to post review.' });
  }
});

// GET all reviews (Admin)
router.get('/all', requireAdmin, (req, res) => {
  try {
    const reviews = db.prepare(`
      SELECT r.*, u.email 
      FROM reviews r
      LEFT JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
    `).all();

    return res.json({ success: true, count: reviews.length, reviews });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
  }
});

// TOGGLE approve / hide review (Admin)
router.put('/:id/approve', requireAdmin, (req, res) => {
  try {
    const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found.' });
    }

    const newStatus = review.is_approved ? 0 : 1;
    db.prepare('UPDATE reviews SET is_approved = ? WHERE id = ?').run(newStatus, req.params.id);

    return res.json({ success: true, message: `Review ${newStatus ? 'approved' : 'hidden'}.`, is_approved: newStatus });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update review status.' });
  }
});

// DELETE review (Admin)
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
    return res.json({ success: true, message: 'Review deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete review.' });
  }
});

module.exports = router;
