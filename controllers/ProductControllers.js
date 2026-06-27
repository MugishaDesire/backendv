const db = require("../config/db");

exports.getProducts = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM products");
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.addProduct = async (req, res) => {
  try {
    const { name, price, description, category, stock } = req.body;
    const image = req.file ? req.file.filename : null;

    const sql = `
      INSERT INTO products (name, price, description, category, image, stock)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    const result = await db.query(sql, [
      name,
      price,
      description,
      category,
      image,
      stock || 0
    ]);

    res.status(201).json({
      message: "Product added",
      productId: result.rows[0].id
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const image = req.file ? req.file.filename : null;

    const values = [
      req.body.name,
      req.body.price,
      req.body.description,
      req.body.category,
      req.body.stock
    ];

    let sql;
    if (image) {
      values.push(image);
      values.push(id);
      sql = `
        UPDATE products
        SET name=$1, price=$2, description=$3, category=$4, stock=$5, image=$6
        WHERE id=$7
      `;
    } else {
      values.push(id);
      sql = `
        UPDATE products
        SET name=$1, price=$2, description=$3, category=$4, stock=$5
        WHERE id=$6
      `;
    }

    await db.query(sql, values);
    res.json({ message: "Product updated" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "Product ID is required" });
    }

    await db.query("DELETE FROM products WHERE id = $1", [id]);
    res.json({ message: "Product deleted" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};