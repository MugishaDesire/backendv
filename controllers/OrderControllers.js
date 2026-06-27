const db = require("../config/db");
const nodemailer = require("nodemailer");

// ── Haversine formula ─────────────────────────────────────────────────────────
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Geocode address → { lat, lng } ───────────────────────────────────────────
async function geocodeAddress(address) {
  try {
    const fetch = (await import("node-fetch")).default;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const res  = await fetch(url, { headers: { "User-Agent": "MyShopApp/1.0" } });
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch (err) {
    console.error("Geocode error:", err.message);
  }
  return null;
}

// ── GET /orders ───────────────────────────────────────────────────────────────
exports.getOrders = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM orders ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ── GET /orders/user/:userId ──────────────────────────────────────────────────
exports.getOrdersByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId)
      return res.status(400).json({ message: "User ID required" });

    const result = await db.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ── POST /orders/:productId ───────────────────────────────────────────────────
// PostgreSQL transactions use a dedicated client from the pool,
// not db.getConnection() like MySQL. Pattern: client = await db.connect()
exports.createOrder = async (req, res) => {
  const client = await db.connect(); // ← get dedicated client for transaction

  try {
    const { productId } = req.params;
    const { cust_name, cust_phone, cust_email, qty, location, status, user_id, payment_ref } = req.body;

    if (!cust_name || !cust_phone || !qty || !location)
      return res.status(400).json({ message: "Missing required fields" });

    await client.query("BEGIN"); // ← start transaction

    const productResult = await client.query(
      "SELECT stock, name FROM products WHERE id = $1",
      [productId]
    );

    if (!productResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Product not found" });
    }

    const product = productResult.rows[0];

    if (product.stock < qty) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: `Insufficient stock for ${product.name}. Only ${product.stock} available.`,
      });
    }

    const orderResult = await client.query(
      `INSERT INTO orders
       (product_id, user_id, cust_name, cust_phone, cust_email, qty, location, status, payment_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        productId,
        user_id     || null,
        cust_name,
        cust_phone,
        cust_email  || null,
        qty,
        location,
        status      || "Pending",
        payment_ref || null,
      ]
    );

    await client.query(
      "UPDATE products SET stock = stock - $1 WHERE id = $2",
      [qty, productId]
    );

    await client.query("COMMIT"); // ← commit transaction

    res.status(201).json({
      message: "Order created successfully",
      orderId: orderResult.rows[0].id, // ← was: orderResult.insertId
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Order creation error:", error);
    res.status(500).json({ message: "Failed to create order" });
  } finally {
    client.release(); // ← always release client back to pool
  }
};

// ── POST /orders/batch ────────────────────────────────────────────────────────
exports.createBatchOrders = async (req, res) => {
  const client = await db.connect();

  try {
    const { items, cust_name, cust_phone, cust_email, location, status, user_id, payment_ref } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0)
      return res.status(400).json({ message: "No items provided" });

    if (!cust_name || !cust_phone || !location)
      return res.status(400).json({ message: "Missing required customer information" });

    await client.query("BEGIN");

    const stockIssues = [];

    for (const item of items) {
      const productResult = await client.query(
        "SELECT stock, name FROM products WHERE id = $1",
        [item.productId]
      );

      if (!productResult.rows.length) {
        stockIssues.push({ productId: item.productId, issue: "Product not found" });
        continue;
      }

      const product = productResult.rows[0];

      if (product.stock < item.qty) {
        stockIssues.push({
          productId:   item.productId,
          productName: product.name,
          requested:   item.qty,
          available:   product.stock,
          issue:       "Insufficient stock",
        });
      }
    }

    if (stockIssues.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Stock issues found", issues: stockIssues });
    }

    const createdOrders = [];

    for (const item of items) {
      const orderResult = await client.query(
        `INSERT INTO orders
         (product_id, user_id, cust_name, cust_phone, cust_email, qty, location, status, payment_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          item.productId,
          user_id     || null,
          cust_name,
          cust_phone,
          cust_email  || null,
          item.qty,
          location,
          status      || "Pending",
          payment_ref || null,
        ]
      );

      await client.query(
        "UPDATE products SET stock = stock - $1 WHERE id = $2",
        [item.qty, item.productId]
      );

      createdOrders.push({
        orderId:   orderResult.rows[0].id,
        productId: item.productId,
        quantity:  item.qty,
      });
    }

    await client.query("COMMIT");

    res.status(201).json({
      message:     "Orders created successfully",
      orders:      createdOrders,
      totalOrders: createdOrders.length,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Batch order creation error:", error);
    res.status(500).json({ message: "Failed to create orders" });
  } finally {
    client.release();
  }
};

// ── PATCH /orders/:id/status ──────────────────────────────────────────────────
exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      "SELECT status FROM orders WHERE id = $1",
      [id]
    );

    if (!result.rows.length)
      return res.status(404).json({ message: "Order not found" });

    const currentStatus = result.rows[0].status;
    const nextStatus =
      currentStatus === "Pending" ? "Paid"      :
      currentStatus === "Paid"    ? "Delivered"  :
                                    "Delivered";

    await db.query(
      "UPDATE orders SET status = $1 WHERE id = $2",
      [nextStatus, id]
    );

    res.json({ message: "Order status updated", status: nextStatus });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ── PATCH /orders/payment/:ref ────────────────────────────────────────────────
exports.updateOrderByPaymentRef = async (req, res) => {
  try {
    const { ref }    = req.params;
    const { status } = req.body;

    if (!ref || !status)
      return res.status(400).json({ message: "ref and status are required" });

    const result = await db.query(
      "UPDATE orders SET status = $1 WHERE payment_ref = $2",
      [status, ref]
    );

    if (result.rowCount === 0) { // ← was: result.affectedRows
      console.warn(`⚠️  No order found with payment_ref: ${ref}`);
      return res.status(200).json({ message: "No matching order found, skipped" });
    }

    console.log(`✅ ${result.rowCount} order(s) updated to "${status}" for payment_ref: ${ref}`);
    res.json({ message: "Order updated successfully", affectedRows: result.rowCount });
  } catch (error) {
    console.error("❌ updateOrderByPaymentRef error:", error.message);
    res.status(500).json({ message: "Failed to update order status" });
  }
};

// ── PATCH /orders/:id/assign ──────────────────────────────────────────────────
exports.assignOrderToCourier = async (req, res) => {
  try {
    const { id }         = req.params;
    const { courier_id } = req.body;

    if (!courier_id)
      return res.status(400).json({ message: "courier_id is required" });

    const orderResult = await db.query(
      "SELECT * FROM orders WHERE id = $1", [id]
    );

    if (!orderResult.rows.length)
      return res.status(404).json({ message: "Order not found" });

    const order = orderResult.rows[0];

    if (order.status === "Delivered")
      return res.status(400).json({ message: "Cannot assign an already delivered order" });

    const courierResult = await db.query(
      "SELECT id, fullname FROM users WHERE id = $1 AND role = 'courier'",
      [courier_id]
    );
    const courierName = courierResult.rows[0]?.fullname || "Your courier";

    await db.query(
      "UPDATE orders SET courier_id = $1, status = 'Assigned' WHERE id = $2",
      [courier_id, id]
    );

    const io = req.app.get("io");
    if (io && order.user_id) {
      io.to(`user_${order.user_id}`).emit("order:status", {
        orderId:     Number(id),
        status:      "Assigned",
        courierName,
        message:     `Your courier ${courierName} has been assigned and will pick up your order soon.`,
      });
    }

    if (io) {
      io.to(`courier_${courier_id}`).emit("new_assignment", {
        orderId: Number(id),
        message: "You have a new order assignment!",
      });
    }

    res.json({ message: "Order assigned to courier successfully", orderId: id, courier_id });
  } catch (error) {
    console.error("assignOrderToCourier error:", error);
    res.status(500).json({ message: error.message });
  }
};

// ── GET /orders/courier/:courierId ────────────────────────────────────────────
exports.getOrdersByCourier = async (req, res) => {
  try {
    const { courierId } = req.params;

    if (!courierId)
      return res.status(400).json({ message: "Courier ID required" });

    const result = await db.query(
      "SELECT * FROM orders WHERE courier_id = $1 ORDER BY created_at DESC",
      [courierId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("getOrdersByCourier error:", error);
    res.status(500).json({ message: error.message });
  }
};

// ── PATCH /orders/:id/deliver ─────────────────────────────────────────────────
exports.markAsDelivered = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      "SELECT * FROM orders WHERE id = $1", [id]
    );

    if (!result.rows.length)
      return res.status(404).json({ message: "Order not found" });

    const order = result.rows[0];

    if (order.status === "Delivered")
      return res.status(200).json({ message: "Order already delivered", alreadyDone: true });

    if (!order.courier_id)
      return res.status(400).json({ message: "No courier assigned to this order" });

    await db.query(
      "UPDATE orders SET status = 'Delivered' WHERE id = $1", [id]
    );

    const io = req.app.get("io");

    if (io && order.user_id) {
      io.to(`user_${order.user_id}`).emit("order:status", {
        orderId: Number(id),
        status:  "Delivered",
        message: "Your order has been delivered! Thank you for shopping with us. 🎉",
      });
    }

    if (io) {
      io.to("admin").emit("order:status_changed", {
        orderId: Number(id),
        status:  "Delivered",
      });
    }

    if (order.cust_email) {
      sendDeliveryEmail(order).catch(err =>
        console.error("Email send error:", err.message)
      );
    }

    console.log(`✅ Order ${id} auto-marked as Delivered`);
    res.json({ message: "Order marked as delivered", orderId: id });
  } catch (error) {
    console.error("markAsDelivered error:", error);
    res.status(500).json({ message: error.message });
  }
};

// ── PATCH /orders/:id/location ────────────────────────────────────────────────
exports.updateCourierLocation = async (req, res) => {
  try {
    const { id }              = req.params;
    const { lat, lng, label } = req.body;

    if (lat === undefined || lng === undefined)
      return res.status(400).json({ message: "lat and lng are required" });

    const orderResult = await db.query(
      "SELECT * FROM orders WHERE id = $1", [id]
    );

    if (!orderResult.rows.length)
      return res.status(404).json({ message: "Order not found" });

    const order = orderResult.rows[0];

    if (order.status === "Delivered")
      return res.status(200).json({ message: "Already delivered", alreadyDone: true });

    if (!order.courier_id)
      return res.status(400).json({ message: "No courier assigned" });

    const io = req.app.get("io");

    if (order.delivery_lat === null && order.user_id) {
      const courierResult = await db.query(
        "SELECT fullname FROM users WHERE id = $1", [order.courier_id]
      );
      const courierName = courierResult.rows[0]?.fullname || "Your courier";

      if (io) {
        io.to(`user_${order.user_id}`).emit("order:courier_on_way", {
          orderId:     Number(id),
          courierName,
          message:     `${courierName} has picked up your order and is on the way! 🚚`,
        });
      }

      if (order.cust_email) {
        sendOnTheWayEmail(order, courierName).catch(err =>
          console.error("On-the-way email error:", err.message)
        );
      }
    }

    await db.query(
      `UPDATE orders
       SET delivery_lat        = $1,
           delivery_lng        = $2,
           delivery_label      = $3,
           location_updated_at = NOW()
       WHERE id = $4`,
      [lat, lng, label || null, id]
    );

    if (io) {
      io.to(`order_${id}`).emit("courier:location", {
        courierId: order.courier_id,
        orderId:   Number(id),
        lat,
        lng,
      });
    }

    const DELIVERY_RADIUS_M = 100;

    if (order.location) {
      const customerCoords = await geocodeAddress(order.location);

      if (customerCoords) {
        const distance = getDistanceMeters(lat, lng, customerCoords.lat, customerCoords.lng);
        console.log(`📍 Order ${id}: courier is ${Math.round(distance)}m from customer`);

        if (distance <= DELIVERY_RADIUS_M) {
          await db.query(
            "UPDATE orders SET status = 'Delivered' WHERE id = $1", [id]
          );

          if (io && order.user_id) {
            io.to(`user_${order.user_id}`).emit("order:status", {
              orderId: Number(id),
              status:  "Delivered",
              message: "Your order has been delivered! Enjoy! 🎉",
            });
          }

          if (io) {
            io.to("admin").emit("order:status_changed", {
              orderId: Number(id),
              status:  "Delivered",
            });
          }

          if (io) {
            io.to(`courier_${order.courier_id}`).emit("order:auto_delivered", {
              orderId: Number(id),
              message: "Order automatically marked as delivered — you have arrived! 🎉",
            });
          }

          if (order.cust_email) {
            sendDeliveryEmail(order).catch(err =>
              console.error("Delivery email error:", err.message)
            );
          }

          return res.json({
            message:       "Location updated — order auto-delivered",
            autoDelivered: true,
            distance:      Math.round(distance),
          });
        }
      }
    }

    res.json({
      message:       "Location updated",
      autoDelivered: false,
      orderId:       Number(id),
      location:      { lat, lng, label: label || null },
    });
  } catch (error) {
    console.error("updateCourierLocation error:", error);
    res.status(500).json({ message: error.message });
  }
};

// ── DELETE /orders/:id ────────────────────────────────────────────────────────
exports.deleteOrder = async (req, res) => {
  const client = await db.connect();

  try {
    const { id } = req.params;

    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM orders WHERE id = $1", [id]
    );

    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Order not found" });
    }

    const order = result.rows[0];

    if (order.status !== "Delivered") {
      await client.query(
        "UPDATE products SET stock = stock + $1 WHERE id = $2",
        [order.qty, order.product_id]
      );
    }

    await client.query("DELETE FROM orders WHERE id = $1", [id]);
    await client.query("COMMIT");

    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Delete order error:", error);
    res.status(500).json({ message: "Failed to delete order" });
  } finally {
    client.release();
  }
};

// ── EMAIL HELPERS ─────────────────────────────────────────────────────────────
async function sendDeliveryEmail(order) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({
    from:    `"MyShop" <${process.env.EMAIL_USER}>`,
    to:      order.cust_email,
    subject: `✅ Your order #${order.id} has been delivered!`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:16px;">
        <div style="background:linear-gradient(135deg,#10b981,#059669);padding:28px 32px;border-radius:12px;margin-bottom:24px;text-align:center;">
          <div style="font-size:3rem;margin-bottom:8px;">✅</div>
          <h1 style="color:white;margin:0;font-size:1.5rem;font-weight:800;">Order Delivered!</h1>
          <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;">Your order has arrived successfully</p>
        </div>
        <div style="background:white;border-radius:12px;padding:24px;border:1px solid #e2e8f0;margin-bottom:16px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#64748b;font-size:0.9rem;border-bottom:1px solid #f1f5f9;">Order ID</td><td style="padding:8px 0;font-weight:700;color:#1e293b;text-align:right;">#${order.id}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-size:0.9rem;border-bottom:1px solid #f1f5f9;">Delivered To</td><td style="padding:8px 0;font-weight:600;color:#1e293b;text-align:right;">${order.location || "N/A"}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-size:0.9rem;">Recipient</td><td style="padding:8px 0;font-weight:600;color:#1e293b;text-align:right;">${order.cust_name || "N/A"}</td></tr>
          </table>
        </div>
        <div style="background:#d1fae5;border-radius:10px;padding:16px;text-align:center;border:1px solid #6ee7b7;">
          <p style="margin:0;color:#065f46;font-weight:600;">🎉 Thank you for shopping with us!</p>
        </div>
      </div>
    `,
  });
  console.log(`📧 Delivery email sent to ${order.cust_email}`);
}

async function sendOnTheWayEmail(order, courierName) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({
    from:    `"MyShop" <${process.env.EMAIL_USER}>`,
    to:      order.cust_email,
    subject: `🚚 Your order #${order.id} is on the way!`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:16px;">
        <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:28px 32px;border-radius:12px;margin-bottom:24px;text-align:center;">
          <div style="font-size:3rem;margin-bottom:8px;">🚚</div>
          <h1 style="color:white;margin:0;font-size:1.5rem;font-weight:800;">On The Way!</h1>
          <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;">Your courier has picked up your order</p>
        </div>
        <div style="background:white;border-radius:12px;padding:24px;border:1px solid #e2e8f0;margin-bottom:16px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#64748b;font-size:0.9rem;border-bottom:1px solid #f1f5f9;">Order ID</td><td style="padding:8px 0;font-weight:700;color:#1e293b;text-align:right;">#${order.id}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-size:0.9rem;border-bottom:1px solid #f1f5f9;">Courier</td><td style="padding:8px 0;font-weight:700;color:#7c3aed;text-align:right;">${courierName}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-size:0.9rem;">Delivering To</td><td style="padding:8px 0;font-weight:600;color:#1e293b;text-align:right;">${order.location || "N/A"}</td></tr>
          </table>
        </div>
        <div style="background:#ede9fe;border-radius:10px;padding:16px;text-align:center;border:1px solid #c4b5fd;">
          <p style="margin:0;color:#6d28d9;font-weight:600;">📍 Please be ready to receive your order at your delivery address.</p>
        </div>
      </div>
    `,
  });
  console.log(`📧 On-the-way email sent to ${order.cust_email}`);
}