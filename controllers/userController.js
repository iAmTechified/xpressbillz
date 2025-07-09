const asyncHandler = require("express-async-handler");
const User = require("../models/userModel");
const DepositTransaction = require("../models/depositTransactionModel");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const mongoose = require("mongoose");

const registerUser = asyncHandler(async (req, res) => {
  const { firstName, lastName, username, password, email, gender, phoneNumber, pin } = req.body;

  if (!firstName || !lastName || !username || !password || !email || !phoneNumber) {
    res.status(400).json({
      success: false,
      error: "Please Add All Fields",
    });
    return;
  }

  const userExists = await User.findOne({ email });
  const usernameExits = await User.findOne({ username: username.trim() });

  if (userExists) {
    res.status(400).json({
      success: false,
      error: "Email Already Exists",
    });
    return;
  } else if (usernameExits) {
    res.status(400).json({
      success: false,
      error: "USername Already Exists",
    });
    return;
  }

  const salt = await bcrypt.genSalt(10);
  const hashPassword = await bcrypt.hash(password, salt);

  // Create user first
  const user = await User.create({
    firstName,
    lastName,
    username: username.trim(),
    password: hashPassword,
    email,
    gender,
    phoneNumber,
    pin: "",
  });

  if (user) {
    // Respond immediately
    res.status(201).json({
      _id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      email: user.email,
      pin: user.pin,
      balance: user.balance,
      gender: user.gender,
      phoneNumber: user.phoneNumber,
      token: generateToken(user._id),
    });

    // Async: Create Paystack customer
    try {
      const paystackRes = await axios.post(
        "https://api.paystack.co/customer",
        {
          email,
          first_name: firstName,
          last_name: lastName,
          phone: phoneNumber,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      // Store both id and customer_code
      const paystackCustomerId = paystackRes.data?.data?.id;
      const paystackCustomerCode = paystackRes.data?.data?.customer_code;
      if (paystackCustomerId) {
        user.paystackCustomerId = paystackCustomerId;
      }
      if (paystackCustomerCode) {
        user.paystackCustomerCode = paystackCustomerCode;
      }
      if (paystackCustomerId || paystackCustomerCode) {
        await user.save();

        // Async: Create DVA (Dedicated Virtual Account)
        try {
          const dvaRes = await axios.post(
            "https://api.paystack.co/dedicated_account",
            {
              customer: paystackCustomerId,
              preferred_bank: "wema-bank", // or any supported bank code
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_KEY}`,
                "Content-Type": "application/json",
              },
            }
          );
          const dva = dvaRes.data?.data;
          if (dva && dva.account_number) {
            user.xpressAccountNumber = dva.account_number;
            user.xpressAccountName = dva.account_name;
            user.xpressAccountBank = dva.bank?.name || dva.bank;
            await user.save();
          }
        } catch (err) {
          // DVA creation failed, do nothing
        }
      }
    } catch (err) {
      // Paystack customer creation failed, do nothing
    }
  } else {
    res.status(400);
    throw new Error("Invalid Credentials");
  }
});

//to login a user
const loginUser = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let user;
  if (emailRegex.test(identifier)) {
    user = await User.findOne({ email: identifier });
  } else {
    user = await User.findOne({ phoneNumber: identifier });
  }
  if (!user) {
    return res.status(401).json({ message: "Invalid Email Or Phonenumber" });
  }
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ message: "Incorrect Password." });
  }
  res.status(200).json({
    _id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    email: user.email,
    pin: user.pin,
    balance: user.balance,
    gender: user.gender,
    phoneNumber: user.phoneNumber,
    token: generateToken(user._id),
  });
});

const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.body._id);
  if (user) {
    res.status(200).json({
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      phoneNumber: user.phoneNumber,
      email: user.email,
      balance: user.balance,
    });
  } else {
    res.status(404).json({
      success: false,
      message: "User not found",
    });
    return;
  }
});

const changeInfo = asyncHandler(async (req, res) => {
  const { _id, email, username, phoneNumber, oldPassword, newPassword, pin, firstName, lastName } = req.body;

  if (!email && !username && !oldPassword && !newPassword && !pin && !phoneNumber && !firstName && !lastName) {
    res.status(400).json({
      success: false,
      message: "No update information provided",
    });
    return;
  }

  const user = await User.findOne({ _id });
  if (!user) {
    res.status(404).json({
      success: false,
      message: "User not found",
    });
    return;
  }

  let passwordChanged = false;

  if (oldPassword) {
    if (await bcrypt.compare(oldPassword, user.password)) {
      if (newPassword) {
        const salt = await bcrypt.genSalt(10);
        const hashedNewPassword = await bcrypt.hash(newPassword, salt);
        user.password = hashedNewPassword;
        passwordChanged = true;
      }
      if (username) {
        user.username = username.trim();
      }
      if (email) {
        user.email = email;
      }
      if (phoneNumber) {
        user.phoneNumber = phoneNumber;
      }
      if (pin) {
        user.pin = pin;
      }
      if (firstName) {
        user.firstName = firstName;
      }
      if (lastName) {
        user.lastName = lastName;
      }
      const returnedUser = await user.save();
      res.status(200).json({
        success: true,
        message: "User information updated successfully",
        passwordChanged,
        user: {
          firstName: returnedUser.firstName,
          lastName: returnedUser.lastName,
          username: returnedUser.username,
          phoneNumber: returnedUser.phoneNumber,
          email: returnedUser.email,
          balance: returnedUser.balance,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        passwordIncorrect: true,
        message: "The old password is incorrect",
      });
      return;
    }
  } else {
    res.status(400).json({
      success: false,
      passwordIncorrect: true,
      message: "Please provide old password",
    });
    return;
  }
});

const changePin = asyncHandler(async (req, res) => {
  const { email, pin } = req.body;

  if (!email || !pin) {
    return res.status(400).json({
      success: false,
      message: "Email and pin are required",
    });
  }

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  user.pin = pin;

  await user.save();

  res.status(200).json({
    success: true,
    message: "Pin updated successfully",
  });
});

const changeBalance = asyncHandler(async (req, res) => {
  console.log(req.body);
  const body = req.body;
  const email = body.email;
  const newBalance = body.balance;

  const user = await User.findOne({ email });

  if (!email || newBalance === null || newBalance === undefined) {
    return res.status(400).json({
      success: false,
      message: "Email and pin are required",
    });
  }

  user.balance = newBalance;

  await user.save();

  res.status(200).json({
    success: true,
    message: "balance has been updated",
    data: user,
  });
});

const getEmailAndPhone = asyncHandler(async (req, res) => {
  const body = req.body;
  const email = body.email;
  const phone = body.phoneNumber;

  if (!email || !phone) {
    return res.status(400).json({
      status: "Failed",
      message: "No email or phone provided",
    });
  }

  const userExists = await User.findOne({ email });
  const phoneExists = await User.findOne({ phone });

  if (userExists) {
    return res.status(200).json({
      success: true,
      message: `User with email ${email} Exists`,
      data: { userExists, email },
    });
  } else if (phoneExists) {
    return res.status(200).json({
      success: true,
      message: `User with email ${phone} Exists`,
      data: { phoneExists, phone },
    });
  }

  res.status(400).json({
    status: false,
    message: "User Not Found",
  });
});

// Sync user's balance with Paystack
const syncUserBalance = asyncHandler(async (req, res) => {
  const userId = req.user?._id || req.body._id || req.params.userId;
  if (!userId) {
    return res.status(400).json({ status: false, message: 'User ID required' });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ status: false, message: 'User not found' });
  }

  let newCredits = [];

  try {
    if (user.paystackCustomerId) {
      // Get the latest transaction recorded for this user
      const lastTx = await DepositTransaction.findOne({ user: user._id })
        .sort({ createdAt: -1 });

      const fromUnix = lastTx
        ? Math.floor(new Date(lastTx.createdAt).getTime() / 1000)
        : null;

      let url = `https://api.paystack.co/transaction?customer=${user.paystackCustomerId}`;
      if (fromUnix) url += `&from=${fromUnix}`;

      // Fetch Paystack transactions
      const paystackRes = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_KEY}`,
        },
      });

      const transactions = paystackRes.data?.data || [];

      // Prepare a set of references already saved
      const references = transactions.map((tx) => tx.reference);
      const existingTxs = await DepositTransaction.find({
        reference: { $in: references },
        user: user._id,
      }).select('reference');

      const existingRefs = new Set(existingTxs.map((tx) => tx.reference));

      // Start MongoDB session for transaction safety
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        for (const tx of transactions) {
          if (
            !existingRefs.has(tx.reference) &&
            tx.status === 'success'
          ) {
            const amountNaira = Number(tx.amount) / 100;


            // Save transaction
            await DepositTransaction.create([{
              user: user._id,
              reference: tx.reference,
              amount: amountNaira,
              status: 'success',
              channel: tx.channel,
              type: 'DVA',
              paystackTransactionId: tx.id,
              paystackCustomerId: tx.customer?.id || tx.customer?.customer_code || '',
              paystackReference: tx.reference,
              paystackData: tx,
            }], { session });

            // Credit user
            user.balance += amountNaira;
            await user.save({ session });

            newCredits.push(tx);
          }
        }

        await session.commitTransaction();
        session.endSession();
      } catch (txErr) {
        await session.abortTransaction();
        session.endSession();
        console.error("Transaction sync error:", txErr);
      }
    }
  } catch (err) {
    console.error("Paystack API error:", err.response?.data || err.message);
    // We still return existing balance, no crash
  }

  return res.json({
    status: true,
    balance: user.balance,
    newCredits,
  });
});

//Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "20h",
  });
};

module.exports = {
  registerUser,
  loginUser,
  getMe,
  changeInfo,
  changePin,
  changeBalance,
  getEmailAndPhone,
  syncUserBalance,
};
