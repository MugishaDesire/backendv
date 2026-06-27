const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { 
  getProducts, 
  addProduct, 
  deleteProduct, 
  updateProduct 
} = require("../controllers/ProductControllers");

// Image upload settings
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

// Optional: Add file filter for image validation
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images are allowed.'), false);
  }
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

router.get("/", getProducts);
router.post("/", upload.single("image"), addProduct);
router.delete("/:id", deleteProduct);
router.put("/:id", upload.single("image"), updateProduct);

module.exports = router;