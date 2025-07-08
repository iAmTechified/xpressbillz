const mongoose = require('mongoose');



const userSchema = mongoose.Schema({
    firstName: {
        type: String,
        required: true
    },
    lastName: {
        type: String,
        required: true
    },
    username: {
        type: String,
        required: true,
        trim: true
        // not unique
    },
    password: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    gender: {
        type: String,
        required: false
    },
    phoneNumber: {
        type: String,
        required: true
    },
    pin: {
        type: String
    },
    balance: {
        type: Number,
        default: 0
    },
    paystackCustomerId: {
        type: String,
        required: false,
        index: true
    },
    paystackCustomerCode: {
        type: String,
        required: false,
        index: true
    },
    xpressAccountNumber: {
        type: String,
        required: false
    },
    xpressAccountName: {
        type: String,
        required: false
    },
    xpressAccountBank: {
        type: String,
        required: false
    },
});


module.exports = mongoose.model('User', userSchema);

// username, password, email, phoneNumber, pin, balance