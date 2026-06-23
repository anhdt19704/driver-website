const sql = require('mssql');

const config = {
    user: 'sa', // Tên đăng nhập mặc định
    password: '123', // ĐIỀN MẬT KHẨU CỦA BẠN VÀO ĐÂY
    server: 'localhost', 
    database: 'taxi_booking_system',
    options: {
        encrypt: false, 
        trustServerCertificate: true
    }
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('Kết nối Database thành công!');
        return pool;
    })
    .catch(err => console.log('Lỗi database: ', err));

module.exports = { sql, poolPromise };