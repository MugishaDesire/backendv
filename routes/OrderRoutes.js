const express = require("express");
const router = express.Router();
const orderController = require("../controllers/OrderControllers");

router.get("/",                   orderController.getOrders);
router.post("/batch",             orderController.createBatchOrders);
router.post("/:productId",        orderController.createOrder);
router.patch("/:id/status",       orderController.updateOrderStatus);
router.get("/user/:userId",       orderController.getOrdersByUserId);
router.patch("/payment/:ref",     orderController.updateOrderByPaymentRef);

// ✅ Delivery / courier routes
router.patch("/:id/assign",       orderController.assignOrderToCourier);   // admin assigns
router.get("/courier/:courierId", orderController.getOrdersByCourier);     // courier's orders
router.patch("/:id/deliver",      orderController.markAsDelivered);        // courier delivers
router.patch("/:id/location",     orderController.updateCourierLocation);

module.exports = router;