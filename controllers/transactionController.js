
const asyncHandler = require("express-async-handler");
const axios = require("axios");
const Record = require("../models/transactionModel");
const User = require("../models/userModel");
const DepositTransaction = require("../models/depositTransactionModel");
const mongoose = require("mongoose");
// Endpoint: POST /api/transaction/verify-deposit

// Body: { reference, transactionId, userId, channel, depositType, amount, billingEmail, billingName }
const verifyDeposit = asyncHandler(async (req, res) => {
  const {
    reference,
    transactionId,
    userId,
    channel,
    depositType,
    billingEmail,
    billingName,
  } = req.body;

  if (!reference || !userId || !channel || !depositType) {
    return res.status(400).json({ status: false, message: "Missing required fields" });
  }

  // 1. Verify transaction on Paystack
  let paystackResponse;
  try {
    paystackResponse = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_KEY}` },
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: "Failed to verify with Paystack", error: err?.response?.data || err.message });
  }

  const data = paystackResponse.data?.data;
  if (!data || data.status != "success") {
    return res.status(400).json({ status: false, message: "Transaction not successful on Paystack", paystack: paystackResponse.data });
  }

  // Extract amount from Paystack (safe)
  const verifiedAmount = Number(data.amount) / 100;

  // 2. Check if transaction already exists
  const existing = await DepositTransaction.findOne({
    $or: [
      { paystackReference: reference },
      { paystackTransactionId: String(data.id) },
    ]
  });

  if (existing) {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: false, message: "User not found" });

    if (existing.status.toLowerCase() == "pending") {
      // Retry credit with transaction safety
      const session = await mongoose.startSession();
      session.startTransaction();

      try {

        Object.assign(existing, {
          status: "success",
          amount: verifiedAmount,
          paystackCustomerId: data.customer?.id || data.customer?.customer_code || "",
          paystackReference: reference,
          paystackTransactionId: String(data.id),
          channel,
          depositType,
          reference: data.reference,
          transferDetails: data,
          dateofTransaction: new Date(data.paid_at || data.created_at || Date.now()),
          billingEmail: billingEmail || data.customer?.email,
          billingName: billingName || data.customer?.first_name || "",
          balanceAfter: user.balance,
        });

        await existing.save({ session });

        user.balance += verifiedAmount;
        await user.save({ session });

        await session.commitTransaction();
        session.endSession();

        return res.status(200).json({ status: true, message: "Deposit updated", user, transaction: existing });
      } catch (err) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ status: false, message: "Failed to update transaction", error: err.message });
      }
    }

    // Already successful or failed
    const user2 = await User.findById(userId);
    return res.status(200).json({ status: true, message: "Already processed", user: user2, transaction: existing });
  }

  // 3. No transaction exists, create new record + update balance atomically
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ status: false, message: "User not found" });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const deposit = await DepositTransaction.create([{
      user: userId,
      paystackCustomerId: data.customer?.customer_code || data.customer?.id || "",
      paystackReference: reference,
      paystackTransactionId: String(data.id),
      transactionId,
      amount: verifiedAmount,
      status: "success",
      channel,
      depositType,
      reference: data.reference,
      transferDetails: data,
      dateofTransaction: new Date(data.paid_at || data.created_at || Date.now()),
      billingEmail: billingEmail || data.customer?.email,
      billingName: billingName || data.customer?.first_name || "",
      balanceAfter: user.balance,
    }], { session });

    user.balance += verifiedAmount;
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({ status: true, message: "Deposit recorded", user, transaction: deposit[0] });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ status: false, message: "Failed to record deposit", error: err.message });
  }
});


const createRecord = asyncHandler(async (req, res) => {
  const {
    dateofTransaction,
    productName,
    productType,
    token,
    amount,
    transactionId,
    user,
    status,
    customerName,
    meterType,
    meterNumber,
    planName,
    phoneNumber,
    transferDetails,
  } = req.body;

  if (
    !dateofTransaction ||
    !productName ||
    !amount ||
    !transactionId ||
    !user ||
    !status
  ) {
    console.log(req.body);
    res.status(400);
    throw new Error("Please add all fields");
  }

  const date = new Date(dateofTransaction);

  if (isNaN(date.getTime())) {
    res.status(400).json({
      error: "Invalid date format",
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
    phoneNumber,
    transferDetails,
  });

  if (record) {
    res.status(201).json({
      message: "Record has been added",
    });
  } else {
    res.status(400);
    throw new Error("Your record wasn't saved ");
  }
});

// ✅ Get all transactions (deposits + records) for a user
const getAllRecords = asyncHandler(async (req, res) => {
  const userId = req.params.id;

  if (!userId) {
    return res.status(400).json({ status: false, message: 'User ID is required' });
  }

  const deposits = await DepositTransaction.find({ user: userId }).lean();
  const records = await Record.find({ user: userId }).lean();

  // Normalize both collections
  const formattedDeposits = deposits.map(tx => ({
    _id: tx._id,
    type: 'credit',
    amount: `+₦${tx.amount}`,
    dateofTransaction: tx.dateofTransaction || tx.createdAt,
    status: tx.status || 'Pending',
    source: 'DepositTransaction',
    productName: tx.productName || 'Deposit',
    channel: tx.channel,
    description: `Deposit via ${tx.channel}`,
    reference: tx.reference,
    raw: tx,
  }));

  const formattedRecords = records.map(tx => ({
    _id: tx._id,
    type: 'debit',
    amount: tx.amount,
    dateofTransaction: tx.dateofTransaction || tx.createdAt,
    status: tx.status,
    source: 'Record',
    productName: tx.productName,
    description: `${tx.productName || 'Spending'} transaction`,
    reference: tx.transactionId,
    raw: tx,
  }));

  const allTransactions = [...formattedDeposits, ...formattedRecords].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  res.status(200).json({
    status: true,
    count: allTransactions.length,
    transactions: allTransactions,
  });
});

// ✅ Get a specific transaction by user and transaction ID
const getRecord = asyncHandler(async (req, res) => {
  const { userId, transactionId } = req.params;

  if (!userId || !transactionId) {
    return res.status(400).json({ status: false, message: 'User ID and transaction ID are required' });
  }

  // Try to find in DepositTransaction first
  let record = await DepositTransaction.findOne({
    $or: [
      { _id: transactionId },
      { transactionId: transactionId },
      { reference: transactionId },
    ],
    user: userId,
  });

  if (record) {
    return res.status(200).json({
      type: 'credit',
      source: 'DepositTransaction',
      transaction: record,
    });
  }

  // Try in Record model
  record = await Record.findOne({
    $or: [
      { _id: transactionId },
      { transactionId: transactionId },
    ],
    user: userId,
  });

  if (record) {
    return res.status(200).json({
      type: 'debit',
      source: 'Record',
      transaction: record,
    });
  }

  res.status(404);
  throw new Error('Transaction record not found');
});

const confirmRecord = asyncHandler(async (req, res) => {
  const body = req.body;
  const transactionId = body.transactionId;
  const email = body.email;
  const amount = body.amount;

  if (!email || !amount) {
    res.status(400).json({
      status: false,
      message: "Can't confirm records without data",
    });
    return;
  }

  axios
    .get(`http://api.paystack.co/transaction/verify/${transactionId}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_KEY}`,
      },
    })
    .then((response) => {
      updateBalanceAndRecord();
    });

  const updateBalanceAndRecord = async () => {
    const transaction = await Record.findOne(transactionId);
    transaction.status = "Success";
    await transaction.save();

    const user = await User.findOne(email);
    user.balance = user.balance + Number(amount);
    await user.save();
  };
});

const startTransfer = asyncHandler(async (req, res) => {
  const body = req.body;
  const id = body.transactionId;
  const userId = body.userId;
  const email = body.email;
  const amount = body.amount;

  const nigeriaOptions = { timeZone: "Africa/Lagos" };

  if (!email || !amount) {
    res.status(400).json({
      status: false,
      message: "Can't start transfer without data",
    });
    return;
  }

  axios
    .post(`http://api.paystack.co/charge`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_KEY}`,
        "Content-type": "application/json",
      },
    })
    .then((response) => {
      const storedData = {
        user: userId,
        transactionId: id,
        dateofTransaction: new Date().toLocaleString("en-US", nigeriaOptions),
        productName: "Deposit",
        amount: `+₦${Number(amount).toLocaleString()}`,
        status: "Pending",
        transferDetails: response.data,
      };

      createRecord(storedData);
    });

  const createRecord = async (data) => {
    const {
      dateofTransaction,
      productName,
      productType,
      token,
      amount,
      transactionId,
      user,
      status,
      customerName,
      meterType,
      meterNumber,
      planName,
      phoneNumber,
      transferDetails,
    } = data;

    const thisRecord = await Record.create({
      user,
      dateofTransaction,
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
      phoneNumber,
      transferDetails,
    });
    return thisRecord;
  };
});

const buyAirtime = asyncHandler(async (req, res) => {
  const body = req.body;
  const amount = body.amount;
  const nId = body.network;
  const phoneNumber = body.phoneNumber;
  const id = body.transactionId;
  const userId = body.userId;
  const pin = body.pin;

  const nigeriaOptions = { timeZone: "Africa/Lagos" };

  const apiUrl = `${process.env.API_URL}/airtime`;
  const apiKey = process.env.API_KEY;
  const userAccount = await User.findById(userId);

  const subAmount = Number(amount);

  const createRecord = async (data) => {
    const {
      dateofTransaction,
      productName,
      productType,
      token,
      amount,
      transactionId,
      user,
      status,
      customerName,
      meterType,
      meterNumber,
      planName,
      phoneNumber,
      transferDetails,
    } = data;

    const thisRecord = await Record.create({
      user,
      dateofTransaction,
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
      phoneNumber,
      transferDetails,
    });
    return thisRecord;
  };

  const updateBalance = async (returnMoney) => {
    if (returnMoney) {
      userAccount.balance = userAccount.balance + subAmount;
    } else {
      userAccount.balance = userAccount.balance - subAmount;
    }
    await userAccount.save();
  };
  const updateRecord = async (data) => {
    const pendingTransactionId = data.transactionId;
    const pendingTransaction = await Record.findById(pendingTransactionId);

    pendingTransaction.status = data.status;

    await pendingTransaction.save();
  };

  if (userAccount.balance < subAmount) {
    return res.status(201).json({
      status: false,
      failCode: "airtime03",
      purchase: "Failed",
      message: "Airtime Purchase failed Insufficient Balance!",
      user: userAccount,
    });
  } else if (userAccount.pin != pin) {
    return res.status(201).json({
      status: false,
      failCode: "airtime04",
      purchase: "Failed",
      message: "Airtime Purchase failed Incorrect Pin!",
    });
  } else {
    const bodyData = new FormData();
    bodyData.append("amount", amount);
    bodyData.append("network", `${nId}`);
    bodyData.append("recipent", phoneNumber);
    bodyData.append("ported", true);

    let done = false;
    let pending;

    const checkTiming = setTimeout(async () => {
      if (done) {
        clearTimeout(checkTiming);
      } else {
        pending = true;
        await updateBalance();

        const storedData = {
          user: userId,
          transactionId: id,
          dateofTransaction: new Date().toLocaleString("en-US", nigeriaOptions),
          productName: "Airtime",
          phoneNumber,
          productType: `${
            nId === 1
              ? "MTN"
              : nId === 2
              ? "AIRTEL"
              : nId === 3
              ? "GLO"
              : nId === 4
              ? "9mobile"
              : ""
          }`,
          amount: `-₦${Number(amount).toLocaleString()}`,
          status: "Pending",
        };

        const record = await createRecord(storedData);

        return res.status(201).json({
          status: false,
          failCode: "airtime06",
          purchase: "Pending",
          message: "Airtime Purchase pending",
          user: userAccount,
        });
      }
    }, 60000);

    axios
      .post(apiUrl, bodyData, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "multipart/form-data",
        },
      })
      .then(async (response) => {
        console.log(response.data);

        // Trying to re-run request to check if the number is ported
        if (
          response.data.status === "error" &&
          response.data.message ==
            `We couldn't process your order because the number(s) ${phoneNumber}, is not ${
              nId === 1
                ? "Mtn"
                : nId === 2
                ? "Airtel"
                : nId === 3
                ? "Glo"
                : nId === 4
                ? "9mobile"
                : ""
            } number(s) `
        ) {
          console.log("Yessssssssss!");

          const bodyData = new FormData();
          bodyData.append("amount", amount);
          bodyData.append("network", `${nId}`);
          bodyData.append("recipent", phoneNumber);
          bodyData.append("ported", false);

          axios
            .post(apiUrl, bodyData, {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "multipart/form-data",
              },
            })
            .then(async (response) => {
              console.log(response.data);

              // UNKNOWN ERROR
              if (response.data.status === "error") {
                // UPDATE RECORD FOR FAILED
                const storedData = {
                  user: userId,
                  transactionId: id,
                  dateofTransaction: new Date().toLocaleString(
                    "en-US",
                    nigeriaOptions
                  ),
                  productName: "Airtime",
                  phoneNumber,
                  productType: `${
                    nId === 1
                      ? "MTN"
                      : nId === 2
                      ? "AIRTEL"
                      : nId === 3
                      ? "GLO"
                      : nId === 4
                      ? "9mobile"
                      : ""
                  }`,
                  amount: `-₦${Number(amount).toLocaleString()}`,
                  status: "Failed",
                };

                if (pending) {
                  // RETURN MONEY TO BALANCE
                  await updateBalance(true);
                  // UPDATE TRANSACTION STATUS
                  const record = await updateRecord(storedData);
                } else {
                  const record = await createRecord(storedData);

                  if (record) {
                    done = true;
                    clearTimeout(checkTiming);

                    res.status(201).json({
                      status: false,
                      failCode: "airtime01",
                      purchase: "Failed",
                      message:
                        "Airtime Purchase failed and Record has been added",
                    });
                    return;
                  } else {
                    done = true;
                    clearTimeout(checkTiming);
                    res.status(201).json({
                      status: false,
                      failCode: "airtime02",
                      purchase: "Failed",
                      message:
                        "Airtime Purchase failed and Record was not added",
                    });

                    throw new Error(
                      "Airtime Purchase failed and Record wasn't saved "
                    );
                  }
                }
              } else if (response.data.status === "success") {
                // UPDATE RECORD
                const storedData = {
                  user: userId,
                  transactionId: id,
                  dateofTransaction: new Date().toLocaleString(
                    "en-US",
                    nigeriaOptions
                  ),
                  productName: "Airtime",
                  phoneNumber,
                  productType: `${
                    nId === 1
                      ? "MTN"
                      : nId === 2
                      ? "AIRTEL"
                      : nId === 3
                      ? "GLO"
                      : nId === 4
                      ? "9mobile"
                      : ""
                  }`,
                  amount: `-₦${Number(amount).toLocaleString()}`,
                  status: "Success",
                };

                if (pending) {
                  // UPDATE TRANSACTION STATUS
                  const record = await updateRecord(storedData);
                } else {
                  await updateBalance();
                  const record = await createRecord(storedData);

                  if (record) {
                    done = true;
                    clearTimeout(checkTiming);
                    res.status(200).json({
                      status: true,
                      purchase: "Complete",
                      message:
                        "Airtime Purchase successful and Record has been added",
                      user: userAccount,
                    });
                    return;
                  } else {
                    done = true;
                    clearTimeout(checkTiming);
                    res.status(201).json({
                      status: false,
                      purchase: "Success",
                      message:
                        "Airtime Purchase successful and Record was not added",
                      user: userAccount,
                    });
                  }
                }
              }
            })
            // UNKNOWN ERROR
            .catch((error) => {
              done = true;
              clearTimeout(checkTiming);
              console.log(error);
              res.status(400).json({
                status: false,
                failCode: "airtime05",
                purchase: "Failed",
                message: "Airtime Purchase failed",
              });
              return;
            });

          // Continues normally from here
        } else if (
          response.data.status === "error" &&
          response.data.message !=
            `We couldn't process your order because the number(s) ${phoneNumber}, is not ${
              nId === 1
                ? "Mtn"
                : nId === 2
                ? "Airtel"
                : nId === 3
                ? "Glo"
                : nId === 4
                ? "9mobile"
                : ""
            } number(s) `
        ) {
          // UPDATE RECORD FOR FAILED

          const storedData = {
            user: userId,
            transactionId: id,
            dateofTransaction: new Date().toLocaleString(
              "en-US",
              nigeriaOptions
            ),
            productName: "Airtime",
            phoneNumber,
            productType: `${
              nId === 1
                ? "MTN"
                : nId === 2
                ? "AIRTEL"
                : nId === 3
                ? "GLO"
                : nId === 4
                ? "9mobile"
                : ""
            }`,
            amount: `-₦${Number(amount).toLocaleString()}`,
            status: "Failed",
          };

          if (pending) {
            // RETURN MONEY TO BALANCE
            await updateBalance(true);
            // UPDATE TRANSACTION STATUS
            const record = await updateRecord(storedData);
          } else {
            const record = createRecord(storedData);

            if (record) {
              done = true;
              clearTimeout(checkTiming);
              res.status(201).json({
                status: false,
                failCode: "airtime01",
                purchase: "Failed",
                message: "Airtime Purchase failed and Record has been added",
              });
              return;
            } else {
              done = true;
              clearTimeout(checkTiming);
              res.status(201).json({
                status: false,
                failCode: "airtime02",
                purchase: "Failed",
                message: "Airtime Purchase failed and Record was not added",
              });

              throw new Error(
                "Airtime Purchase failed and Record wasn't saved "
              );
            }
          }
        } else if (response.data.status === "success") {
          // UPDATE RECORD
          const storedData = {
            user: userId,
            transactionId: id,
            dateofTransaction: new Date().toLocaleString(
              "en-US",
              nigeriaOptions
            ),
            productName: "Airtime",
            phoneNumber,
            productType: `${
              nId === 1
                ? "MTN"
                : nId === 2
                ? "AIRTEL"
                : nId === 3
                ? "GLO"
                : nId === 4
                ? "9mobile"
                : ""
            }`,
            amount: `-₦${Number(amount).toLocaleString()}`,
            status: "Success",
          };

          if (pending) {
            // UPDATE TRANSACTION STATUS
            const record = await updateRecord(storedData);
          } else {
            await updateBalance();
            const record = await createRecord(storedData);

            if (record) {
              done = true;
              clearTimeout(checkTiming);
              res.status(200).json({
                status: true,
                purchase: "Complete",
                message:
                  "Airtime Purchase successful and Record has been added",
                user: userAccount,
              });
              return;
            } else {
              done = true;
              clearTimeout(checkTiming);
              res.status(201).json({
                status: false,
                purchase: "Success",
                message: "Airtime Purchase successful and Record was not added",
                user: userAccount,
              });
            }
          }
        } else {
          done = true;
          clearTimeout(checkTiming);
          res.status(400).json({
            status: false,
            failCode: "airtime06",
            purchase: "Failed",
            message: "Airtime Purchase failed",
          });
          return;
        }
      })
      .catch((error) => {
        done = true;
        clearTimeout(checkTiming);
        console.log(error);
        res.status(400).json({
          status: false,
          failCode: "airtime05",
          purchase: "Failed",
          message: "Airtime Purchase failed",
        });
        return;
      });
  }
});

const buyData = asyncHandler(async (req, res) => {
  const body = req.body;
  const nId = body.network;
  const plan = body.plan;
  const phoneNumber = body.phoneNumber;
  const id = body.transactionId;
  const userId = body.userId;
  const pin = body.pin;

  const nigeriaOptions = { timeZone: "Africa/Lagos" };

  const apiUrl = `${process.env.API_URL}/data`;
  const apiKey = process.env.API_KEY;
  const userAccount = await User.findById(userId);

  const amount = plan.plan_amount;
  const subAmount = Number(amount);

  let storedData = {
    user: userId,
    transactionId: id,
    dateofTransaction: new Date().toLocaleString("en-US", nigeriaOptions),
    productName: "Mobile Data",
    productType: `${
      nId === 1
        ? "MTN"
        : nId === 2
        ? "AIRTEL"
        : nId === 3
        ? "GLO"
        : nId === 4
        ? "9mobile"
        : ""
    }`,
    phoneNumber,
    amount: `-₦${Number(plan?.plan_amount + 50)}`,
    planName: plan?.plan_name,
    status: "Pending",
  };

  const createRecord = async (data) => {
    const {
      dateofTransaction,
      productName,
      productType,
      token,
      amount,
      transactionId,
      user,
      status,
      customerName,
      meterType,
      meterNumber,
      planName,
      phoneNumber,
      transferDetails,
    } = data;

    const thisRecord = await Record.create({
      user,
      dateofTransaction,
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
      phoneNumber,
      transferDetails,
    });
    return thisRecord;
  };

  const updateBalance = async (returnMoney) => {
    if (returnMoney) {
      userAccount.balance = userAccount.balance + subAmount;
    } else {
      userAccount.balance = userAccount.balance - subAmount;
    }
    return await userAccount.save();
  };

  const updateRecord = async (data) => {
    const pendingTransactionId = data.transactionId;
    const pendingTransaction = await Record.findById(pendingTransactionId);

    pendingTransaction.status = data.status;

    await pendingTransaction.save();
  };

  if (userAccount.balance < subAmount) {
    return res.status(201).json({
      status: false,
      failCode: "data03",
      purchase: "Failed",
      message: "Data Purchase failed Insufficient Balance!",
      user: userAccount,
    });
  } else if (userAccount.pin != pin) {
    return res.status(201).json({
      status: false,
      failCode: "data04",
      purchase: "Failed",
      message: "Data Purchase failed Incorrect Pin!",
    });
  } else {
    if (updateBalance()) {
      const bodyData = new FormData();
      bodyData.append("network", `${nId}`);
      bodyData.append("plan_id", plan.plan_id);
      bodyData.append("recipent", `${phoneNumber}`);
      bodyData.append("ported", true);

      let done = false;
      let pending;

      const checkTiming = setTimeout(async () => {
        if (done) {
          clearTimeout(checkTiming);
        } else {
          pending = true;

          storedData.status = "Pending";

          const record = await createRecord(storedData);

          return res.status(201).json({
            status: false,
            failCode: "data06",
            purchase: "Pending",
            message: "Data Purchase pending",
            user: userAccount,
          });
        }
      }, 60000);

      axios
        .post(apiUrl, bodyData, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "multipart/form-data",
          },
        })
        .then(async (response) => {
          console.log(response.data);

          // Trying to re-run request to check if the number is ported
          if (
            response.data.status === "error" &&
            response.data.message ==
              `We couldn't process your order because the number(s) ${phoneNumber}, is not ${
                nId === 1
                  ? "Mtn"
                  : nId === 2
                  ? "Airtel"
                  : nId === 3
                  ? "Glo"
                  : nId === 4
                  ? "9mobile"
                  : ""
              } number(s) `
          ) {
            console.log("Yessssssssss!");

            const bodyData = new FormData();
            bodyData.append("network", `${nId}`);
            bodyData.append("plan_id", plan.plan_id);
            bodyData.append("recipent", `${phoneNumber}`);
            bodyData.append("ported", true);

            axios
              .post(apiUrl, bodyData, {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "multipart/form-data",
                },
              })
              .then(async (response) => {
                console.log(response.data);

                // UNKNOWN ERROR
                if (response.data.status === "error") {
                  // UPDATE RECORD FOR FAILED
                  storedData.status = "Failed";

                  // RETURN MONEY TO BALANCE
                  await updateBalance(true);

                  if (pending) {
                    // UPDATE TRANSACTION STATUS
                    const record = await updateRecord(storedData);
                  } else {
                    const record = await createRecord(storedData);

                    if (record) {
                      done = true;
                      clearTimeout(checkTiming);

                      res.status(201).json({
                        status: false,
                        failCode: "data01",
                        purchase: "Failed",
                        message:
                          "Data Purchase failed and Record has been added",
                      });
                      return;
                    } else {
                      done = true;
                      clearTimeout(checkTiming);
                      res.status(201).json({
                        status: false,
                        failCode: "data02",
                        purchase: "Failed",
                        message:
                          "Data Purchase failed and Record was not added",
                      });

                      throw new Error(
                        "Data Purchase failed and Record wasn't saved "
                      );
                    }
                  }
                } else if (response.data.status === "success") {
                  // UPDATE RECORD
                  storedData.status = "Success";

                  if (pending) {
                    // UPDATE TRANSACTION STATUS
                    const record = await updateRecord(storedData);
                  } else {
                    const record = await createRecord(storedData);

                    if (record) {
                      done = true;
                      clearTimeout(checkTiming);
                      res.status(200).json({
                        status: true,
                        purchase: "Complete",
                        message:
                          "Data Purchase successful and Record has been added",
                        user: userAccount,
                      });
                      return;
                    } else {
                      done = true;
                      clearTimeout(checkTiming);
                      res.status(201).json({
                        status: false,
                        purchase: "Success",
                        message:
                          "Data Purchase successful and Record was not added",
                        user: userAccount,
                      });
                      throw new Error(
                        "Data Purchase successful and Record wasn't saved "
                      );
                    }
                  }
                }
              })
              // UNKNOWN ERROR
              .catch((error) => {
                done = true;
                clearTimeout(checkTiming);
                console.log(error);
                res.status(400).json({
                  status: false,
                  failCode: "data05",
                  purchase: "Failed",
                  message: "Data Purchase failed",
                });
                return;
              });

            // Continues normally from here
          } else if (
            response.data.status === "error" &&
            response.data.message !=
              `We couldn't process your order because the number(s) ${phoneNumber}, is not ${
                nId === 1
                  ? "Mtn"
                  : nId === 2
                  ? "Airtel"
                  : nId === 3
                  ? "Glo"
                  : nId === 4
                  ? "9mobile"
                  : ""
              } number(s) `
          ) {
            // UPDATE RECORD FOR FAILED

            storedData.status = "Failed";

            // RETURN MONEY TO BALANCE
            await updateBalance(true);

            if (pending) {
              // UPDATE TRANSACTION STATUS
              const record = await updateRecord(storedData);
            } else {
              // CREATE TRANSACTION STATUS
              const record = createRecord(storedData);

              if (record) {
                done = true;
                clearTimeout(checkTiming);
                res.status(201).json({
                  status: false,
                  failCode: "data01",
                  purchase: "Failed",
                  message: "Data Purchase failed and Record has been added",
                });
                return;
              } else {
                done = true;
                clearTimeout(checkTiming);
                res.status(201).json({
                  status: false,
                  failCode: "data02",
                  purchase: "Failed",
                  message: "Data Purchase failed and Record was not added",
                });

                throw new Error(
                  "Data Purchase failed and Record wasn't saved "
                );
              }
            }
          } else if (response.data.status === "success") {
            // UPDATE RECORD
            storedData.status = "Success";

            if (pending) {
              // UPDATE TRANSACTION STATUS
              const record = await updateRecord(storedData);
            } else {
              const record = await createRecord(storedData);

              if (record) {
                done = true;
                clearTimeout(checkTiming);
                res.status(200).json({
                  status: true,
                  purchase: "Complete",
                  message: "Data Purchase successful and Record has been added",
                  user: userAccount,
                });
                return;
              } else {
                done = true;
                clearTimeout(checkTiming);
                res.status(201).json({
                  status: false,
                  purchase: "Success",
                  message: "Data Purchase successful and Record was not added",
                  user: userAccount,
                });
                throw new Error(
                  "Data Purchase successful and Record wasn't saved "
                );
              }
            }
          } else {
            done = true;
            clearTimeout(checkTiming);
            res.status(400).json({
              status: false,
              failCode: "data06",
              purchase: "Failed",
              message: "Data Purchase failed",
            });
            return;
          }
        })
        .catch((error) => {
          done = true;
          clearTimeout(checkTiming);
          console.log(error);
          res.status(400).json({
            status: false,
            failCode: "data05",
            purchase: "Failed",
            message: "Data Purchase failed",
          });
          return;
        });
    } else {
      return res.status(201).json({
        status: false,
        failCode: "data08",
        purchase: "Failed",
        message: "Data Purchase failed, Something went wrong.",
      });
    }
  }
});

const buyTv = asyncHandler(async (req, res) => {
  const body = req.body;
  const selectedTv = body.selectedTv;
  const subscriptionNumber = body.subscriptionNumber;
  const subscriptionCode = body.subscriptionCode;
  const customer = body.customer;
  const id = body.transactionId;
  const userId = body.userId;
  const pin = body.pin;
  const amount = body.subscriptionPrice;

  const setTv = selectedTv.toLowerCase();
  const subTvName =
    setTv == "startimes"
      ? ""
      : setTv == "gotv"
      ? "GOTV|"
      : setTv == "dstv"
      ? "DSTV|"
      : "";

  const nigeriaOptions = { timeZone: "Africa/Lagos" };

  const apiUrl = `${process.env.API_URL}/cable/pay`;
  const apiKey = process.env.API_KEY;
  const userAccount = await User.findById(userId);

  const subAmount = Number(amount);

    let storedData = {
        user: userId,
        transactionId: id,
        dateofTransaction: new Date()?.toLocaleString(
        "en-US",
        nigeriaOptions
        ),
        productName: "Tv",
        productType: selectedTv,
        planName: selectedSubscription,
        amount: `-${subscriptionPrice}`,
        customerName: customer,
        status: "Pending",
    };

  const createRecord = async (data) => {
    const {
      dateofTransaction,
      productName,
      productType,
      token,
      amount,
      transactionId,
      user,
      status,
      customerName,
      meterType,
      meterNumber,
      planName,
      phoneNumber,
      transferDetails,
    } = data;

    const thisRecord = await Record.create({
      user,
      dateofTransaction,
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
      phoneNumber,
      transferDetails,
    });
    return thisRecord;
  };

  const updateBalance = async (returnMoney) => {
    if (returnMoney) {
      userAccount.balance = userAccount.balance + subAmount;
    } else {
      userAccount.balance = userAccount.balance - subAmount;
    }
    return await userAccount.save();
  };

  const updateRecord = async (data) => {
    const pendingTransactionId = data.transactionId;
    const pendingTransaction = await Record.findById(pendingTransactionId);

    pendingTransaction.status = data.status;

    await pendingTransaction.save();
  };

  if (userAccount.balance < subAmount) {
    return res.status(201).json({
      status: false,
      failCode: "tv03",
      purchase: "Failed",
      message: "Tv Subscription Purchase failed Insufficient Balance!",
      user: userAccount,
    });
  } else if (userAccount.pin != pin) {
    return res.status(201).json({
      status: false,
      failCode: "tv04",
      purchase: "Failed",
      message: "Tv Subscription Purchase failed Incorrect Pin!",
    });
  } else {
    if (updateBalance()) {
      const bodyData = new FormData();
      bodyData.append("network_name", `${selectedTv.toLowerCase()}`);
      bodyData.append("smart_card_number", `${subscriptionNumber}`);
      bodyData.append(
        "plan",
        `${setTv}${subscriptionCode}::${subscriptionPrice}`
      );
      bodyData.append("registered_name", `${customer}`);

      let done = false;
      let pending;

      const checkTiming = setTimeout(async () => {
        if (done) {
          clearTimeout(checkTiming);
        } else {
          pending = true;

          storedData.status = "Pending";

          await createRecord(storedData);

          return res.status(201).json({
            status: false,
            failCode: "tv06",
            purchase: "Pending",
            message: "Tv subscription Purchase pending",
            user: userAccount,
          });
        }
      }, 60000);

      await axios
        .post(apiUrl, bodyData, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "multipart/form-data",
          },
        })
        .then(async (response) => {
            console.log(response.data);

                // UNKNOWN ERROR
                if (response.data.status === "error") {
                  // UPDATE RECORD FOR FAILED
                  storedData.status = "Failed";

                  // RETURN MONEY TO BALANCE
                  await updateBalance(true);

                  if (pending) {
                    // UPDATE TRANSACTION STATUS
                    const record = await updateRecord(storedData);
                  } else {
                    const record = await createRecord(storedData);

                    if (record) {
                      done = true;
                      clearTimeout(checkTiming);

                      res.status(201).json({
                        status: false,
                        failCode: "tv01",
                        purchase: "Failed",
                        message:
                          "Tv Subscription Purchase failed and Record has been added",
                      });
                      return;
                    } else {
                      done = true;
                      clearTimeout(checkTiming);
                      res.status(201).json({
                        status: false,
                        failCode: "tv02",
                        purchase: "Failed",
                        message:
                          "Tv Subscription Purchase failed and Record was not added",
                      });

                      throw new Error(
                        "Tv Subscription Purchase failed and Record wasn't saved "
                      );
                    }
                  }
                } else if (response.data.status === "success") {
                  // UPDATE RECORD
                  storedData.status = "Success";

                  if (pending) {
                    // UPDATE TRANSACTION STATUS
                    const record = await updateRecord(storedData);
                  } else {
                    const record = await createRecord(storedData);

                    if (record) {
                      done = true;
                      clearTimeout(checkTiming);
                      res.status(200).json({
                        status: true,
                        purchase: "Complete",
                        message:
                          "Tv Subscription Purchase successful and Record has been added",
                        user: userAccount,
                      });
                      return;
                    } else {
                      done = true;
                      clearTimeout(checkTiming);
                      res.status(201).json({
                        status: false,
                        purchase: "Success",
                        message:
                          "Tv Subscription Purchase successful and Record was not added",
                        user: userAccount,
                      });
                      throw new Error(
                        "Tv Subscription Purchase successful and Record wasn't saved "
                      );
                    }
                  }
                }
        })
        .catch((error) => {
          done = true;
          clearTimeout(checkTiming);
          console.log(error);
          res.status(400).json({
            status: false,
            failCode: "tv05",
            purchase: "Failed",
            message: "Tv subscription Purchase failed",
          });
          return;
        });

    } else {
      return res.status(201).json({
        status: false,
        failCode: "tv08",
        purchase: "Failed",
        message: "Tv subscription Purchase failed, Something went wrong.",
      });
    }
  }
});

const buyElectricity = asyncHandler(async (req, res) => {
  const body = req.body;
  const distributorId = body.distributorId;
  const selectedBillerType = body.selectedBillerType;
  const meterNumber = body.meterNumber;
  const phoneNumber = body.phoneNumber;
  const id = body.transactionId;
  const userId = body.userId;
  const pin = body.pin;
  const amount = body.amount;
  const customer = body.customer;

  const nigeriaOptions = { timeZone: "Africa/Lagos" };

  const apiUrl = `${process.env.API_URL}/electricity`;
  const apiKey = process.env.API_KEY;
  const userAccount = await User.findById(userId);

  const subAmount = Number(amount);

  let storedData = {
    user: userId,
    transactionId: id,
    dateofTransaction: new Date().toLocaleString(
        "en-US",
        nigeriaOptions
    ),
    productName: "Electricity Bill",
    productType: selectedBiller,
    amount: `-₦${Number(amount).toLocaleString()}`,
    customerName: customer,
    meterType: selectedBillerType,
    meterNumber: meterNumber,
    status: "Pending",
    };

  const createRecord = async (data) => {
    const {
      dateofTransaction,
      productName,
      productType,
      token,
      amount,
      transactionId,
      user,
      status,
      customerName,
      meterType,
      meterNumber,
      planName,
      phoneNumber,
      transferDetails,
    } = data;

    const thisRecord = await Record.create({
      user,
      dateofTransaction,
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
      phoneNumber,
      transferDetails,
    });
    return thisRecord;
  };

  const updateBalance = async (returnMoney) => {
    if (returnMoney) {
      userAccount.balance = userAccount.balance + subAmount;
    } else {
      userAccount.balance = userAccount.balance - subAmount;
    }
    return await userAccount.save();
  };

  const updateRecord = async (data) => {
    const pendingTransactionId = data.transactionId;
    const pendingTransaction = await Record.findById(pendingTransactionId);

    pendingTransaction.status = data.status;

    await pendingTransaction.save();
  };

  if (userAccount.balance < subAmount) {
    return res.status(201).json({
      status: false,
      failCode: "electricity03",
      purchase: "Failed",
      message: "Electricity Purchase failed Insufficient Balance!",
      user: userAccount,
    });
  } else if (userAccount.pin != pin) {
    return res.status(201).json({
      status: false,
      failCode: "electricity04",
      purchase: "Failed",
      message: "Electricity Purchase failed Incorrect Pin!",
    });
  } else {
    if (updateBalance()) {
    const bodyData = new FormData();
    bodyData.append("distributor_id", `${distributorId}`);
    bodyData.append("meter_number", `${meterNumber}`);
    bodyData.append("meter_type", selectedBillerType.toLowerCase());
    bodyData.append("amount", `${Number(amount).toLocaleString()}`);
    bodyData.append("phone_number", `${phoneNumber}`);

    
      let done = false;
      let pending;

      const checkTiming = setTimeout(async () => {
        if (done) {
          clearTimeout(checkTiming);
        } else {
          pending = true;

          storedData.status = "Pending";

          await createRecord(storedData);

          return res.status(201).json({
            status: false,
            failCode: "electeicity06",
            purchase: "Pending",
            message: "Electricity Purchase pending",
            user: userAccount,
          });
        }
      }, 60000);

    await axios
      .post(apiUrl, bodyData, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "multipart/form-data",
        },
      })
      .then(async (response) => {
        // UNKNOWN ERROR
        if (response.data.status === "error") {
            // UPDATE RECORD FOR FAILED
            storedData.status = "Failed";

            // RETURN MONEY TO BALANCE
            await updateBalance(true);

            if (pending) {
            // UPDATE TRANSACTION STATUS
            const record = await updateRecord(storedData);
            } else {
            const record = await createRecord(storedData);

            if (record) {
                done = true;
                clearTimeout(checkTiming);

                res.status(201).json({
                status: false,
                failCode: "electricity01",
                purchase: "Failed",
                message:
                    "Electricity Purchase failed and Record has been added",
                });
                return;
            } else {
                done = true;
                clearTimeout(checkTiming);
                res.status(201).json({
                status: false,
                failCode: "electricity02",
                purchase: "Failed",
                message:
                    "Electricity Purchase failed and Record was not added",
                });

                throw new Error(
                "Electricity Purchase failed and Record wasn't saved "
                );
            }
            }
        } else if (response.data.status === "success") {
            // UPDATE RECORD
            storedData.status = "Success";

            if (pending) {
            // UPDATE TRANSACTION STATUS
            const record = await updateRecord(storedData);
            } else {
            const record = await createRecord(storedData);

            if (record) {
                done = true;
                clearTimeout(checkTiming);
                res.status(200).json({
                status: true,
                purchase: "Complete",
                message:
                    "Electricity Purchase successful and Record has been added",
                user: userAccount,
                });
                return;
            } else {
                done = true;
                clearTimeout(checkTiming);
                res.status(201).json({
                status: false,
                purchase: "Success",
                message:
                    "Electricity Purchase successful and Record was not added",
                user: userAccount,
                });
                throw new Error(
                "Electricity Purchase successful and Record wasn't saved "
                );
            }
            }
        }
      })
      .catch((error) => {
          done = true;
          clearTimeout(checkTiming);
          console.log(error);
          res.status(400).json({
            status: false,
            failCode: "electricity05",
            purchase: "Failed",
            message: "Electricity Purchase failed",
          });
          return;
      });
      
    } else {
      return res.status(201).json({
        status: false,
        failCode: "electricity08",
        purchase: "Failed",
        message: "Electricity Purchase failed, Something went wrong.",
      });
    }
  }
});

module.exports = {
  createRecord,
  getAllRecords,
  getRecord,
  confirmRecord,
  startTransfer,
  buyAirtime,
  buyData,
  buyTv,
  buyElectricity,
  verifyDeposit,
};
