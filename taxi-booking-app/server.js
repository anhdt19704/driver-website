const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const { poolPromise } = require('./db');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
// Sửa dòng cũ thành:
app.use(express.static(__dirname));

// Route cho trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Route cho các trang khác (cần khai báo rõ như thế này)
app.get('/driver.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'driver.html'));
});

app.get('/admin-hub.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-hub.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// --- Socket.io: Xử lý thời gian thực ---
io.on('connection', (socket) => {
    console.log('User kết nối:', socket.id);

    // 1. Gửi lịch sử chat cho người vừa vào
    (async () => {
        try {
            const pool = await poolPromise;
            // Đã sửa 'username as user' thành 'username AS [user]'
            const result = await pool.request().query("SELECT TOP 50 username AS [user], message AS msg, FORMAT(created_at, 'HH:mm') AS time FROM chat_messages ORDER BY created_at ASC");
            socket.emit('load_chat_history', result.recordset);
        } catch (err) { console.error("Lỗi tải lịch sử chat:", err); }
    })();

    // 2. Lắng nghe tin nhắn từ Client
    socket.on('chat_message', async (data) => {
        try {
            const pool = await poolPromise;
            await pool.request()
                .input('u', data.user).input('m', data.msg)
                .query('INSERT INTO chat_messages (username, message) VALUES (@u, @m)');
            
            // Phát tin nhắn cho tất cả người đang kết nối
            io.emit('new_chat_message', data);
        } catch (err) { console.error("Lỗi lưu chat:", err); }
    });

    socket.on('disconnect', () => console.log('User ngắt kết nối'));
});

// --- API Đặt xe ---
app.post('/api/book', async (req, res) => {
    try {
        const { name, phone, pickup, destination, vehicle_id, price } = req.body;
        
        // Log dữ liệu nhận được để kiểm tra trên Terminal
        console.log("Dữ liệu nhận từ Frontend:", req.body);

        const pool = await poolPromise;
        await pool.request()
            .input('name', name)
            .input('phone', phone)
            .input('pickup', pickup)
            .input('dest', destination)
            .input('vid', vehicle_id)
            .input('price', price) 
            .query(`INSERT INTO bookings (customer_name, phone, pickup_location, destination, vehicle_id, price, status) 
                    VALUES (@name, @phone, @pickup, @dest, @vid, @price, 'pending')`);
        
        res.json({ success: true });
    } catch (err) {
        // Gửi lỗi chi tiết từ SQL về trình duyệt để bạn biết sai ở đâu
        console.error("LỖI SQL:", err); 
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- API Auth & Admin ---
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === '123456') { // Thay đổi thông tin đăng nhập của bạn tại đây
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Sai thông tin' });
    }
});

// --- API Tài xế: Đăng ký ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, full_name } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('u', username)
            .input('p', password) // Lưu ý: Nên dùng bcrypt để mã hóa mật khẩu ở bước sau
            .input('n', full_name)
            .query('INSERT INTO drivers (username, password, full_name) VALUES (@u, @p, @n)');
        res.json({ success: true, message: "Đăng ký thành công!" });
    } catch (err) { res.status(500).json({ success: false, message: 'Tên đăng nhập đã tồn tại' }); }
});

// --- API Tài xế: Đăng nhập ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('u', username)
            .input('p', password)
            .query('SELECT * FROM drivers WHERE username = @u AND password = @p');
        
        if (result.recordset.length > 0) res.json({ success: true, driver: result.recordset[0] });
        else res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
    } catch (err) { res.status(500).send(err.message); }
});
// Lấy danh sách toàn bộ tài xế
app.get('/api/admin/drivers', async (req, res) => {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM drivers');
    res.json(result.recordset);
});

// Khóa hoặc mở khóa tài xế
app.post('/api/admin/toggle-driver', async (req, res) => {
    const { id } = req.body;
    const pool = await poolPromise;
    await pool.request()
        .input('id', id)
        .query("UPDATE drivers SET status = CASE WHEN status = 'active' THEN 'locked' ELSE 'active' END WHERE id = @id");
    res.json({ success: true });
});
// --- API Quản lý đơn hàng ---
app.get('/api/all-bookings', async (req, res) => {
    try {
        const pool = await poolPromise;
        // Bổ sung b.completed_at vào danh sách SELECT
        const query = `
            SELECT b.*, b.completed_at, d.full_name AS driver_name 
            FROM bookings b 
            LEFT JOIN drivers d ON b.assigned_driver_id = d.id 
            ORDER BY b.id DESC`;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/stats', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`SELECT COUNT(*) as total_bookings, ISNULL(SUM(price), 0) as total_revenue FROM bookings WHERE status IN ('assigned', 'completed')`);
        res.json(result.recordset[0]);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/stats-by-date', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`SELECT YEAR(created_at) as year, MONTH(created_at) as month, COUNT(*) as total_orders, SUM(price) as revenue FROM bookings WHERE status = 'completed' GROUP BY YEAR(created_at), MONTH(created_at) ORDER BY year DESC, month DESC`);
        res.json(result.recordset);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/update-status', async (req, res) => {
    try {
        const { id, status } = req.body;
        const pool = await poolPromise;
        await pool.request().input('id', id).input('status', status).query('UPDATE bookings SET status = @status WHERE id = @id');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: 'Lỗi server' }); }
});

app.post('/api/delete-order', async (req, res) => {
    try {
        const { id } = req.body;
        const pool = await poolPromise;
        await pool.request().input('id', id).query('DELETE FROM bookings WHERE id = @id');
        res.json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/stats-filter', async (req, res) => {
    try {
        const { driverName, startDate, endDate } = req.query;
        let query = `SELECT * FROM bookings WHERE 1=1`;
        
        if (driverName) query += ` AND assigned_driver = '${driverName}'`;
        if (startDate) query += ` AND created_at >= '${startDate}'`;
        if (endDate) query += ` AND created_at <= '${endDate} 23:59:59'`;
        
        const pool = await poolPromise;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) { res.status(500).send(err.message); }
});
app.post('/api/driver/update-status', async (req, res) => {
    try {
        const { id, status, driverId } = req.body;
        const pool = await poolPromise;
        
        // BỔ SUNG: Thêm completed_at = GETDATE() để lưu thời gian thực tế
        const query = `
            UPDATE bookings 
            SET status = @status, completed_at = GETDATE() 
            WHERE id = @id AND assigned_driver_id = @driverId`;
            
        const result = await pool.request()
            .input('id', id)
            .input('driverId', driverId)
            .input('status', status)
            .query(query);

        if (result.rowsAffected[0] > 0) {
            // Gửi thông báo qua socket
            io.emit('booking_status_updated', { id, status });
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, message: "Không tìm thấy đơn hàng hoặc sai tài xế." });
        }
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});

// API khi tài xế bấm "Nhận đơn"
app.post('/api/driver/accept-order', async (req, res) => {
    const { orderId, driverId } = req.body;
    const pool = await poolPromise;
    // Chỉ cập nhật nếu đơn chưa có ai nhận (status = 'pending')
    await pool.request()
        .input('orderId', orderId)
        .input('driverId', driverId)
        .query("UPDATE bookings SET status = 'assigned', assigned_driver_id = @driverId WHERE id = @orderId AND status = 'pending'");
    res.json({ success: true });
});
// --- API Lọc đơn hàng & Thống kê ---
app.get('/api/admin/filter', async (req, res) => {
    try {
        const { driverName, date } = req.query; // date: 'YYYY-MM-DD'
        let query = `
            SELECT b.*, d.full_name AS driver_name 
            FROM bookings b 
            LEFT JOIN drivers d ON b.assigned_driver_id = d.id 
            WHERE 1=1`;

        if (driverName) query += ` AND d.full_name LIKE '%${driverName}%'`;
        if (date) query += ` AND CONVERT(DATE, b.created_at) = '${date}'`;
        
        query += ` ORDER BY b.id DESC`;
        
        const pool = await poolPromise;
        const result = await pool.request().query(query);
        
        // Tính tổng tiền từ kết quả lọc
        const totalRevenue = result.recordset.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);
        
        res.json({
            data: result.recordset,
            total_bookings: result.recordset.length,
            total_revenue: totalRevenue
        });
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/complete-order', (req, res) => {
    const { id } = req.body;
    const sql = "UPDATE bookings SET status = 'completed' WHERE id = ?";
    
    db.query(sql, [id], (err, result) => {
        if (err) {
            return res.status(500).json({ message: "Lỗi cơ sở dữ liệu" });
        }
        res.json({ message: "Thành công" });
    });
});

server.listen(3000, () => console.log('Server chạy tại http://localhost:3000'));