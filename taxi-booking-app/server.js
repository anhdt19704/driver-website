const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg'); // Chỉ dùng pg
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

// Kết nối PostgreSQL (Neon)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- API Auth ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, full_name } = req.body;
        await pool.query('INSERT INTO drivers (username, password, full_name) VALUES ($1, $2, $3)', [username, password, full_name]);
        res.json({ success: true, message: "Đăng ký thành công!" });
    } catch (err) { res.status(500).json({ success: false, message: 'Lỗi server' }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM drivers WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) res.json({ success: true, driver: result.rows[0] });
        else res.status(401).json({ success: false, message: 'Sai tài khoản' });
    } catch (err) { res.status(500).send(err.message); }
});

// --- API Đặt xe ---
app.post('/api/book', async (req, res) => {
    try {
        const { name, phone, pickup, destination, vehicle_id, price } = req.body;
        await pool.query(`INSERT INTO bookings (customer_name, phone, pickup_location, destination, vehicle_id, price, status) 
                          VALUES ($1, $2, $3, $4, $5, $6, 'pending')`, [name, phone, pickup, destination, vehicle_id, price]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// --- API Quản lý ---
app.get('/api/all-bookings', async (req, res) => {
    try {
        const result = await pool.query(`SELECT b.*, d.full_name AS driver_name FROM bookings b 
                                         LEFT JOIN drivers d ON b.assigned_driver_id = d.id ORDER BY b.id DESC`);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/update-status', async (req, res) => {
    try {
        const { id, status } = req.body;
        await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: 'Lỗi server' }); }
});

app.post('/api/driver/accept-order', async (req, res) => {
    try {
        const { orderId, driverId } = req.body;
        await pool.query("UPDATE bookings SET status = 'assigned', assigned_driver_id = $1 WHERE id = $2 AND status = 'pending'", [driverId, orderId]);
        res.json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});

// --- Socket.io xử lý chat ---
io.on('connection', (socket) => {
    socket.on('chat_message', async (data) => {
        try {
            await pool.query('INSERT INTO chat_messages (username, message) VALUES ($1, $2)', [data.user, data.msg]);
            io.emit('new_chat_message', data);
        } catch (err) { console.error("Lỗi chat:", err); }
    });
});

// --- Route tĩnh ---
app.get(['/', '/driver.html', '/admin-hub.html'], (req, res) => {
    res.sendFile(path.join(__dirname, req.path === '/' ? 'index.html' : req.path.substring(1)));
});

server.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));