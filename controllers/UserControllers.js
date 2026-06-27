const db = require("../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password, role, latitude, longitude } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: "Email and password are required" });

    const allowedRoles = ["user", "courier"];
    if (role && !allowedRoles.includes(role))
      return res.status(400).json({ message: "Invalid role" });

    const result = await db.query(
      "SELECT id, fullname, phonenumber, email, password, role FROM users WHERE email = $1",
      [email]
    );

    if (!result.rows.length)
      return res.status(401).json({ message: "Invalid email or password" });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid email or password" });

    if (role && user.role !== role) {
      return res.status(403).json({
        message: `This account is not registered as a ${role}. Please select the correct role.`,
      });
    }

    if (user.role === "courier" && latitude != null && longitude != null) {
      await db.query(
        `UPDATE users
         SET latitude = $1, longitude = $2, last_location_update = NOW()
         WHERE id = $3`,
        [latitude, longitude, user.id]
      );
    }

    res.status(200).json({
      message: "Login successful",
      user: {
        id:          user.id,
        fullname:    user.fullname,
        phonenumber: user.phonenumber,
        email:       user.email,
        role:        user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── UPDATE LOGIN LOCATION ─────────────────────────────────────────────────────
exports.updateLoginLocation = async (req, res) => {
  try {
    const { courierId, latitude, longitude } = req.body;

    if (!courierId || latitude == null || longitude == null) {
      return res.status(400).json({
        message: "courierId, latitude and longitude are all required",
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: "Invalid coordinates" });
    }

    const result = await db.query(
      `UPDATE users
       SET latitude = $1, longitude = $2, last_location_update = NOW()
       WHERE id = $3 AND role = 'courier'`,
      [lat, lng, courierId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Courier not found or account is not a courier",
      });
    }

    console.log(`📍 Courier ${courierId} login location updated: ${lat}, ${lng}`);

    res.status(200).json({
      message: "Login location updated successfully",
      courierId,
      latitude:  lat,
      longitude: lng,
    });
  } catch (error) {
    console.error("updateLoginLocation error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── REGISTER ──────────────────────────────────────────────────────────────────
exports.registerUser = async (req, res) => {
  try {
    const { fullname, phonenumber, email, password } = req.body;

    if (!fullname || !email || !password || !phonenumber)
      return res.status(400).json({ message: "All fields are required" });

    const existing = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (existing.rows.length)
      return res.status(409).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      "INSERT INTO users (fullname, phonenumber, email, password, role) VALUES ($1, $2, $3, $4, $5)",
      [fullname, phonenumber, email, hashedPassword, "user"]
    );

    res.status(201).json({ success: true, message: "User created successfully" });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── UPDATE PROFILE ────────────────────────────────────────────────────────────
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullname, email, phonenumber } = req.body;

    if (!fullname || !email || !phonenumber)
      return res.status(400).json({ message: "All fields are required" });

    const users = await db.query("SELECT id FROM users WHERE id = $1", [id]);
    if (!users.rows.length)
      return res.status(404).json({ message: "User not found" });

    const emailCheck = await db.query(
      "SELECT id FROM users WHERE email = $1 AND id != $2",
      [email, id]
    );
    if (emailCheck.rows.length)
      return res.status(409).json({ message: "Email already in use by another account" });

    await db.query(
      "UPDATE users SET fullname = $1, email = $2, phonenumber = $3 WHERE id = $4",
      [fullname, email, phonenumber, id]
    );

    res.status(200).json({
      message: "Profile updated successfully",
      user: { id: Number(id), fullname, email, phonenumber },
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: "Both passwords are required" });

    const users = await db.query(
      "SELECT id, password FROM users WHERE id = $1",
      [id]
    );
    if (!users.rows.length)
      return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(currentPassword, users.rows[0].password);
    if (!isMatch)
      return res.status(401).json({ message: "Current password is incorrect" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, id]);

    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── GET ALL USERS ─────────────────────────────────────────────────────────────
exports.getAllUsers = async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, fullname, phonenumber, email, created_at FROM users ORDER BY created_at DESC"
    );
    res.status(200).json({ users: result.rows });
  } catch (error) {
    console.error("Get all users error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── GET SINGLE USER ───────────────────────────────────────────────────────────
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "SELECT id, fullname, phonenumber, email, created_at FROM users WHERE id = $1",
      [id]
    );
    if (!result.rows.length)
      return res.status(404).json({ message: "User not found" });

    res.status(200).json({ user: result.rows[0] });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE USER ───────────────────────────────────────────────────────────────
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const users = await db.query("SELECT id FROM users WHERE id = $1", [id]);
    if (!users.rows.length)
      return res.status(404).json({ message: "User not found" });

    await db.query("DELETE FROM users WHERE id = $1", [id]);
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── FORGOT PASSWORD ───────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email)
      return res.status(400).json({ message: "Email is required" });

    const result = await db.query(
      "SELECT id, fullname, email FROM users WHERE email = $1",
      [email]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        message: "No account found with this email address.",
      });
    }

    const user = result.rows[0];
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = Date.now() + 1000 * 60 * 60;

    await db.query(
      "UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE id = $3",
      [resetToken, resetTokenExpiry, user.id]
    );

    const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

    await transporter.sendMail({
      from: `"MyShop" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Reset Your Password – MyShop",
      html: `
        <div style="font-family:'Segoe UI',sans-serif;max-width:520px;margin:0 auto;background:#f8fafc;padding:2rem;border-radius:16px;">
          <div style="text-align:center;margin-bottom:1.5rem;">
            <h1 style="font-size:1.7rem;color:#1e293b;margin:0;">⚡ MyShop</h1>
          </div>
          <div style="background:white;border-radius:12px;padding:2rem;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
            <h2 style="color:#1e293b;margin-top:0;">Reset Your Password</h2>
            <p style="color:#64748b;line-height:1.7;">
              Hi <strong>${user.fullname}</strong>,<br/>
              We received a request to reset your password. Click the button below — this link expires in <strong>1 hour</strong>.
            </p>
            <div style="text-align:center;margin:2rem 0;">
              <a href="${resetLink}"
                style="background:linear-gradient(135deg,#3b82f6,#2563eb);
                       color:white;padding:0.9rem 2.5rem;border-radius:10px;
                       text-decoration:none;font-weight:700;font-size:1rem;
                       display:inline-block;">
                Reset Password
              </a>
            </div>
            <p style="color:#94a3b8;font-size:0.82rem;text-align:center;">
              If you didn't request this, you can safely ignore this email.
            </p>
          </div>
          <p style="color:#cbd5e1;font-size:0.75rem;text-align:center;margin-top:1.25rem;word-break:break-all;">
            ${resetLink}
          </p>
        </div>
      `,
    });

    res.status(200).json({
      message: "If this email is registered, a reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── VERIFY RESET TOKEN ────────────────────────────────────────────────────────
exports.verifyResetToken = async (req, res) => {
  try {
    const { token } = req.params;

    const result = await db.query(
      "SELECT id FROM users WHERE reset_token = $1 AND reset_token_expiry > $2",
      [token, Date.now()]
    );

    if (!result.rows.length)
      return res.status(400).json({ message: "Token is invalid or has expired" });

    res.status(200).json({ message: "Token is valid" });
  } catch (error) {
    console.error("Verify token error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── RESET PASSWORD ────────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword)
      return res.status(400).json({ message: "Token and new password are required" });

    if (newPassword.length < 6)
      return res.status(400).json({ message: "Password must be at least 6 characters" });

    const result = await db.query(
      "SELECT id FROM users WHERE reset_token = $1 AND reset_token_expiry > $2",
      [token, Date.now()]
    );

    if (!result.rows.length)
      return res.status(400).json({ message: "Token is invalid or has expired" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      "UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2",
      [hashedPassword, result.rows[0].id]
    );

    res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── CREATE COURIER ────────────────────────────────────────────────────────────
exports.createCourier = async (req, res) => {
  try {
    const { fullname, phonenumber, email, password } = req.body;

    if (!fullname || !email || !phonenumber || !password)
      return res.status(400).json({ message: "All fields are required" });

    const existing = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (existing.rows.length)
      return res.status(409).json({ message: "Email already in use" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await db.query(
      "INSERT INTO users (fullname, email, phonenumber, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [fullname, email, phonenumber, hashedPassword, "courier"]
    );

    res.status(201).json({
      message: "Courier account created successfully",
      courierId: result.rows[0].id,
    });
  } catch (error) {
    console.error("Create courier error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── GET ALL COURIERS ──────────────────────────────────────────────────────────
exports.getAllCouriers = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, fullname, phonenumber, email, latitude, longitude, last_location_update
       FROM users WHERE role = 'courier' ORDER BY fullname ASC`
    );
    res.status(200).json({ couriers: result.rows });
  } catch (error) {
    console.error("Get couriers error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── UPDATE COURIER LIVE LOCATION ──────────────────────────────────────────────
exports.updateCourierLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude)
      return res.status(400).json({ message: "Latitude and longitude are required" });

    await db.query(
      `UPDATE users
       SET latitude = $1, longitude = $2, last_location_update = NOW()
       WHERE id = $3 AND role = 'courier'`,
      [latitude, longitude, id]
    );

    res.status(200).json({ message: "Location updated successfully" });
  } catch (error) {
    console.error("Update location error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ── DELETE COURIER ────────────────────────────────────────────────────────────
exports.deleteCourier = async (req, res) => {
  try {
    const { id } = req.params;

    const couriers = await db.query(
      "SELECT id FROM users WHERE id = $1 AND role = 'courier'",
      [id]
    );
    if (!couriers.rows.length)
      return res.status(404).json({ message: "Courier not found" });

    await db.query(
      "UPDATE orders SET courier_id = NULL WHERE courier_id = $1",
      [id]
    );

    await db.query("DELETE FROM users WHERE id = $1", [id]);

    res.status(200).json({ message: "Courier deleted successfully" });
  } catch (error) {
    console.error("Delete courier error:", error);
    res.status(500).json({ message: "Server error" });
  }
};