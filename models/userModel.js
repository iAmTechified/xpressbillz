const mongoose = require('mongoose');


const userSchema = mongoose.Schema({

    username:{
        type:String,
        required:true
    },
    password:{
        type:String,
        required: true
    },    
    email:{
        type:String,
        required: true,
        unique:true

    },
    gender:{
        type:String,
        required:false
    },
    phoneNumber:{
        type:String,
        required:true
    },
    pin:{
        type:String,
        required:true
    },
    balance:{
        type:Number,
        default:0
    },


});


module.exports = mongoose.model('User', userSchema);

// username, password, email, phoneNumber, pin, balance