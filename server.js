const express = require('express');
const cors = require('cors')
const dotenv = require('dotenv').config();
const port = process.env.PORT;
const connectDB = require('./config/database');


connectDB();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const allowedOrigins = [
    "http://10.0.0.2:19000", 
    "http://localhost:19000", //Expo for iOS and iOS simulator,
    "http://10.0.0.2:19000", //Expo for Android,
    "http://localhost:19006", //Expo for Web,
    "http://localhost:3000", //Our existing origin//Expo for Android,//192.168.10.99:8081

];

app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS: " + origin));
        }
      },
    })
  );

app.use('/api/users/', require('./routes/userRoutes'));
app.use('/api/users/transaction', require('./routes/transactionRoutes'))

app.listen(port, () => console.log(`Server started on port ${port}`))

