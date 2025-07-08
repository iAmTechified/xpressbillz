const express = require('express')
const router = express.Router();
const {protect} = require('../middleware/authMiddleWare');


const {createRecord, getAllRecords, getRecord, startTransfer, buyAirtime, confirmRecord} = require('../controllers/transactionController')
const { createTempAccount, getTempAccount } = require('../controllers/tempAccountController');
// Create a temporary transfer account for deposit
router.post('/temp-account', protect, createTempAccount);
// Get latest pending temp account for user
router.get('/temp-account/:userId', protect, getTempAccount);

router.post('/createRecord', protect, createRecord);
router.post('/confirmRecord', protect, confirmRecord);
router.post('/startTransfer', protect, startTransfer);
router.post('/buyAirtime', protect, buyAirtime);
router.get('/records/:id', protect, getAllRecords);
router.get('/record/:userId/:transactionId', protect, getRecord)

module.exports = router;

// whne I use  my airtel line 105.112.210.22 (ip address)
// when i use my mtn line 102.90.65.150 (ip address)