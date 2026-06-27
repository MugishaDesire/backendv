const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const db = require("./db");

// ── ADMIN Google Strategy ─────────────────────────────────────────────────────
passport.use("google-admin",
  new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  "http://localhost:5000/admin/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;

        const result = await db.query(
          "SELECT id, email FROM admins WHERE email = $1",
          [email]
        );

        if (!result.rows.length) {
          return done(null, false, { message: "Not an authorized admin email" });
        }

        return done(null, { ...result.rows[0], role: "admin" });
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// ── USER Google Strategy ──────────────────────────────────────────────────────
passport.use("google-user",
  new GoogleStrategy(
    {
      clientID:          process.env.GOOGLE_CLIENT_ID,
      clientSecret:      process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:       "http://localhost:5000/user/auth/google/callback",
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const email    = profile.emails[0].value;
        const fullname = profile.displayName;

        const existing = await db.query(
          "SELECT id, fullname, phonenumber, email FROM users WHERE email = $1",
          [email]
        );

        if (existing.rows.length) {
          return done(null, { ...existing.rows[0], role: "user" });
        }

        // New user — insert then fetch
        await db.query(
          "INSERT INTO users (fullname, email, phonenumber, password) VALUES ($1, $2, $3, $4)",
          [fullname, email, "", "GOOGLE_AUTH"]
        );

        const newUser = await db.query(
          "SELECT id, fullname, phonenumber, email FROM users WHERE email = $1",
          [email]
        );

        return done(null, { ...newUser.rows[0], role: "user" });
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// ── Serialize / Deserialize ───────────────────────────────────────────────────
passport.serializeUser((user, done) => {
  done(null, { id: user.id, role: user.role });
});

passport.deserializeUser(async ({ id, role }, done) => {
  try {
    if (role === "admin") {
      const result = await db.query(
        "SELECT id, email FROM admins WHERE id = $1",
        [id]
      );
      done(null, { ...result.rows[0], role: "admin" });
    } else {
      const result = await db.query(
        "SELECT id, fullname, phonenumber, email FROM users WHERE id = $1",
        [id]
      );
      done(null, { ...result.rows[0], role: "user" });
    }
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;