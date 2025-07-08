const mongoose = require('mongoose');

const depositTransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  paystackCustomerId: {
    type: String,
    required: false,
    index: true,
  },
  paystackReference: {
    type: String,
    required: false,
    index: true,
  },
  paystackTransactionId: {
    type: String,
    required: false,
    index: true,
  },
  transactionId: {
    type: String,
    required: true,
    unique: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ['Pending', 'Success', 'Failed'],
    default: 'Pending',
  },
  channel: {
    type: String,
    enum: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'],
    required: true,
  },
  depositType: {
    type: String,
    enum: ['DVA', 'Other'],
    required: true,
    default: 'Other',
  },
  reference: {
    type: String,
  },
  transferDetails: {
    type: Object,
  },
  dateofTransaction: {
    type: Date,
    default: Date.now,
  },
  billingEmail: {
    type: String,
  },
  billingName: {
    type: String,
  },
  balanceAfter: {
    type: Number,
    required: false,
  },
}, { timestamps: true });

module.exports = mongoose.model('DepositTransaction', depositTransactionSchema);
