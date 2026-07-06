require("dotenv").config();

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first"); // forces IPv4 — fixes Render ENETUNREACH for outbound connections (e.g. nodemailer)

const express  = require("express");
const cors     = require("cors");
const session  = require("express-session");
const passport = require("./config/passport");
const http = require("http");

// Check if socket.io is installed, if not, show helpful error
let socketIo;
try {
  socketIo = require("socket.io");
} catch (err) {
  console.error("\x1b[31m%s\x1b[0m", "❌ ERROR: socket.io package is not installed!");
  console.log("\x1b[33m%s\x1b[0m", "Please run: npm install socket.io");
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || true,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Rest of your server configuration...
app.use(cors({
  origin: process.env.FRONTEND_URL || true,
  credentials: true
}));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", 
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Webhook MUST come before express.json()
app.use("/api/payment", require("./routes/PaymentRoutes"));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

app.use("/products", require("./routes/ProductRoutes"));
app.use("/orders",   require("./routes/OrderRoutes"));
app.use("/admin",    require("./routes/AdminRoutes"));
app.use("/user",     require("./routes/UserRoutes"));

// ── Socket.io Connection Handling ──────────────────────────────
io.on("connection", (socket) => {
  console.log(`🟢 New client connected: ${socket.id}`);

  // Courier joins their personal room
  socket.on("courier:join", (courierId) => {
    const room = `courier_${courierId}`;
    socket.join(room);
    console.log(`🚚 Courier ${courierId} joined room: ${room}`);
    
    socket.emit("courier:joined", { 
      courierId, 
      message: "Successfully connected to real-time updates" 
    });
  });

  // Courier sends location update
  socket.on("courier:location", (data) => {
    const { courierId, orderId, lat, lng } = data;
    console.log(`📍 Courier ${courierId} location update for order ${orderId}: [${lat}, ${lng}]`);
    
    // Broadcast to admin
    socket.broadcast.emit("courier:location", {
      courierId,
      orderId,
      lat,
      lng,
      timestamp: new Date().toISOString()
    });
    
    // Also emit to admin room
    socket.broadcast.to("admin").emit("courier:location", {
      courierId,
      orderId,
      lat,
      lng,
      timestamp: new Date().toISOString()
    });
  });

  // Admin joins admin room
  socket.on("admin:join", (adminId) => {
    socket.join("admin");
    console.log(`👨‍💼 Admin ${adminId} joined admin room`);
    socket.emit("admin:joined", { message: "Connected to admin dashboard" });
  });

  // Order assigned event
  socket.on("order:assigned", (data) => {
    const { orderId, courierId } = data;
    console.log(`📦 Order ${orderId} assigned to courier ${courierId}`);
    
    // Notify the specific courier
    io.to(`courier_${courierId}`).emit("new_assignment", {
      orderId,
      message: "You have a new order assignment!",
      timestamp: new Date().toISOString()
    });
    
    // Notify admin
    io.to("admin").emit("order:assigned", {
      orderId,
      courierId,
      timestamp: new Date().toISOString()
    });
  });

  
  // Order delivered event
  socket.on("order:delivered", (data) => {
    const { orderId, courierId } = data;
    console.log(`✅ Order ${orderId} delivered by courier ${courierId}`);

    
    io.to("admin").emit("order:status_changed", {
      orderId,
      status:    "Delivered",
      courierId,
      timestamp: new Date().toISOString()
    });
  });

  // Customer joins to track their order
  socket.on("customer:track", (orderId) => {
    const room = `order_${orderId}`;
    socket.join(room);
    console.log(`👤 Customer joined tracking room: ${room}`);
    socket.emit("customer:tracking", { 
      orderId, 
      message: "Tracking started" 
    });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`🔴 Client disconnected: ${socket.id}`);
  });

  // Courier tapped "Start Delivery" — notify customer immediately
  socket.on("courier:started_delivery", async ({ courierId, orderId }) => {
    try {
      // Look up the order to get user_id and courier name
      const db = require("./config/db");

      const orderResult = await db.query(
        "SELECT * FROM orders WHERE id = $1", [orderId]
      );
      if (!orderResult.rows.length) return;
      const order = orderResult.rows[0];

      const courierResult = await db.query(
        "SELECT fullname FROM users WHERE id = $1", [courierId]
      );
      const courierName = courierResult.rows[0]?.fullname || "Your courier";

      // Notify customer
      if (order.user_id) {
        io.to(`user_${order.user_id}`).emit("order:courier_on_way", {
          orderId:     Number(orderId),
          courierName,
          message:     `${courierName} has started your delivery and is on the way! 🚚`,
        });
      }

      // Also notify admin
      io.to("admin").emit("order:delivery_started", {
        orderId:     Number(orderId),
        courierId,
        courierName,
      });

      console.log(`🚚 Courier ${courierId} started delivery for order ${orderId}`);
    } catch (err) {
      console.error("courier:started_delivery error:", err.message);
    }
  });


});


// Make io accessible to routes
app.set("io", io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\x1b[32m%s\x1b[0m`, `🚀 Server running on port ${PORT}`);
  console.log(`\x1b[36m%s\x1b[0m`, `📡 Socket.io ready for connections`);
});