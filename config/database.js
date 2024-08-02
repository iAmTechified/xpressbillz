const mongoose = require('mongoose');
const mongoUrl = process.env.MONGO_URL; 

async function connectDB() {
    try {
    const conn =   await mongoose.connect(mongoUrl)
    console.log(`MongoDB Connected: ${conn.connection.host}`)
       console.log('connected to database')
    } catch (error) {
        console.error('error: ' + error.message)
        process.exit(1)   
    }
}

module.exports = connectDB;
