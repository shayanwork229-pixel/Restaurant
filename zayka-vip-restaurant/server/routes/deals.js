const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

// GET active deals (Public)
router.get('/', (req, res) => {
  try {
    const deals = db.prepare('SELECT * FROM deals WHERE is_active = 1 ORDER BY deal_price ASC').all();
    return res.json({ success: true, count: deals.length, deals });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch deals.' });
  }
});

// GET all deals (Admin)
router.get('/all', requireAdmin, (req, res) => {
  try {
    const deals = db.prepare('SELECT * FROM deals ORDER BY created_at DESC').all();
    return res.json({ success: true, count: deals.length, deals });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch deals.' });
  }
});

// POST deal (Admin)
router.post('/', requireAdmin, (req, res) => {
  try {
    const { title, description, items_included, original_price, deal_price, image, badge, is_active } = req.body;

    if (!title || !original_price || !deal_price) {
      return res.status(400).json({ success: false, message: 'Title, original price, and deal price are required.' });
    }

    const id = 'deal_' + uuidv4().slice(0, 8);
    db.prepare(`
      INSERT INTO deals (id, title, description, items_included, original_price, deal_price, image, badge, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      description || '',
      items_included || '',
      parseFloat(original_price),
      parseFloat(deal_price),
      image || 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800',
      badge || 'Special Deal',
      is_active !== undefined ? (is_active ? 1 : 0) : 1
    );

    const created = db.prepare('SELECT * FROM deals WHERE id = ?').get(id);
    return res.status(201).json({ success: true, message: 'Deal created successfully.', deal: created });
  } catch (error) {
    console.error('Create deal error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create deal.' });
  }
});

// PUT update deal (Admin)
router.put('/:id', requireAdmin, (req, res) => {
  try {
    const { title, description, items_included, original_price, deal_price, image, badge, is_active } = req.body;

    db.prepare(`
      UPDATE deals
      SET title = COALESCE(?, title),
          description = COALESCE(?, description),
          items_included = COALESCE(?, items_included),
          original_price = COALESCE(?, original_price),
          deal_price = COALESCE(?, deal_price),
          image = COALESCE(?, image),
          badge = COALESCE(?, badge),
          is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      title,
      description,
      items_included,
      original_price !== undefined ? parseFloat(original_price) : null,
      deal_price !== undefined ? parseFloat(deal_price) : null,
      image,
      badge,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
    return res.json({ success: true, message: 'Deal updated successfully.', deal: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update deal.' });
  }
});

// DELETE deal (Admin)
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id);
    return res.json({ success: true, message: 'Deal deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete deal.' });
  }
});

module.exports = router;
