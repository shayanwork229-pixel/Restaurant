const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAuth, requireAdmin } = require('../middleware/auth');

// 1. PLACE ORDER
router.post('/', verifyToken, (req, res) => {
  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      order_type,
      address,
      payment_method,
      items,
      subtotal,
      discount,
      delivery_fee,
      total_amount,
      notes
    } = req.body;

    if (!customer_name || !customer_phone || !items || !items.length) {
      return res.status(400).json({ success: false, message: 'Customer name, phone, and at least one item are required.' });
    }

    if (order_type === 'delivery' && !address) {
      return res.status(400).json({ success: false, message: 'Delivery address is required for delivery orders.' });
    }

    // Generate unique order number e.g. ZYK-49182
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const orderNumber = `ZYK-${randomSuffix}`;
    const orderId = 'ord_' + uuidv4().slice(0, 8);
    const userId = req.user ? req.user.id : null;

    const calcSubtotal = parseFloat(subtotal) || 0;
    const calcDiscount = parseFloat(discount) || 0;
    const calcDeliveryFee = order_type === 'pickup' ? 0 : (parseFloat(delivery_fee) || 0);
    const calcTotal = parseFloat(total_amount) || (calcSubtotal - calcDiscount + calcDeliveryFee);

    // Transaction for atomic order creation
    const insertOrderTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO orders (
          id, order_number, user_id, customer_name, customer_email, customer_phone,
          order_type, address, payment_method, payment_status, subtotal, discount,
          delivery_fee, total_amount, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        orderId,
        orderNumber,
        userId,
        customer_name.trim(),
        (customer_email || '').trim().toLowerCase(),
        customer_phone.trim(),
        order_type || 'delivery',
        address || 'Dine-In / Pickup at Restaurant',
        payment_method || 'cod',
        payment_method === 'card' ? 'paid' : 'pending',
        calcSubtotal,
        calcDiscount,
        calcDeliveryFee,
        calcTotal,
        notes || ''
      );

      const insertItem = db.prepare(`
        INSERT INTO order_items (id, order_id, product_id, product_name, price, quantity, instructions)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        insertItem.run(
          uuidv4(),
          orderId,
          item.product_id || null,
          item.product_name || item.name,
          parseFloat(item.price),
          parseInt(item.quantity) || 1,
          item.instructions || ''
        );
      }
    });

    insertOrderTx();

    const createdOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

    return res.status(201).json({
      success: true,
      message: 'Order placed successfully! Royal chefs are getting ready.',
      order: {
        ...createdOrder,
        items: orderItems
      }
    });
  } catch (error) {
    console.error('Place order error:', error);
    return res.status(500).json({ success: false, message: 'Failed to place order.' });
  }
});

// 2. PUBLIC ORDER TRACKING
router.get('/track/:orderNumber', (req, res) => {
  try {
    const rawNumber = req.params.orderNumber.trim().toUpperCase();
    const order = db.prepare('SELECT * FROM orders WHERE UPPER(order_number) = ? OR id = ?').get(rawNumber, rawNumber);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found. Please check your order number.' });
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

    return res.json({
      success: true,
      order: {
        ...order,
        items
      }
    });
  } catch (error) {
    console.error('Order tracking error:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving order status.' });
  }
});

// 3. MY ORDERS (Customer)
router.get('/my', requireAuth, (req, res) => {
  try {
    const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    
    // Attach items to each order
    const enrichedOrders = orders.map(order => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      return { ...order, items };
    });

    return res.json({ success: true, count: enrichedOrders.length, orders: enrichedOrders });
  } catch (error) {
    console.error('My orders error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve orders.' });
  }
});

// 4. ALL ORDERS (Admin)
router.get('/all', requireAdmin, (req, res) => {
  try {
    const { status, search } = req.query;
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (LOWER(order_number) LIKE ? OR LOWER(customer_name) LIKE ? OR customer_phone LIKE ?)';
      const term = `%${search.trim().toLowerCase()}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY created_at DESC';

    const orders = db.prepare(query).all(...params);

    const enrichedOrders = orders.map(order => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      return { ...order, items };
    });

    return res.json({ success: true, count: enrichedOrders.length, orders: enrichedOrders });
  } catch (error) {
    console.error('Admin orders error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
  }
});

// 5. UPDATE ORDER STATUS (Admin)
router.put('/:id/status', requireAdmin, (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const existing = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Auto update payment_status to 'paid' if delivered
    let paymentStatusUpdate = '';
    if (status === 'delivered') {
      paymentStatusUpdate = ", payment_status = 'paid'";
    }

    db.prepare(`UPDATE orders SET status = ? ${paymentStatusUpdate} WHERE id = ?`).run(status, req.params.id);

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);

    return res.json({
      success: true,
      message: `Order status updated to ${status}.`,
      order: { ...updated, items }
    });
  } catch (error) {
    console.error('Update order status error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update order status.' });
  }
});

module.exports = router;
