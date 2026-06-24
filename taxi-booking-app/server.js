const express = require('express');
const cors = require('cors');
const http = require('http');
const { Pool } = require('pg');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
// Khai báo io duy nhất tại đây
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 10000;

// Kết nối PostgreSQL (Neon)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- Socket.io xử lý chat ---
io.on('connection', (socket) => {
    console.log("Một người dùng đã kết nối:", socket.id);
    
    // Gửi lịch sử chat khi kết nối
    socket.on('get_history', async () => {
        try {
            const res = await pool.query('SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT 50');
            socket.emit('load_chat_history', res.rows);
        } catch (err) { console.error("Lỗi lấy lịch sử:", err); }
    });

    socket.on('chat_message', async (data) => {
        try {
            await pool.query('INSERT INTO chat_messages (username, message) VALUES ($1, $2)', [data.user, data.msg]);
            io.emit('new_chat_message', data);
        } catch (err) { console.error("Lỗi lưu chat:", err); }
    });
});

// --- API Auth ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, full_name } = req.body;
        await pool.query('INSERT INTO drivers (username, password, full_name) VALUES ($1, $2, $3)', [username, password, full_name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: 'Lỗi đăng ký' }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM drivers WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) res.json({ success: true, driver: result.rows[0] });
        else res.status(401).json({ success: false, message: 'Sai tài khoản' });
    } catch (err) { res.status(500).send(err.message); }
});

// --- API Đặt xe & Đơn hàng ---
app.post('/api/book', async (req, res) => {
    const { name, phone, route, vehicle, date, time, stops, pickup, destination, price } = req.body;
    const cleanPrice = price ? price.toString().replace(/[^\d]/g, '') : 0;
    try {
        await pool.query(
            `INSERT INTO bookings (customer_name, phone, route, vehicle_id, pickup_date, pickup_time, stops, pickup_location, destination, price, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
            [name, phone, route, vehicle, date || null, time || null, stops || 0, pickup, destination, cleanPrice]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/driver/orders', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM bookings ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).send("Lỗi tải đơn"); }
});

app.post('/api/driver/accept-order', async (req, res) => {
    const { orderId, driverId } = req.body;
    try {
        const result = await pool.query(
            "UPDATE bookings SET status = 'accepted', assigned_driver_id = $1 WHERE id = $2 AND status = 'pending'",
            [driverId, orderId]
        );
        if (result.rowCount > 0) res.json({ success: true });
        else res.status(400).json({ success: false, message: "Đơn đã có người nhận" });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/driver/update-status', async (req, res) => {
    const { id, status, driverId } = req.body;
    try {
        const result = await pool.query("UPDATE bookings SET status = $1 WHERE id = $2 AND assigned_driver_id = $3", [status, id, driverId]);
        if (result.rowCount > 0) res.json({ success: true });
        else res.status(404).json({ success: false });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- Admin ---
app.get('/api/admin/drivers', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM drivers');
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/api/admin/delete-order/:id', async (req, res) => {
    await pool.query("DELETE FROM bookings WHERE id = $1", [req.params.id]);
    res.json({ success: true });
});

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === '123456') res.json({ success: true });
    else res.status(401).json({ success: false });
});

// Chạy server
server.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));