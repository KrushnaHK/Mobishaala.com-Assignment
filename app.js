const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

const dbPath = path.join(__dirname, 'ecommerce.db')
let db = null

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () => {
      console.log('Server is running at http://localhost:3000')
    })
  } catch (e) {
    console.log(`DB Error : ${e.message}`)
    process.exit(1)
  }
}

initializeDbAndServer()

//API 1 Register User
app.post('/register/', async (request, response) => {
  const {name, email, password} = request.body
  const hashedPassword = await bcrypt.hash(password, 10)
  console.log(hashedPassword)
  const checkUser = `
        SELECT *
        FROM Users 
        WHERE email = '${email}';
    `
  const dbUser = await db.get(checkUser)
  if (dbUser !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const requestQuery = `
                INSERT INTO 
                    Users (name, email, password)
                VALUES (
                    '${name}',
                    '${email}',
                    '${hashedPassword}'
                );
            `
      await db.run(requestQuery)
      response.status(200)
      response.send('User created successfully')
    }
  }
})

//API 2 Login User: Create a new library user (email and password).
app.post('/login/', async (request, response) => {
  const {email, password} = request.body
  const checkUser = `
        SELECT *
        FROM Users 
        WHERE email = '${email}';
    `
  const dbUser = await db.get(checkUser)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {
        email: dbUser.email,
      }
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//Authentication with JWT Token
const authenticateToken = (request, response, next) => {
  let jwtToken

  const authHeader = request.headers['authorization']

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  } else {
    response.status(401).send('Invalid JWT Token')
    return // Stop further execution
  }

  if (jwtToken === undefined) {
    response.status(401).send('Invalid JWT Token')
    return // Stop further execution
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401).send('Invalid JWT Token')
      } else {
        console.log('JWT Payload:', payload) // Debug log
        request.email = payload.email // Correctly set the `email` field
        next()
      }
    })
  }
}

// API to add an item to the cart
app.post('/cart/', authenticateToken, async (request, response) => {
  const {user_id, product_id, quantity} = request.body

  // Check if the product exists in the products table
  const checkProductQuery = `SELECT * FROM Products WHERE product_id = ${product_id};`
  const product = await db.get(checkProductQuery)

  if (product === undefined) {
    response.status(400)
    response.send('Product not found')
  } else {
    // Check if the item already exists in the user's cart
    const checkCartItemQuery = `SELECT * FROM Cart WHERE user_id = ${user_id} AND product_id = ${product_id};`
    const cartItem = await db.get(checkCartItemQuery)

    if (cartItem === undefined) {
      // Add item to cart if it doesn't exist already
      const addToCartQuery = `
        INSERT INTO Cart (user_id, product_id, quantity)
        VALUES (${user_id}, ${product_id}, ${quantity});
      `
      await db.run(addToCartQuery)
      response.status(200)
      response.send('Item added to cart')
    } else {
      // Update quantity if item already exists
      const updateQuantityQuery = `
        UPDATE Cart
        SET quantity = quantity + ${quantity}
        WHERE user_id = ${user_id} AND product_id = ${product_id};
      `
      await db.run(updateQuantityQuery)
      response.status(200)
      response.send('Cart item quantity updated')
    }
  }
})

// API to remove an item from the cart
app.delete(
  '/cart/:cart_item_id',
  authenticateToken,
  async (request, response) => {
    const {cart_item_id} = request.params

    // Check if the cart item exists
    const checkCartItemQuery = `SELECT * FROM Cart WHERE cart_id = ${cart_item_id};`
    const cartItem = await db.get(checkCartItemQuery)

    if (cartItem === undefined) {
      response.status(400)
      response.send('Cart item not found')
    } else {
      // Remove the item from the cart
      const removeItemQuery = `DELETE FROM Cart WHERE cart_id = ${cart_item_id};`
      await db.run(removeItemQuery)
      response.status(200)
      response.send('Item removed from cart')
    }
  },
)

// API to update the quantity of an item in the cart
app.put('/cart/:cart_item_id', authenticateToken, async (request, response) => {
  const {cart_item_id} = request.params
  const {quantity} = request.body

  // Check if the cart item exists
  const checkCartItemQuery = `SELECT * FROM Cart WHERE cart_id = ${cart_item_id};`
  const cartItem = await db.get(checkCartItemQuery)

  if (cartItem === undefined) {
    response.status(400)
    response.send('Cart item not found')
  } else {
    // Update the quantity
    const updateQuantityQuery = `
      UPDATE Cart
      SET quantity = ${quantity}
      WHERE cart_id = ${cart_item_id};
    `
    await db.run(updateQuantityQuery)
    response.status(200)
    response.send('Cart item quantity updated')
  }
})

// API to fetch cart details for a user
app.get('/cart/', authenticateToken, async (request, response) => {
  const {email} = request
  console.log('Extracted Email:', email) // Debug

  const getUserQuery = `SELECT user_id
        FROM Users 
        WHERE email = '${email}';`
  const user = await db.get(getUserQuery)
  console.log('User fetched:', user) // Debug

  if (user === undefined) {
    response.status(400).send('User not found')
  } else {
    const userId = user.user_id
    console.log('User ID:', userId) // Debug

    const getCartDetailsQuery = `
      SELECT 
        Cart.cart_id AS cartItemId,
        Cart.product_id AS productId,
        Cart.quantity,
        Products.name AS productName,
        Products.price
      FROM Cart
      INNER JOIN Products ON Cart.product_id = Products.product_id
      WHERE Cart.user_id = ${userId};
    `
    const cartDetails = await db.all(getCartDetailsQuery)
    console.log('Cart Details:', cartDetails) // Debug

    response.status(200).send(cartDetails)
  }
})

module.exports = app
