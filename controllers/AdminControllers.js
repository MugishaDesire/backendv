const db = require("../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const transporter = require("../config/mailer");

// const transporter = nodemailer.createTransport({
//   service: "gmail",
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS,
//   },
// });

// ─── HELPER: generate & save OTP ─────────────────────────────────────────────
async function sendOtp(adminId, email) {
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const hashedOtp = await bcrypt.hash(otp, 10);

  await db.query(
    "UPDATE admins SET otp = $1, otp_expires_at = $2 WHERE id = $3",
    [hashedOtp, expiresAt, adminId]
  );

  const { error } = await resend.emails.send({
  from: "Admin Panel <onboarding@resend.dev>", // resend.dev works instantly without domain verification, for testing
  to: email,
  subject: "Your login verification code",
  text: `Your OTP is: ${otp}\n\nIt expires in 10 minutes. Do not share it.`,
});

if (error) {
  throw new Error(`Failed to send OTP email: ${error.message}`);
}
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await db.query(
      "SELECT id, email, password FROM admins WHERE email = $1",
      [email]
    );

    if (!result.rows.length) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const admin = result.rows[0];
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    await sendOtp(admin.id, admin.email);

    return res.status(200).json({
      message: "OTP sent to your email",
      adminId: admin.id,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── VERIFY OTP ───────────────────────────────────────────────────────────────
exports.verifyOtp = async (req, res) => {
  try {
    const { adminId, otp } = req.body;

    const result = await db.query(
      "SELECT id, email, otp, otp_expires_at FROM admins WHERE id = $1",
      [adminId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const admin = result.rows[0];

    if (!admin.otp || new Date() > new Date(admin.otp_expires_at)) {
      return res.status(400).json({ message: "OTP expired. Request a new one." });
    }

    const isValid = await bcrypt.compare(otp, admin.otp);
    if (!isValid) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    await db.query(
      "UPDATE admins SET otp = NULL, otp_expires_at = NULL WHERE id = $1",
      [admin.id]
    );

    return res.status(200).json({
      message: "OTP verified. Login successful.",
      admin: { id: admin.id, email: admin.email },
      verified: true,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── RESEND OTP ───────────────────────────────────────────────────────────────
exports.resendOtp = async (req, res) => {
  try {
    const { adminId } = req.body;

    const result = await db.query(
      "SELECT id, email FROM admins WHERE id = $1",
      [adminId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Admin not found" });
    }

    await sendOtp(result.rows[0].id, result.rows[0].email);
    return res.status(200).json({ message: "New OTP sent" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── REGISTER ─────────────────────────────────────────────────────────────────
exports.registerAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const existing = await db.query(
      "SELECT id FROM admins WHERE email = $1",
      [email]
    );
    if (existing.rows.length) {
      return res.status(409).json({ message: "Admin already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      "INSERT INTO admins (email, password) VALUES ($1, $2)",
      [email, hashedPassword]
    );

    res.status(201).json({ message: "Admin created successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};