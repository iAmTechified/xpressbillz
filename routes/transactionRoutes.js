const express = require('express')
const router = express.Router();
const {protect} = require('../middleware/authMiddleWare');

const {createRecord, getAllRecords, getRecord } = require('../controllers/transactionController')

router.post('/createRecord', protect, createRecord);
router.get('/records/:id', protect, getAllRecords);
router.get('/record/:userId/:transactionId', protect, getRecord)

module.exports = router;

// whne I use  my airtel line 105.112.210.22 (ip address)
// when i use my mtn line 102.90.65.150 (ip address)