const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

// GET all products with filtering & category join
router.get('/', (req, res) => {
  try {
    const { category, search, dessert, special, available } = req.query;

    let query = `
      SELECT p.*, c.name AS category_name, c.slug AS category_slug 
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      query += ` AND (c.slug = ? OR c.id = ?)`;
      params.push(category, category);
    }

    if (dessert === '1') {
      query += ` AND p.is_dessert = 1`;
    }

    if (special === '1') {
      query += ` AND p.is_special = 1`;
    }

    if (available === '1') {
      query += ` AND p.is_available = 1`;
    }

    if (search) {
      query += ` AND (LOWER(p.name) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(p.tags) LIKE ?)`;
      const term = `%${search.trim().toLowerCase()}%`;
      params.push(term, term, term);
    }

    query += ` ORDER BY p.is_special DESC, p.created_at DESC`;

    const products = db.prepare(query).all(...params);
    return res.json({ success: true, count: products.length, products });
  } catch (error) {
    console.error('Error fetching products:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch products.' });
  }
});

// GET single product
router.get('/:id', (req, res) => {
  try {
    const product = db.prepare(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug 
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    return res.json({ success: true, product });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch product.' });
  }
});

// POST create product (Admin)
router.post('/', requireAdmin, (req, res) => {
  try {
    const { name, description, price, discount_price, category_id, image, is_available, is_special, is_dessert, spicy_level, tags } = req.body;

    if (!name || !price || !category_id) {
      return res.status(400).json({ success: false, message: 'Name, price, and category are required.' });
    }

    const id = 'prod_' + uuidv4().slice(0, 8);
    db.prepare(`
      INSERT INTO products (id, name, description, price, discount_price, category_id, image, is_available, is_special, is_dessert, spicy_level, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      description || '',
      parseFloat(price),
      discount_price ? parseFloat(discount_price) : null,
      category_id,
      image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800',
      is_available !== undefined ? (is_available ? 1 : 0) : 1,
      is_special ? 1 : 0,
      is_dessert ? 1 : 0,
      spicy_level ? parseInt(spicy_level) : 0,
      tags || ''
    );

    const created = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    return res.status(201).json({ success: true, message: 'Product created successfully.', product: created });
  } catch (error) {
    console.error('Create product error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create product.' });
  }
});

// PUT update product (Admin)
router.put('/:id', requireAdmin, (req, res) => {
  try {
    const { name, description, price, discount_price, category_id, image, is_available, is_special, is_dessert, spicy_level, tags } = req.body;

    const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    db.prepare(`
      UPDATE products 
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          price = COALESCE(?, price),
          discount_price = ?,
          category_id = COALESCE(?, category_id),
          image = COALESCE(?, image),
          is_available = COALESCE(?, is_available),
          is_special = COALESCE(?, is_special),
          is_dessert = COALESCE(?, is_dessert),
          spicy_level = COALESCE(?, spicy_level),
          tags = COALESCE(?, tags)
      WHERE id = ?
    `).run(
      name,
      description,
      price !== undefined ? parseFloat(price) : null,
      discount_price !== undefined ? (discount_price ? parseFloat(discount_price) : null) : undefined,
      category_id,
      image,
      is_available !== undefined ? (is_available ? 1 : 0) : null,
      is_special !== undefined ? (is_special ? 1 : 0) : null,
      is_dessert !== undefined ? (is_dessert ? 1 : 0) : null,
      spicy_level !== undefined ? parseInt(spicy_level) : null,
      tags,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    return res.json({ success: true, message: 'Product updated successfully.', product: updated });
  } catch (error) {
    console.error('Update product error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update product.' });
  }
});

// DELETE product (Admin)
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    return res.json({ success: true, message: 'Product deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete product.' });
  }
});

module.exports = router;
