const mongoose = require('mongoose');

const recordSchema = mongoose.Schema({
    user:{
        type:mongoose.Schema.Types.ObjectId,
        required:true,
        ref:'User'
    },
    transactionId:{
        type:String,
        required:true
    },
    dateofTransaction:{
      type:Date,
      required:true  
    },
    productName:{
        type:String,
        required:true
    },
    productType:{
        type:String,
        required:false
    },
    amount:{
        type:String,
        required:true
    },
    phoneNumber:{
        type:String,
        required:false
    },
    status:{
        type:String,
        required:true
    },
    token:{
        type:String,
        required:false
    },
    meterType:{
        type:String,
        required:false
    },
    customerName:{
        type:String,
        required:false
    },
    meterNumber:{
        type:String,
        required:false
    },
    planName:{
        type:String,
        required:false
    },
    transferDetails:{
        type:Object,
        required:false
    }


});

module.exports = mongoose.model('Record', recordSchema);