const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

// GET all categories
router.get('/', (req, res) => {
  try {
    const categories = db.prepare(`
      SELECT c.*, COUNT(p.id) AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.sort_order ASC
    `).all();
    return res.json({ success: true, categories });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch categories.' });
  }
});

// POST category (Admin)
router.post('/', requireAdmin, (req, res) => {
  try {
    const { name, slug, icon, sort_order } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }

    const cleanSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const id = 'cat_' + uuidv4().slice(0, 8);

    db.prepare(`
      INSERT INTO categories (id, name, slug, icon, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, cleanSlug, icon || 'Utensils', sort_order || 0);

    const created = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    return res.status(201).json({ success: true, message: 'Category created.', category: created });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to create category.' });
  }
});

// PUT category (Admin)
router.put('/:id', requireAdmin, (req, res) => {
  try {
    const { name, slug, icon, sort_order } = req.body;
    db.prepare(`
      UPDATE categories
      SET name = COALESCE(?, name),
          slug = COALESCE(?, slug),
          icon = COALESCE(?, icon),
          sort_order = COALESCE(?, sort_order)
      WHERE id = ?
    `).run(name, slug, icon, sort_order, req.params.id);

    const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    return res.json({ success: true, message: 'Category updated.', category: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update category.' });
  }
});

// DELETE category (Admin)
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    return res.json({ success: true, message: 'Category deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete category.' });
  }
});

module.exports = router;
