const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
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

// --- API Đặt xe (Đã bao gồm destination và các cột mới) ---
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
    } catch (err) {
        console.error("Lỗi Database:", err);
        res.status(500).json({ success: false, message: "Lỗi lưu database: " + err.message });
    }
});

// --- API Quản lý ---
app.get('/api/all-bookings', async (req, res) => {
    try {
        const query = `
            SELECT b.*, d.full_name AS driver_name
            FROM bookings b 
            LEFT JOIN drivers d ON b.assigned_driver_id = d.id 
            ORDER BY b.id DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

// API lấy đơn hàng cho tài xế
app.get('/api/driver/orders', async (req, res) => {
    try {
        const query = `
            SELECT id, customer_name, phone, pickup_location, destination, 
                   price, status, created_at, pickup_date, pickup_time, stops 
            FROM bookings ORDER BY id DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { res.status(500).send("Lỗi tải đơn hàng"); }
});
app.get('/api/admin/drivers', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM drivers');
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});
// API cập nhật trạng thái đơn hàng (Dành cho tài xế)
app.post('/api/driver/update-status', async (req, res) => {
    const { id, status, driverId } = req.body;
    if (!id || !driverId) return res.status(400).json({ success: false, message: "Thiếu thông tin xác thực" });
    
    try {
        // Cập nhật đơn hàng chỉ cho tài xế sở hữu đơn đó
        const result = await pool.query(
            "UPDATE bookings SET status = $1 WHERE id = $2 AND assigned_driver_id = $3", 
            [status, id, driverId]
        );
        
        if (result.rowCount > 0) res.json({ success: true });
        else res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng hoặc quyền truy cập bị từ chối" });
    } catch (err) { res.status(500).json({ success: false, message: "Lỗi Server" }); }
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
// API xoá đơn hàng (dành cho Admin)
app.delete('/api/admin/delete-order/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query("DELETE FROM bookings WHERE id = $1", [id]);
        if (result.rowCount > 0) {
            res.json({ success: true, message: "Đã xóa đơn hàng thành công!" });
        } else {
            res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng!" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Lỗi Server khi xóa đơn!" });
    }
});

app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    // Thay đổi logic kiểm tra theo bảng admin của bạn
    if (username === 'admin' && password === '123456') {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Sai thông tin admin' });
    }
});

app.post('/api/driver/accept-order', async (req, res) => {
    const { orderId, driverId } = req.body;
    try {
        const result = await pool.query(
            "UPDATE bookings SET status = 'accepted', assigned_driver_id = $1 WHERE id = $2 AND status = 'pending'",
            [driverId, orderId]
        );
        if (result.rowCount > 0) res.json({ success: true });
        else res.status(400).json({ success: false, message: "Đơn hàng đã có người nhận hoặc không tồn tại" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Lỗi Server" });
    }
});
// Route cho trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Route cho các file html khác
app.get('/:file', (req, res) => {
    res.sendFile(path.join(__dirname, req.params.file));
});


server.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));