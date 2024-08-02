const express = require('express')
const router = express.Router();
const {protect} = require('../middleware/authMiddleWare');

const {registerUser, loginUser, getMe, changeInfo, changePin, changeBalance } = require('../controllers/userController')




router.post('/register', registerUser)

router.post('/login', loginUser );

router.get('/me', protect, getMe)

router.put('/changeInfo', protect, changeInfo);

router.put('/changePin', protect, changePin);

router.put('/changeBalance', protect, changeBalance);

module.exports = router;