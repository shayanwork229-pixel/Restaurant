const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');

// Helper to generate JWT
function generateToken(user, rememberMe = false) {
  const expiresIn = rememberMe ? '30d' : '24h';
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn }
  );
}

// 1. REGISTER
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, confirmPassword } = req.body;

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    // Check existing email
    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (existingEmail) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Check existing phone
    const existingPhone = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone.trim());
    if (existingPhone) {
      return res.status(400).json({ success: false, message: 'An account with this phone number already exists.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const userId = 'usr_' + uuidv4().slice(0, 8);

    db.prepare(`
      INSERT INTO users (id, name, email, phone, password_hash, role, provider)
      VALUES (?, ?, ?, ?, ?, 'customer', 'local')
    `).run(userId, name.trim(), email.trim().toLowerCase(), phone.trim(), passwordHash);

    const newUser = db.prepare('SELECT id, name, email, phone, role, avatar, address, created_at FROM users WHERE id = ?').get(userId);
    const token = generateToken(newUser, false);

    return res.status(201).json({
      success: true,
      message: 'Account registered successfully! Welcome to ZAYKA VIP.',
      token,
      user: newUser
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// 2. LOGIN (Email OR Phone)
router.post('/login', async (req, res) => {
  try {
    const { identifier, password, rememberMe } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Email/Phone and password are required.' });
    }

    const cleanIdentifier = identifier.trim();

    // Query by either email or phone
    const user = db.prepare(`
      SELECT * FROM users 
      WHERE LOWER(email) = LOWER(?) OR phone = ?
    `).get(cleanIdentifier, cleanIdentifier);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email/phone or password.' });
    }

    if (!user.password_hash) {
      return res.status(401).json({
        success: false,
        message: 'This account was created via Google Login. Please use Google Login.'
      });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email/phone or password.' });
    }

    const token = generateToken(user, rememberMe);

    // Exclude password_hash
    const { password_hash, ...safeUser } = user;

    return res.json({
      success: true,
      message: 'Login successful. Welcome back!',
      token,
      user: safeUser
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

// 3. GOOGLE LOGIN (Functional OAuth Handler + Instant Test Mode)
router.post('/google', async (req, res) => {
  try {
    const { email, name, avatar, googleId } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Google account email is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    let user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);

    if (!user) {
      // Create new Google customer user
      const userId = 'usr_g_' + uuidv4().slice(0, 8);
      const userName = name || cleanEmail.split('@')[0];
      const userAvatar = avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150';

      db.prepare(`
        INSERT INTO users (id, name, email, phone, role, provider, avatar)
        VALUES (?, ?, ?, ?, 'customer', 'google', ?)
      `).run(userId, userName, cleanEmail, '', userAvatar);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } else {
      // Update avatar if not present
      if (!user.avatar && avatar) {
        db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, user.id);
        user.avatar = avatar;
      }
    }

    const token = generateToken(user, true);
    const { password_hash, ...safeUser } = user;

    return res.json({
      success: true,
      message: `Signed in with Google as ${safeUser.name}`,
      token,
      user: safeUser
    });
  } catch (error) {
    console.error('Google login error:', error);
    return res.status(500).json({ success: false, message: 'Google login failed.' });
  }
});

// 4. FORGOT PASSWORD (Generate Secure Token)
router.post('/forgot-password', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Please provide your registered email or phone.' });
    }

    const clean = identifier.trim();
    const user = db.prepare(`
      SELECT id, name, email, phone FROM users 
      WHERE LOWER(email) = LOWER(?) OR phone = ?
    `).get(clean, clean);

    if (!user) {
      // For security, don't leak user enumeration in production, but here give clear guidance
      return res.status(404).json({
        success: false,
        message: 'No registered account found with that email or phone number.'
      });
    }

    // Invalidate previous tokens
    db.prepare('UPDATE password_resets SET used = 1 WHERE email_or_phone = ?').run(clean);

    // Generate 6-digit verification code or secure crypto hex token
    const token = crypto.randomBytes(20).toString('hex');
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit friendly OTP
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour expiry

    db.prepare(`
      INSERT INTO password_resets (id, email_or_phone, token, expires_at, used)
      VALUES (?, ?, ?, ?, 0)
    `).run(uuidv4(), clean, token, expiresAt);

    // Also store the friendly code
    db.prepare(`
      INSERT INTO password_resets (id, email_or_phone, token, expires_at, used)
      VALUES (?, ?, ?, ?, 0)
    `).run(uuidv4(), clean, resetCode, expiresAt);

    return res.json({
      success: true,
      message: `Password reset instructions and security token generated for ${user.email || user.phone}.`,
      token: token,
      resetCode: resetCode,
      targetUser: {
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ success: false, message: 'Server error during password reset request.' });
  }
});

// 5. RESET PASSWORD
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'Reset token and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const resetRecord = db.prepare(`
      SELECT * FROM password_resets 
      WHERE token = ? AND used = 0
    `).get(token.trim());

    if (!resetRecord) {
      return res.status(400).json({ success: false, message: 'Invalid or already used reset token.' });
    }

    if (Date.now() > resetRecord.expires_at) {
      return res.status(400).json({ success: false, message: 'This reset token has expired. Please request a new one.' });
    }

    // Hash new password
    const newHash = bcrypt.hashSync(newPassword, 10);

    // Update user password
    db.prepare(`
      UPDATE users 
      SET password_hash = ? 
      WHERE LOWER(email) = LOWER(?) OR phone = ?
    `).run(newHash, resetRecord.email_or_phone, resetRecord.email_or_phone);

    // Mark token as used
    db.prepare('UPDATE password_resets SET used = 1 WHERE email_or_phone = ?').run(resetRecord.email_or_phone);

    return res.json({
      success: true,
      message: 'Your password has been reset successfully! You can now log in with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ success: false, message: 'Server error resetting password.' });
  }
});

// 6. GET CURRENT USER PROFILE
router.get('/me', requireAuth, (req, res) => {
  try {
    const user = db.prepare('SELECT id, name, email, phone, role, provider, avatar, address, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error retrieving profile.' });
  }
});

// 7. UPDATE PROFILE
router.put('/profile', requireAuth, (req, res) => {
  try {
    const { name, phone, address, avatar } = req.body;
    db.prepare(`
      UPDATE users 
      SET name = COALESCE(?, name),
          phone = COALESCE(?, phone),
          address = COALESCE(?, address),
          avatar = COALESCE(?, avatar)
      WHERE id = ?
    `).run(name, phone, address, avatar, req.user.id);

    const updatedUser = db.prepare('SELECT id, name, email, phone, role, provider, avatar, address, created_at FROM users WHERE id = ?').get(req.user.id);
    return res.json({ success: true, message: 'Profile updated successfully.', user: updatedUser });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

// 8. CHANGE PASSWORD
router.put('/change-password', requireAuth, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both current and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
    }

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!user || !user.password_hash) {
      return res.status(400).json({ success: false, message: 'Account has no local password.' });
    }

    const isMatch = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);

    return res.json({ success: true, message: 'Password changed successfully!' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ success: false, message: 'Failed to change password.' });
  }
});

module.exports = router;
