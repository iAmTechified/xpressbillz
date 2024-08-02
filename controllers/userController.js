const asyncHandler = require('express-async-handler');
const User = require('../models/userModel');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');


const registerUser = asyncHandler(async(req, res) => {

    const {username, password, email, gender,  phoneNumber, pin} = req.body;

    if(!username || !password || !email || !phoneNumber ||!gender || !pin ){
        res.status(400).json({
            success:false,
            error:'Please Add All Fields'
        });
        return;
        // throw new Error('Please add all fields')
    } 

    const userExists = await User.findOne({email})
    const usernameExits = await User.findOne({username})

    //check if user exists 
    if(userExists){
        res.status(400).json({
            success:false,
            error:'Email Already Exists'
        });
        // throw new Error('User already exists');
    }else if(usernameExits){
        res.status(400).json({
            success:false,
            error:'USername Already Exists'
        }); 
    }

    //hash the pin 
    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(password, salt)

    
    const user = await User.create({
        username,
        password:hashPassword,
        email,
        gender,
        phoneNumber, 
        pin
    });

    if(user){
        res.status(201).json({
            _id: user.id,
            username:user.username,            
            email:user.email,
            pin:user.pin,
            balance:user.balance,
            gender:user.gender,
            phoneNumber:user.phoneNumber,
            token:generateToken(user._id)
        })
    } else {
        res.status(400)
        throw new Error('Invalid Credentials')
    }
});

//to login a user 
const loginUser = asyncHandler(async(req, res) => {
console.log(req.body)
    const {email, password} = req.body;

    const user = await User.findOne({email})

    if (user && (await (bcrypt.compare(password, user.password)))){
        res.json({
            _id: user.id,
            username:user.username,            
            email:user.email,
            pin:user.pin,
            balance:user.balance,
            gender:user.gender,
            phoneNumber:user.phoneNumber,          
            token:generateToken(user._id)
        }) 
    }else{
        res.status(400).json({
            message: "Invalid user data"
        })
        // throw new Error('Invalid user data')
    }
});

const getMe = asyncHandler(async(req, res) => {
    const {_id, username, email, pin} = await User.findById(req.user.id);

    res.status(200).json({
        id:_id,
        username, 
        email,
        gender,
        pin,
    })
})

const changeInfo = asyncHandler(async(req, res) => {
    const {email, username, oldPassword, newPassword} = req.body;

    if (!email && !username && !oldPassword && !newPassword && !pin) {
        res.status(400).json({
            success: false,
            message: 'No update information provided'
        });
        return;
    }
    const user = await User.findOne({email});

    if (!user) {
        res.status(404).json({
            success: false,
            message: 'User not found'
        });
        return;
    }
    
    let passwordChanged = false;

    if (oldPassword && newPassword) {
        if (await bcrypt.compare(oldPassword, user.password)) {
            const salt = await bcrypt.genSalt(10);
            const hashedNewPassword = await bcrypt.hash(newPassword, salt);
            user.password = hashedNewPassword;
            passwordChanged = true;
        } else {
            res.status(400).json({
                success: false,
                message: 'The old password is incorrect'
            });
            return;
        }
    }
    if (username) {
        user.username = username;
    }

    if (email) {
        user.email = email;
    }

    await user.save();

    res.status(200).json({
        success: true,
        message: 'User information updated successfully',
        passwordChanged
    });

});

const changePin = asyncHandler(async (req, res) => {
    const { email, pin } = req.body;
  
    if (!email || !pin) {
      return res.status(400).json({
        success: false,
        message: 'Email and pin are required',
      });
    }
  
    const user = await User.findOne({ email });
  
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }
  
    user.pin = pin;
  
    await user.save();
  
    res.status(200).json({
      success: true,
      message: 'Pin updated successfully',
    });
  });

const changeBalance = asyncHandler(async(req, res) => {
    console.log(req.body);
    const {email, balance} = req.body;

    const user = await User.findOne({ email });

    if (!email || !balance) {
        return res.status(400).json({
          success: false,
          message: 'Email and pin are required',
        });
      }

      user.balance = balance;
  
      await user.save();
    
      res.status(200).json({
        success: true,
        message: 'balance has been updated',
      });
})
  




//Generate JWT
const generateToken = (id) => {
    return jwt.sign({id}, process.env.JWT_SECRET, {
        expiresIn:'20h'
    })
}

module.exports ={
    registerUser,
    loginUser,
    getMe,
    changeInfo,
    changePin,
    changeBalance
}