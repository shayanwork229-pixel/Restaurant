const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

// GET all settings (Public)
router.get('/', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    return res.json({ success: true, settings });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch settings.' });
  }
});

// UPDATE settings (Admin)
router.put('/', requireAdmin, (req, res) => {
  try {
    const settings = req.body; // { restaurant_name, tagline, phone, ... }
    const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    for (const [key, value] of Object.entries(settings)) {
      setSetting.run(key, String(value));
    }

    const rows = db.prepare('SELECT * FROM settings').all();
    const updated = {};
    for (const r of rows) {
      updated[r.key] = r.value;
    }

    return res.json({ success: true, message: 'Settings saved successfully.', settings: updated });
  } catch (error) {
    console.error('Update settings error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update settings.' });
  }
});

// GET Admin Dashboard Analytics
router.get('/analytics', requireAdmin, (req, res) => {
  try {
    const totalOrders = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
    
    // Today's orders
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE created_at LIKE ?").get(`${today}%`).count;
    
    // Revenue
    const revenueRow = db.prepare("SELECT SUM(total_amount) AS revenue FROM orders WHERE status != 'cancelled'").get();
    const totalRevenue = revenueRow && revenueRow.revenue ? revenueRow.revenue : 0;

    const pendingOrders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status IN ('pending', 'confirmed', 'preparing')").get().count;
    const completedOrders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'delivered'").get().count;
    const totalReservations = db.prepare('SELECT COUNT(*) AS count FROM reservations').get().count;
    const pendingReservations = db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE status = 'pending'").get().count;
    const totalProducts = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
    const totalCustomers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'customer'").get().count;
    const activeDeals = db.prepare('SELECT COUNT(*) AS count FROM deals WHERE is_active = 1').get().count;

    // Recent 5 orders
    const recentOrders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5').all();

    // Top selling products based on order items
    const topProducts = db.prepare(`
      SELECT product_name, SUM(quantity) AS total_sold, SUM(price * quantity) AS total_sales
      FROM order_items
      GROUP BY product_name
      ORDER BY total_sold DESC
      LIMIT 5
    `).all();

    return res.json({
      success: true,
      metrics: {
        totalOrders,
        todayOrders,
        totalRevenue,
        pendingOrders,
        completedOrders,
        totalReservations,
        pendingReservations,
        totalProducts,
        totalCustomers,
        activeDeals
      },
      recentOrders,
      topProducts
    });
  } catch (error) {
    console.error('Analytics error:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate analytics.' });
  }
});

// GET Admin Customer Accounts List
router.get('/customers', requireAdmin, (req, res) => {
  try {
    const customers = db.prepare(`
      SELECT u.id, u.name, u.email, u.phone, u.provider, u.address, u.created_at,
             COUNT(o.id) AS total_orders,
             COALESCE(SUM(o.total_amount), 0) AS total_spent
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id AND o.status != 'cancelled'
      WHERE u.role = 'customer'
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all();

    return res.json({ success: true, count: customers.length, customers });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch customer list.' });
  }
});

module.exports = router;
