const asyncHandler = require("express-async-handler");
const axios = require("axios");
const User = require("../models/userModel");

// GET /api/user/xpress-account/:userId
const getXpressAccount = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ status: false, message: "Missing userId" });

  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ status: false, message: "User not found" });

  // If already set, return
  if (user.xpressAccountNumber && user.xpressAccountName && user.xpressAccountBank) {
    return res.status(200).json({
      status: true,
      account: {
        accountNumber: user.xpressAccountNumber,
        accountName: user.xpressAccountName,
        accountBank: user.xpressAccountBank,
      },
      inProgress: false,
    });
  }

  // Helper: Save DVA to user
  const saveDVA = async (dva) => {
    user.xpressAccountNumber = dva.account_number;
    user.xpressAccountName = dva.account_name;
    user.xpressAccountBank = dva.bank.name;
    await user.save();
    return {
      accountNumber: dva.account_number,
      accountName: dva.account_name,
      accountBank: dva.bank.name,
    };
  };

  // Helper: Get or create Paystack customer
  const getOrCreatePaystackCustomer = async () => {
    if (user.paystackCustomerId) return user.paystackCustomerId;
    // Try to find by email
    let customerId = null;
    try {
      const searchRes = await axios.get(
        `https://api.paystack.co/customer?email=${encodeURIComponent(user.email)}`,
        { headers: { Authorization: `Bearer ${process.env.PAYSTACK_KEY}` } }
      );
      if (searchRes.data && searchRes.data.data && searchRes.data.data.length > 0) {
        customerId = searchRes.data.data[0].customer_code || searchRes.data.data[0].id;
      }
    } catch (e) {}
    if (!customerId) {
      // Create customer
      const createRes = await axios.post(
        `https://api.paystack.co/customer`,
        { email: user.email, first_name: user.firstName, last_name: user.lastName, phone: user.phoneNumber },
        { headers: { Authorization: `Bearer ${process.env.PAYSTACK_KEY}` } }
      );
      customerId = createRes.data.data.customer_code || createRes.data.data.id;
    }
    user.paystackCustomerId = customerId;
    await user.save();
    return customerId;
  };

  // Helper: Get or create DVA
  const getOrCreateDVA = async (customerId) => {
    // Check for existing DVA
    let dva = null;
    try {
      const dvaRes = await axios.get(
        `https://api.paystack.co/dedicated_account?customer=${customerId}`,
        { headers: { Authorization: `Bearer ${process.env.PAYSTACK_KEY}` } }
      );
      if (dvaRes.data && dvaRes.data.data && dvaRes.data.data.length > 0) {
        dva = dvaRes.data.data[0];
        return { dva, created: false };
      }
    } catch (e) {}
    // Create DVA
    try {
      const createRes = await axios.post(
        `https://api.paystack.co/dedicated_account`,
        { customer: customerId, preferred_bank: "wema-bank" },
        { headers: { Authorization: `Bearer ${process.env.PAYSTACK_KEY}` } }
      );
      if (createRes.data && createRes.data.data) {
        dva = createRes.data.data;
        if (dva.account_number && dva.account_name && dva.bank) {
          return { dva, created: true };
        } else if (createRes.data.message && createRes.data.message.toLowerCase().includes("in progress")) {
          return { inProgress: true };
        }
      }
    } catch (e) {
      if (e.response && e.response.data && e.response.data.status === false && e.response.data.message && e.response.data.message.toLowerCase().includes("in progress")) {
        return { inProgress: true };
      }
    }
    return { inProgress: true };
  };

  // Main logic
  const customerId = await getOrCreatePaystackCustomer();
  if (!customerId) return res.status(500).json({ status: false, message: "Could not get or create Paystack customer" });

  const dvaResult = await getOrCreateDVA(customerId);
  if (dvaResult.inProgress) {
    return res.status(202).json({ status: true, inProgress: true, message: "DVA creation in progress" });
  }
  if (dvaResult.dva) {
    const account = await saveDVA(dvaResult.dva);
    return res.status(200).json({ status: true, account, inProgress: false });
  }
  return res.status(500).json({ status: false, message: "Could not get or create DVA" });
});

module.exports = { getXpressAccount };
