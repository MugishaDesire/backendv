const express = require("express");
const router = express.Router();
const passport = require("../config/passport");
const { login, registerAdmin, verifyOtp, resendOtp } = require("../controllers/AdminControllers");

// POST /admin/login
router.post("/login", login);

// POST /admin/register
router.post("/register", registerAdmin);

// POST /admin/verify-otp
router.post("/verify-otp", verifyOtp);

// POST /admin/resend-otp
router.post("/resend-otp", resendOtp);

// GET /admin/auth/google
router.get("/auth/google",
  passport.authenticate("google-admin", { scope: ["profile", "email"] })
);

// GET /admin/auth/google/callback
router.get("/auth/google/callback",
  passport.authenticate("google-admin", {
    failureRedirect: "http://localhost:5173/login?error=not_authorized",
  }),
  (req, res) => {
    const admin = req.user;
    const adminData = encodeURIComponent(JSON.stringify({
      id: admin.id,
      email: admin.email,
    }));
    res.redirect(`http://localhost:5173/auth/google/success?admin=${adminData}`);
  }
);

module.exports = router;