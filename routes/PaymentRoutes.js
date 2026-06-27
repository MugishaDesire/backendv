const express = require("express");
const axios   = require("axios");
const crypto  = require("crypto");
const { getAccessToken } = require("../Utils/tokenManager");

const router = express.Router();
const BASE   = process.env.PAYPACK_BASE_URL;

// ✅ Parse JSON body for all routes
router.use(express.json());

// ── Initiate payment (collect FROM customer) ────────────────────────────
router.post("/cashin", async (req, res) => {
  const { amount, phone } = req.body;

  if (!amount || !phone)
    return res.status(400).json({ error: "Amount and phone are required" });

  try {
    const token = await getAccessToken();

    const response = await axios.post(
      `${BASE}/transactions/cashin`,
      { amount: Number(amount), number: phone },
      {
        headers: {
          "Content-Type":   "application/json",
          Accept:           "application/json",
          Authorization:    `Bearer ${token}`,
          "X-Webhook-Mode": process.env.NODE_ENV === "production"
            ? "production"
            : "development",
        },
      }
    );

    console.log("✅ Cashin initiated:", response.data);
    res.json(response.data);

  } catch (err) {
    console.error("❌ Cashin error:", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.message || "Payment initiation failed",
    });
  }
});

// ── Send money TO a recipient (admin cashout / refund) ──────────────────
router.post("/cashout", async (req, res) => {
  const { amount, phone } = req.body;

  if (!amount || !phone)
    return res.status(400).json({ error: "Amount and phone are required" });

  try {
    const token = await getAccessToken();

    const response = await axios.post(
      `${BASE}/transactions/cashout`,
      { amount: Number(amount), number: phone },
      {
        headers: {
          "Content-Type":   "application/json",
          Accept:           "application/json",
          Authorization:    `Bearer ${token}`,
          "X-Webhook-Mode": process.env.NODE_ENV === "production"
            ? "production"
            : "development",
        },
      }
    );

    console.log("✅ Cashout initiated:", response.data);
    res.json(response.data);

  } catch (err) {
    console.error("❌ Cashout error:", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.message || "Cashout initiation failed",
    });
  }
});

// ── Poll transaction status (works for both cashin and cashout) ─────────
router.get("/status/:ref", async (req, res) => {
  try {
    const token = await getAccessToken();

    console.log("🔍 Checking status for ref:", req.params.ref);

    const response = await axios.get(
      `${BASE}/transactions/find/${req.params.ref}`,
      {
        headers: {
          Accept:        "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );

    console.log("✅ Status response:", response.data);
    res.json(response.data);

  } catch (err) {
    console.error("❌ Status error full:", {
      status:  err.response?.status,
      data:    err.response?.data,
      message: err.message,
    });

    // 404 = transaction not yet processed — treat as still pending
    if (err.response?.status === 404) {
      return res.json({ status: "pending", message: "Transaction not yet processed" });
    }

    res.status(500).json({
      error:   "Could not fetch status",
      details: err.response?.data || err.message,
    });
  }
});

// ── Webhook — raw body needed, overrides router.use(express.json()) ─────
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.headers["x-paypack-signature"];
    const secret    = process.env.PAYPACK_WEBHOOK_SIGN_KEY;

    if (!signature) {
      return res.status(400).json({ error: "Missing signature header" });
    }

    const hash = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("base64");

    if (hash !== signature) {
      console.warn("⛔ Invalid webhook signature — rejected");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const { kind, data } = JSON.parse(req.body.toString());

    if (kind === "transaction:processed") {

      if (data.kind === "CASHIN") {
        if (data.status === "successful") {
          console.log(`✅ CASHIN confirmed — ref: ${data.ref} | amount: ${data.amount} | phone: ${data.client}`);
          // TODO: update order in DB to "Paid"
        } else {
          console.log(`❌ CASHIN failed — ref: ${data.ref}`);
          // TODO: mark order as failed
        }
      }

      if (data.kind === "CASHOUT") {
        if (data.status === "successful") {
          console.log(`✅ CASHOUT confirmed — ref: ${data.ref} | amount: ${data.amount} | phone: ${data.client}`);
          // TODO: log the cashout in your DB if needed
        } else {
          console.log(`❌ CASHOUT failed — ref: ${data.ref}`);
          // TODO: notify admin that cashout failed
        }
      }

    }

    res.status(200).json({ received: true });
  }
);

module.exports = router;