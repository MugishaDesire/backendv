const express = require("express");
const router = express.Router();
const passport = require("../config/passport");
const {
  login,
  registerUser,
  updateUser,
  changePassword,
  getAllUsers,
  getUserById,
  deleteUser,
  forgotPassword,
  verifyResetToken,
  resetPassword,
  createCourier,
  getAllCouriers,
  updateCourierLocation,
  deleteCourier,
  updateLoginLocation,   // ✅ NEW — add this import
} = require("../controllers/UserControllers");

router.post("/login",                    login);
router.post("/register",                 registerUser);
router.get("/",                          getAllUsers);
router.put("/password/:id",              changePassword);
router.post("/forgot-password",          forgotPassword);
router.get("/verify-reset-token/:token", verifyResetToken);
router.post("/reset-password",           resetPassword);

// ✅ Courier routes — must be before /:id
router.post("/courier",                  createCourier);
router.get("/couriers",                  getAllCouriers);
router.patch("/courier/:id/location",    updateCourierLocation);  // used during active delivery
router.patch("/courier/login-location",  updateLoginLocation);    // ✅ NEW — used on dashboard mount
router.delete("/courier/:id",            deleteCourier);

// Google OAuth
router.get("/auth/google", (req, res, next) => {
  const appState = req.query.appState || "";
  passport.authenticate("google-user", {
    scope: ["profile", "email"],
    state: appState,
  })(req, res, next);
});
router.get("/auth/google/callback",
  passport.authenticate("google-user", {
    failureRedirect: "https://myshop-plum-six.vercel.app/ulogin?error=google_failed",
  }), 
  (req, res) => {
    const user = req.user;
    const appState = req.query.state || "";
    const userData = encodeURIComponent(JSON.stringify({
      id:          user.id,
      fullname:    user.fullname,
      email:       user.email,
      phonenumber: user.phonenumber,
      role:        user.role,
    }));
    res.redirect(`https://myshop-plum-six.vercel.app/auth/google/user-success?user=${userData}&appState=${encodeURIComponent(appState)}`);
  }
);

router.get("/:id",    getUserById);
router.put("/:id",    updateUser);
router.delete("/:id", deleteUser);

module.exports = router;