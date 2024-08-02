const asyncHandler = require('express-async-handler');
const Record = require('../models/transactionModel');

const createRecord = asyncHandler(async(req, res) => {

    const {dateofTransaction, productName, productType,
         token, amount, transactionId, user, status,
         customerName, meterType, meterNumber, planName, phoneNumber} = req.body

    if(!dateofTransaction || !productName  || !amount || !transactionId || !user || !status){
        console.log(req.body)
        res.status(400)
        throw new Error('Please add all fields');
    }

    const date = new Date(dateofTransaction);

    if (isNaN(date.getTime())) {
      res.status(400).json({
        error:'Invalid date format'
      });

    }
    const record = await Record.create({
        user,
        dateofTransaction: date,
        productName, 
        productType,
        token,
        amount,
        transactionId,
        status,
        customerName,
        meterType,
        meterNumber,
        planName,
        phoneNumber
    })

    if(record){
        res.status(201).json({
            message:"Record has been added"
        })
    }else {
        res.status(400)
        throw new Error("Your record wasn't saved ")
    }
});


const getAllRecords = asyncHandler(async(req, res) => {
    const id = req.params.id; // Access id from URL path
    const record = await Record.find({ user: id }); // Assuming the field is called user
    // console.log(record); // Log the record to console
    res.status(200).json(record);
})

const getRecord = asyncHandler(async(req, res) => {
    console.log(req.params)
    const { userId, transactionId } = req.params; // Access userId and transactionId from URL path
    const record = await Record.findOne({ _id: transactionId, user: userId }); // Find record by transactionId and userId

    if (record) {
        res.status(200).json(record);
    } else {
        res.status(404);
        throw new Error('Record not found');
    }
})

module.exports = {
    createRecord,
    getAllRecords,
    getRecord

}