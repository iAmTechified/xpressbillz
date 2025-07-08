const express = require('express')
const router = express.Router();
const {protect} = require('../middleware/authMiddleWare');


const {registerUser, loginUser, getMe, getEmailAndPhone, changeInfo, changePin, changeBalance, syncUserBalance } = require('../controllers/userController')
const { getXpressAccount } = require('../controllers/xpressAccountController');
// Get user's xpress account (DVA)
router.get('/xpress-account/:userId', protect, getXpressAccount);

router.post('/register', registerUser)

router.post('/login', loginUser );

router.post('/me', protect, getMe);

router.get('/checkEmailAndPhone', protect, getEmailAndPhone);

router.put('/changeInfo', protect, changeInfo);

router.put('/changePin', protect, changePin);

router.put('/changeBalance', protect, changeBalance);

// Sync user balance and transactions with Paystack
router.get('/sync-balance', protect, syncUserBalance);

module.exports = router;