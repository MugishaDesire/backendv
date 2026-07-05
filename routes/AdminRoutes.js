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
    failureRedirect: "https://myshop-plum-six.vercel.app/login?error=not_authorized",
  }),
  (req, res) => {
    const admin = req.user;
    const adminData = encodeURIComponent(JSON.stringify({
      id: admin.id,
      email: admin.email,
    }));
    res.redirect(`https://myshop-plum-six.vercel.app/auth/google/success?admin=${adminData}`);
  }
);

module.exports = router;