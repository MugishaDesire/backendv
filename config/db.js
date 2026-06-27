const { Pool } = require("pg");
require("dotenv").config();

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false  // ← fixes self-signed cert error with Supabase pooler
  }
});

// Test connection on startup
db.connect()
  .then(client => {
    console.log("✅ Connected to Supabase PostgreSQL");
    client.release();
  })
  .catch(err => {
    console.error("❌ Database connection failed:", err.message);
  });

module.exports = db;