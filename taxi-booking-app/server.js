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
    const { name, phone, route, vehicle, date, time, stops, pickup, price } = req.body;
    try {
        await pool.query(
            `INSERT INTO bookings (customer_name, phone, route, vehicle_type, pickup_date, pickup_time, stops, pickup_location, price) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [name, phone, route, vehicle, date, time, stops, pickup, price]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Lỗi lưu database" });
    }
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
app.post('/api/driver/update-status', async (req, res) => {
    const { id, status, driverId } = req.body;
    try {
        // Kiểm tra xem ID có nhận được không
        if (!id || !driverId) return res.status(400).json({ message: "Thiếu dữ liệu" });
        
        // Thực hiện câu lệnh SQL
        const result = await pool.query(
            "UPDATE bookings SET status = $1 WHERE id = $2 AND assigned_driver_id = $3",
            [status, id, driverId]
        );
        
        if (result.rowCount > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ message: "Không tìm thấy đơn hàng" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Lỗi Server" });
    }
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

// API lấy danh sách tài xế
app.get('/api/admin/drivers', async (req, res) => {
    try {
        const result = await pool.query("SELECT id, username, full_name, status FROM drivers");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Lỗi DB" }); }
});

// API khóa/mở tài xế
app.post('/api/admin/toggle-driver', async (req, res) => {
    const { id } = req.body;
    try {
        await pool.query("UPDATE drivers SET status = CASE WHEN status = 'active' THEN 'locked' ELSE 'active' END WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});


server.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));