const asyncHandler = require("express-async-handler");
const axios = require("axios");
const DepositTransaction = require("../models/depositTransactionModel");
const User = require("../models/userModel");

// GET /api/transaction/temp-account/:userId
const getTempAccount = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ status: false, message: "Missing userId" });
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ status: false, message: "User not found" });

  // Find latest pending temp account
  const now = new Date();
  const temp = await DepositTransaction.findOne({
    user: userId,
    depositType: "TEMP",
    status: { $in: ["Pending"] },
    tempAccountExpiry: { $gt: now },
  }).sort({ dateofTransaction: -1 });

  if (!temp) return res.status(404).json({ status: false, message: "No temp account found" });

  // Check status in DB
  if (temp.status === "Success") {
    return res.status(200).json({ status: false, message: "Temp account already used" });
  }

  // Check status on Paystack
  let paystackResponse;
  try {
    paystackResponse = await axios.get(`https://api.paystack.co/transaction/verify/${temp.paystackReference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_KEY}` } });
  } catch (err) {
    return res.status(500).json({ status: false, message: "Failed to verify with Paystack", error: err?.response?.data || err.message });
  }
  const data = paystackResponse.data?.data;
  if (data && data.status === "success") {
    // Update DB and user
    temp.status = "Success";
    temp.transferDetails = data;
    temp.dateofTransaction = new Date(data.paid_at || data.created_at || Date.now());
    await temp.save();
    const user = await User.findById(userId);
    if (user) {
      user.balance = user.balance + Number(temp.amount);
      await user.save();
    }
    return res.status(200).json({ status: false, message: "Temp account funded", clear: true });
  }

  // Still pending
  return res.status(200).json({
    status: true,
    transferDetails: {
      account: temp.tempAccountNumber,
      name: temp.tempAccountName,
      bank: temp.tempAccountBank,
      expiry: temp.tempAccountExpiry,
      reference: temp.transactionId,
      amount: temp.amount,
    },
    expiry: temp.tempAccountExpiry,
    reference: temp.transactionId,
  });
});

// POST /api/transaction/temp-account
// Body: { userId, amount, reference }
const createTempAccount = asyncHandler(async (req, res) => {
  const { userId, amount, reference } = req.body;
  if (!userId || !amount || !reference) {
    return res.status(400).json({ status: false, message: "Missing required fields" });
  }
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ status: false, message: "User not found" });

  // Set expiry to max (e.g., 24h from now)
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Call Paystack charge endpoint for temp account
  let chargeRes;
  try {
    chargeRes = await axios.post(
      "https://api.paystack.co/charge",
      {
        email: user.email,
        amount: Number(amount),
        reference,
        bank_transfer: { account_expires_at: expiry },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (e) {
    return res.status(500).json({ status: false, message: "Failed to create temp account", error: e?.response?.data || e.message });
  }

  const data = chargeRes.data?.data;
  if (!data || !data.authorization) {
    return res.status(500).json({ status: false, message: "No authorization/account returned from Paystack", paystack: chargeRes.data });
  }

  // Save to DepositTransaction
  const deposit = await DepositTransaction.create({
    user: userId,
    paystackCustomerId: data.customer?.customer_code || data.customer?.id || "",
    paystackReference: reference,
    paystackTransactionId: data.id ? String(data.id) : "",
    transactionId: reference,
    amount: Number(amount),
    status: "Pending",
    channel: "bank_transfer",
    depositType: "TEMP",
    reference: data.reference,
    transferDetails: data,
    dateofTransaction: new Date(),
    billingEmail: user.email,
    billingName: user.firstName + " " + user.lastName,
    balanceAfter: user.balance,
    tempAccountExpiry: expiry,
    tempAccountNumber: data.authorization.account_number,
    tempAccountName: data.authorization.account_name,
    tempAccountBank: data.authorization.bank,
  });

  return res.status(201).json({
    status: true,
    transferDetails: {
      account: data.authorization.account_number,
      name: data.authorization.account_name,
      bank: data.authorization.bank,
      expiry,
      reference,
      amount,
    },
    expiry,
    reference,
  });
});

module.exports = { createTempAccount, getTempAccount };
