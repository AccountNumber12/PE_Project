const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Get port from environment or default to 3000
const PORT = process.env.PORT || 3000;

// CORS configuration for production
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? process.env.FRONTEND_URL || true 
        : "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
};

const io = socketIo(server, {
    cors: corsOptions
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(cors(corsOptions));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Environment check
console.log('ENVIRONMENT CHECK:');
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('PORT:', PORT);
console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'SET' : 'NOT SET');

// Cloudinary configuration - only if credentials are provided
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    console.log('[SUCCESS] Cloudinary configured successfully');
} else {
    console.log('[WARNING] Cloudinary credentials not found - image uploads will be skipped');
}

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    displayName: { type: String, required: true }, // New field for display name
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// Notification Schema
const notificationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { 
        type: String, 
        required: true,
        enum: ['outbid', 'auction_won', 'buy_now_purchase', 'auction_ended_seller']
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    auctionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Auction', required: true },
    auctionTitle: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// Auction Item Schema
const auctionSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    images: [{ type: String }],
    startingPrice: { type: Number, required: true, min: 0 },
    hammerPrice: { type: Number }, // Buy now price
    currentBid: { type: Number, default: 0 },
    highestBidder: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    duration: { type: Number, required: true }, // in days
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    bids: [{
        bidder: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        amount: { type: Number },
        timestamp: { type: Date, default: Date.now }
    }]
});

// Bid Schema
const bidSchema = new mongoose.Schema({
    auction: { type: mongoose.Schema.Types.ObjectId, ref: 'Auction', required: true },
    bidder: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const Auction = mongoose.model('Auction', auctionSchema);
const Bid = mongoose.model('Bid', bidSchema);

// Helper function to create notifications
async function createNotification(userId, type, title, message, auctionId, auctionTitle) {
    try {
        const notification = new Notification({
            user: userId,
            type,
            title,
            message,
            auctionId,
            auctionTitle
        });
        
        await notification.save();
        
        // Emit real-time notification
        io.to(`user_${userId}`).emit('newNotification', {
            id: notification._id,
            type,
            title,
            message,
            auctionId,
            auctionTitle,
            isRead: false,
            createdAt: notification.createdAt
        });
        
        console.log(`[NOTIFICATION] Created ${type} notification for user ${userId}: ${title}`);
        return notification;
    } catch (error) {
        console.error('[NOTIFICATION] Error creating notification:', error);
    }
}

// Auto-create single admin account from .env on startup
async function createAdminFromEnv() {
    try {
        console.log('[ADMIN] Checking for admin credentials...');
        
        if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
            console.log('[ADMIN] No admin credentials found in environment variables');
            console.log('[ADMIN] Add ADMIN_USERNAME and ADMIN_PASSWORD to your environment variables');
            return;
        }
        
        console.log('[ADMIN] Found admin credentials in environment');
        console.log('[ADMIN] Username:', process.env.ADMIN_USERNAME);
        
        const existingAdmin = await User.findOne({ username: process.env.ADMIN_USERNAME });
        if (existingAdmin) {
            console.log('[ADMIN] Admin account already exists in database');
            console.log('[ADMIN] Admin status:', existingAdmin.isAdmin);
            
            // Make sure they have admin privileges and display name
            let updated = false;
            if (!existingAdmin.isAdmin) {
                existingAdmin.isAdmin = true;
                updated = true;
                console.log('[ADMIN] Updated existing user to admin');
            }
            if (!existingAdmin.displayName) {
                existingAdmin.displayName = existingAdmin.username;
                updated = true;
                console.log('[ADMIN] Added display name to existing admin');
            }
            if (updated) {
                await existingAdmin.save();
            }
            return;
        }
        
        console.log('[ADMIN] Creating new admin account...');
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, salt);
        
        const adminUser = new User({
            username: process.env.ADMIN_USERNAME,
            displayName: process.env.ADMIN_DISPLAY_NAME || process.env.ADMIN_USERNAME, // Use display name from env or fallback to username
            email: `${process.env.ADMIN_USERNAME}@vgvault.local`,
            password: hashedPassword,
            isAdmin: true
        });
        
        await adminUser.save();
        console.log('[ADMIN] Admin account created successfully!');
        console.log('[ADMIN] Display name:', adminUser.displayName);
        console.log('[ADMIN] You can now login with your credentials');
        
    } catch (error) {
        console.error('[ADMIN] Error creating admin:', error.message);
    }
}

// Migration function to add display names to existing users
async function migrateExistingUsers() {
    try {
        console.log('[MIGRATION] Checking for users without display names...');
        
        // Find users without displayName field
        const usersWithoutDisplayName = await User.find({ 
            $or: [
                { displayName: { $exists: false } },
                { displayName: null },
                { displayName: '' }
            ]
        });
        
        if (usersWithoutDisplayName.length === 0) {
            console.log('[MIGRATION] All users already have display names');
            return;
        }
        
        console.log(`[MIGRATION] Found ${usersWithoutDisplayName.length} users without display names`);
        
        // Update each user to have their username as their display name
        for (const user of usersWithoutDisplayName) {
            user.displayName = user.username;
            await user.save();
            console.log(`[MIGRATION] Updated user ${user.username} with display name: ${user.displayName}`);
        }
        
        console.log('[MIGRATION] Migration completed successfully');
        
    } catch (error) {
        console.error('[MIGRATION] Error during user migration:', error.message);
    }
}

// MongoDB connection with better error handling
const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vgvault';
        console.log('[DATABASE] Connecting to MongoDB...');
        
        await mongoose.connect(mongoURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        
        console.log('[DATABASE] Connected to MongoDB successfully');
        
        // Create admin after database connection
        await createAdminFromEnv();
        
        // Migrate existing users to have display names
        await migrateExistingUsers();
        
    } catch (error) {
        console.error('[DATABASE] MongoDB connection error:', error);
        // Don't exit in production, just log the error
        if (process.env.NODE_ENV !== 'production') {
            process.exit(1);
        }
    }
};

// Connect to database
connectDB();

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ message: 'Access denied' });
    }

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_change_in_production');
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).json({ message: 'Invalid token' });
    }
};

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Helper function to calculate minimum increment
const calculateMinimumIncrement = (startingPrice, currentBid) => {
    const basePrice = currentBid > 0 ? currentBid : startingPrice;
    const tenPercent = Math.ceil(basePrice * 0.1);
    return Math.max(1, tenPercent);
};

// Routes

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime()
    });
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Authentication routes
app.post('/api/register', async (req, res) => {
    try {
        const { username, displayName, email, password } = req.body;
        
        // Validate input
        if (!username || !displayName || !email || !password) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        
        // Check if user exists
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user
        const user = new User({
            username,
            displayName,
            email,
            password: hashedPassword
        });

        await user.save();

        // Create token
        const token = jwt.sign(
            { 
                userId: user._id, 
                username: user.username, 
                displayName: user.displayName,
                isAdmin: user.isAdmin 
            },
            process.env.JWT_SECRET || 'fallback_secret_change_in_production',
            { expiresIn: '24h' }
        );

        res.cookie('token', token, { 
            httpOnly: true, 
            maxAge: 24 * 60 * 60 * 1000,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
        });
        res.json({ 
            message: 'User created successfully', 
            user: { 
                username: user.username, 
                displayName: user.displayName,
                isAdmin: user.isAdmin 
            } 
        });
    } catch (error) {
        console.error('[AUTH] Registration error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('[AUTH] Login attempt for username:', username);

        // Validate input
        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required' });
        }

        // Find user
        const user = await User.findOne({ username });
        if (!user) {
            console.log('[AUTH] User not found:', username);
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        console.log('[AUTH] User found in database');

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            console.log('[AUTH] Invalid password');
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        console.log('[AUTH] Password valid');

        // Create token with display name
        const token = jwt.sign(
            { 
                userId: user._id, 
                username: user.username, 
                displayName: user.displayName,
                isAdmin: user.isAdmin 
            },
            process.env.JWT_SECRET || 'fallback_secret_change_in_production',
            { expiresIn: '24h' }
        );

        console.log('[AUTH] Token created');

        res.cookie('token', token, { 
            httpOnly: true, 
            maxAge: 24 * 60 * 60 * 1000,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
        });
        res.json({ 
            message: 'Login successful', 
            user: { 
                username: user.username, 
                displayName: user.displayName,
                isAdmin: user.isAdmin 
            } 
        });
        
        console.log('[AUTH] Login successful for:', username, '(Display:', user.displayName, ', Admin:', user.isAdmin, ')');
    } catch (error) {
        console.error('[AUTH] Login error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
});

// Check auth status
app.get('/api/auth-status', (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.json({ authenticated: false });
    }

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_change_in_production');
        res.json({ 
            authenticated: true, 
            user: { 
                username: verified.username,
                displayName: verified.displayName, 
                isAdmin: verified.isAdmin,
                userId: verified.userId 
            } 
        });
    } catch (err) {
        res.json({ authenticated: false });
    }
});

// Notification routes
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const notifications = await Notification.find({ user: req.user.userId })
            .sort({ createdAt: -1 })
            .limit(50);
        
        res.json(notifications);
    } catch (error) {
        console.error('[NOTIFICATION] Error loading notifications:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user.userId },
            { isRead: true },
            { new: true }
        );
        
        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }
        
        res.json(notification);
    } catch (error) {
        console.error('[NOTIFICATION] Error marking notification as read:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.put('/api/notifications/mark-all-read', authenticateToken, async (req, res) => {
    try {
        await Notification.updateMany(
            { user: req.user.userId, isRead: false },
            { isRead: true }
        );
        
        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error('[NOTIFICATION] Error marking all notifications as read:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.get('/api/notifications/unread-count', authenticateToken, async (req, res) => {
    try {
        const count = await Notification.countDocuments({ 
            user: req.user.userId, 
            isRead: false 
        });
        
        res.json({ count });
    } catch (error) {
        console.error('[NOTIFICATION] Error getting unread count:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Auction routes
app.get('/api/auctions', async (req, res) => {
    try {
        const auctions = await Auction.find({ isActive: true })
            .populate('seller', 'username displayName')
            .populate('highestBidder', 'username displayName')
            .sort({ createdAt: -1 })
            .limit(100); // Limit for performance
        res.json(auctions);
    } catch (error) {
        console.error('[AUCTION] Error loading auctions:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.get('/api/auctions/:id', async (req, res) => {
    try {
        const auction = await Auction.findById(req.params.id)
            .populate('seller', 'username displayName')
            .populate('highestBidder', 'username displayName')
            .populate('bids.bidder', 'username displayName');
        
        if (!auction) {
            return res.status(404).json({ message: 'Auction not found' });
        }

        res.json(auction);
    } catch (error) {
        console.error('[AUCTION] Error loading auction detail:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/auctions', authenticateToken, upload.array('images', 5), async (req, res) => {
    try {
        const { title, description, startingPrice, hammerPrice, duration } = req.body;
        
        // Validate input
        if (!title || !description || !startingPrice || !duration) {
            return res.status(400).json({ message: 'All required fields must be filled' });
        }
        
        // Upload images to Cloudinary only if configured
        const imageUrls = [];
        if (req.files && req.files.length > 0 && process.env.CLOUDINARY_CLOUD_NAME) {
            try {
                for (const file of req.files) {
                    const result = await new Promise((resolve, reject) => {
                        cloudinary.uploader.upload_stream(
                            { 
                                resource_type: 'image',
                                transformation: [
                                    { width: 800, height: 600, crop: 'limit' },
                                    { quality: 'auto' }
                                ]
                            },
                            (error, result) => {
                                if (error) reject(error);
                                else resolve(result);
                            }
                        ).end(file.buffer);
                    });
                    imageUrls.push(result.secure_url);
                }
            } catch (cloudinaryError) {
                console.error('[CLOUDINARY] Upload error:', cloudinaryError);
                // Continue without images rather than failing completely
                console.log('[CLOUDINARY] Continuing auction creation without images');
            }
        } else if (req.files && req.files.length > 0) {
            console.log('[CLOUDINARY] Images were uploaded but Cloudinary is not configured - skipping image upload');
        }

        // Calculate end date
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + parseInt(duration));

        const auction = new Auction({
            title,
            description,
            images: imageUrls,
            startingPrice: parseFloat(startingPrice),
            hammerPrice: hammerPrice ? parseFloat(hammerPrice) : undefined,
            duration: parseInt(duration),
            endDate,
            seller: req.user.userId,
            currentBid: parseFloat(startingPrice)
        });

        await auction.save();
        
        if (imageUrls.length === 0 && req.files && req.files.length > 0) {
            res.json({ 
                message: 'Auction created successfully (images were skipped - Cloudinary not configured)', 
                auction 
            });
        } else {
            res.json({ message: 'Auction created successfully', auction });
        }
    } catch (error) {
        console.error('[AUCTION] Creation error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Bidding routes
app.post('/api/auctions/:id/bid', authenticateToken, async (req, res) => {
    try {
        const { amount } = req.body;
        const auctionId = req.params.id;
        const userId = req.user.userId;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Invalid bid amount' });
        }

        const auction = await Auction.findById(auctionId);
        if (!auction || !auction.isActive) {
            return res.status(400).json({ message: 'Auction not found or inactive' });
        }

        // Check if auction has ended
        if (new Date() > auction.endDate) {
            auction.isActive = false;
            await auction.save();
            return res.status(400).json({ message: 'Auction has ended' });
        }

        // Check if user is the seller
        if (auction.seller.toString() === userId) {
            return res.status(400).json({ message: 'You cannot bid on your own auction' });
        }

        // Calculate minimum bid
        const minIncrement = calculateMinimumIncrement(auction.startingPrice, auction.currentBid);
        const minBid = auction.currentBid + minIncrement;

        if (amount < minBid) {
            return res.status(400).json({ 
                message: `Minimum bid is $${minBid}`,
                minBid 
            });
        }

        // Store previous highest bidder for notification
        const previousHighestBidder = auction.highestBidder;

        // Update auction
        auction.currentBid = amount;
        auction.highestBidder = userId;
        auction.bids.push({
            bidder: userId,
            amount: amount
        });

        await auction.save();

        // Create bid record
        const bid = new Bid({
            auction: auctionId,
            bidder: userId,
            amount: amount
        });
        await bid.save();

        // Create notification for previous highest bidder (outbid notification)
        if (previousHighestBidder && previousHighestBidder.toString() !== userId) {
            await createNotification(
                previousHighestBidder,
                'outbid',
                'You have been outbid!',
                `Someone has placed a higher bid of $${amount.toFixed(2)} on "${auction.title}". Place a new bid to stay in the game!`,
                auctionId,
                auction.title
            );
        }

        // Emit socket event for real-time updates with display name
        io.emit('bidUpdate', {
            auctionId,
            currentBid: amount,
            highestBidder: req.user.username, // Keep for compatibility
            highestBidderDisplay: req.user.displayName || req.user.username // New field for display
        });

        res.json({ message: 'Bid placed successfully', currentBid: amount });
    } catch (error) {
        console.error('[BID] Error placing bid:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Buy now route
app.post('/api/auctions/:id/buy-now', authenticateToken, async (req, res) => {
    try {
        const auctionId = req.params.id;
        const userId = req.user.userId;

        const auction = await Auction.findById(auctionId);
        if (!auction || !auction.isActive) {
            return res.status(400).json({ message: 'Auction not found or inactive' });
        }

        if (!auction.hammerPrice) {
            return res.status(400).json({ message: 'Buy now not available for this auction' });
        }

        // Check if user is the seller
        if (auction.seller.toString() === userId) {
            return res.status(400).json({ message: 'You cannot buy your own auction' });
        }

        // End auction with buy now
        auction.currentBid = auction.hammerPrice;
        auction.highestBidder = userId;
        auction.isActive = false;
        auction.bids.push({
            bidder: userId,
            amount: auction.hammerPrice
        });

        await auction.save();

        // Create bid record
        const bid = new Bid({
            auction: auctionId,
            bidder: userId,
            amount: auction.hammerPrice
        });
        await bid.save();

        // Create notification for seller (buy now purchase)
        await createNotification(
            auction.seller,
            'buy_now_purchase',
            'Your item was purchased!',
            `${req.user.displayName || req.user.username} purchased "${auction.title}" using Buy Now for $${auction.hammerPrice.toFixed(2)}!`,
            auctionId,
            auction.title
        );

        // Create notification for buyer (auction won)
        await createNotification(
            userId,
            'auction_won',
            'Congratulations! You won an auction!',
            `You successfully purchased "${auction.title}" for $${auction.hammerPrice.toFixed(2)} using Buy Now!`,
            auctionId,
            auction.title
        );

        // Emit socket event with display name
        io.emit('auctionEnded', {
            auctionId,
            winner: req.user.displayName || req.user.username,
            finalPrice: auction.hammerPrice
        });

        res.json({ message: 'Item purchased successfully!', finalPrice: auction.hammerPrice });
    } catch (error) {
        console.error('[BUY_NOW] Error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// User dashboard routes
app.get('/api/user/bids', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const bids = await Bid.find({ bidder: userId })
            .populate({
                path: 'auction',
                select: 'title currentBid isActive endDate seller',
                populate: {
                    path: 'seller',
                    select: 'username displayName'
                }
            })
            .sort({ timestamp: -1 })
            .limit(50); // Limit for performance

        // Filter out bids where auction was deleted (auction will be null)
        const validBids = bids.filter(bid => bid.auction !== null);
        
        console.log(`[DASHBOARD] Found ${bids.length} total bids, ${validBids.length} valid bids for user: ${req.user.username}`);

        res.json(validBids);
    } catch (error) {
        console.error('[DASHBOARD] Error loading user bids:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.get('/api/user/listings', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const auctions = await Auction.find({ seller: userId })
            .populate('highestBidder', 'username displayName')
            .sort({ createdAt: -1 })
            .limit(50); // Limit for performance

        console.log(`[DASHBOARD] Found ${auctions.length} listings for user: ${req.user.username}`);

        res.json(auctions);
    } catch (error) {
        console.error('[DASHBOARD] Error loading user listings:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Helper function to completely delete auction and cleanup
async function completelyDeleteAuction(auctionId, reason = 'Deleted') {
    try {
        console.log(`[DELETE] Starting complete deletion of auction: ${auctionId}`);
        console.log(`[DELETE] Reason: ${reason}`);
        
        // Get auction details first (for image cleanup)
        const auction = await Auction.findById(auctionId);
        if (!auction) {
            console.log('[DELETE] Auction not found');
            return { success: false, message: 'Auction not found' };
        }
        
        console.log(`[DELETE] Found auction: ${auction.title}`);
        console.log(`[DELETE] Images to delete: ${auction.images.length}`);
        
        // Delete images from Cloudinary
        if (auction.images && auction.images.length > 0 && process.env.CLOUDINARY_CLOUD_NAME) {
            console.log('[DELETE] Deleting images from Cloudinary...');
            
            for (const imageUrl of auction.images) {
                try {
                    // Extract public_id from Cloudinary URL
                    const urlParts = imageUrl.split('/');
                    const fileWithExtension = urlParts[urlParts.length - 1];
                    const publicId = fileWithExtension.split('.')[0];
                    const fullPublicId = urlParts.includes('vg-vault') ? `vg-vault/${publicId}` : publicId;
                    
                    console.log(`[DELETE] Deleting image: ${fullPublicId}`);
                    const result = await cloudinary.uploader.destroy(fullPublicId);
                    console.log(`[DELETE] Image deleted: ${result.result}`);
                } catch (imageError) {
                    console.log(`[DELETE] Failed to delete image: ${imageError.message}`);
                }
            }
        } else {
            console.log('[DELETE] No images to delete or Cloudinary not configured');
        }
        
        // Delete all related bids
        console.log('[DELETE] Deleting related bids...');
        const bidDeleteResult = await Bid.deleteMany({ auction: auctionId });
        console.log(`[DELETE] Deleted ${bidDeleteResult.deletedCount} bids`);
        
        // Delete all related notifications
        console.log('[DELETE] Deleting related notifications...');
        const notificationDeleteResult = await Notification.deleteMany({ auctionId: auctionId });
        console.log(`[DELETE] Deleted ${notificationDeleteResult.deletedCount} notifications`);
        
        // Delete the auction itself
        console.log('[DELETE] Deleting auction from database...');
        await Auction.findByIdAndDelete(auctionId);
        
        console.log('[DELETE] Complete deletion successful');
        
        // Emit socket event
        io.emit('auctionCompletelyDeleted', {
            auctionId,
            message: `Auction completely removed - ${reason}`
        });
        
        return { success: true, message: `Auction completely deleted - ${reason}` };
        
    } catch (error) {
        console.error('[DELETE] Error during complete deletion:', error);
        return { success: false, message: 'Error during deletion', error: error.message };
    }
}

// Admin routes
app.get('/api/admin/auctions', authenticateToken, async (req, res) => {
    console.log('[ADMIN] Admin auctions requested');
    console.log('[ADMIN] User:', req.user.username);
    console.log('[ADMIN] Is Admin:', req.user.isAdmin);
    
    if (!req.user.isAdmin) {
        console.log('[ADMIN] Access denied: User is not admin');
        return res.status(403).json({ message: 'Admin access required' });
    }

    try {
        const auctions = await Auction.find()
            .populate('seller', 'username displayName')
            .populate('highestBidder', 'username displayName')
            .sort({ createdAt: -1 })
            .limit(100); // Limit for performance
        
        console.log('[ADMIN] Retrieved', auctions.length, 'auctions');
        res.json(auctions);
    } catch (error) {
        console.error('[ADMIN] Error loading auctions:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Admin complete deletion (removes everything permanently)
app.delete('/api/admin/auctions/:id', authenticateToken, async (req, res) => {
    console.log('[ADMIN] Complete delete auction requested');
    console.log('[ADMIN] User:', req.user.username);
    console.log('[ADMIN] Is Admin:', req.user.isAdmin);
    console.log('[ADMIN] Auction ID:', req.params.id);
    
    if (!req.user.isAdmin) {
        console.log('[ADMIN] Access denied: User is not admin');
        return res.status(403).json({ message: 'Admin access required' });
    }

    try {
        const result = await completelyDeleteAuction(req.params.id, 'Admin deletion');
        
        if (result.success) {
            console.log('[ADMIN] Auction completely deleted');
            res.json({ message: result.message });
        } else {
            console.log('[ADMIN] Deletion failed:', result.message);
            res.status(400).json({ message: result.message });
        }
    } catch (error) {
        console.error('[ADMIN] Error deleting auction:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Admin terminate auction (now performs complete deletion)
app.post('/api/admin/auctions/:id/terminate', authenticateToken, async (req, res) => {
    console.log('[ADMIN] Terminate auction requested (will perform complete deletion)');
    console.log('[ADMIN] User:', req.user.username);
    console.log('[ADMIN] Is Admin:', req.user.isAdmin);
    console.log('[ADMIN] Auction ID:', req.params.id);
    
    if (!req.user.isAdmin) {
        console.log('[ADMIN] Access denied: User is not admin');
        return res.status(403).json({ message: 'Admin access required' });
    }

    try {
        console.log('[ADMIN] Calling complete deletion function...');
        const result = await completelyDeleteAuction(req.params.id, 'Admin termination via detail page');
        
        if (result.success) {
            console.log('[ADMIN] Auction terminated (completely deleted) via detail page');
            res.json({ message: result.message });
        } else {
            console.log('[ADMIN] Termination failed:', result.message);
            res.status(400).json({ message: result.message });
        }
    } catch (error) {
        console.error('[ADMIN] Error terminating auction via detail page:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// User can end their own auction early
app.post('/api/auctions/:id/end-early', authenticateToken, async (req, res) => {
    try {
        const auctionId = req.params.id;
        const userId = req.user.userId;

        const auction = await Auction.findById(auctionId).populate('highestBidder', 'username displayName');
        if (!auction) {
            return res.status(404).json({ message: 'Auction not found' });
        }

        // Check if user owns this auction
        if (auction.seller.toString() !== userId) {
            return res.status(403).json({ message: 'You can only end your own auctions' });
        }

        if (!auction.isActive) {
            return res.status(400).json({ message: 'Auction is already ended' });
        }

        // End auction
        auction.isActive = false;
        await auction.save();

        let message;
        if (auction.highestBidder) {
            const winnerDisplay = auction.highestBidder.displayName || auction.highestBidder.username;
            message = `Auction ended early by seller. Winner: ${winnerDisplay} with bid of $${auction.currentBid.toFixed(2)}`;
            
            // Create notification for winner
            await createNotification(
                auction.highestBidder._id,
                'auction_won',
                'Congratulations! You won an auction!',
                `You won "${auction.title}" with your bid of $${auction.currentBid.toFixed(2)}! The seller ended the auction early.`,
                auctionId,
                auction.title
            );
            
            // Create notification for seller
            await createNotification(
                auction.seller,
                'auction_ended_seller',
                'Your auction has ended',
                `Your auction "${auction.title}" has ended early with winner ${winnerDisplay} at $${auction.currentBid.toFixed(2)}.`,
                auctionId,
                auction.title
            );
            
            // Emit socket event for early end with winner
            io.emit('auctionEndedEarly', {
                auctionId,
                winner: winnerDisplay,
                finalPrice: auction.currentBid,
                message: 'Auction ended early by seller'
            });
        } else {
            // No bidders - delete the auction
            await Auction.findByIdAndDelete(auctionId);
            await Bid.deleteMany({ auction: auctionId });
            await Notification.deleteMany({ auctionId: auctionId });
            
            message = 'Auction deleted - no bidders found';
            
            // Emit socket event for deletion
            io.emit('auctionDeleted', {
                auctionId,
                message: 'Auction deleted by seller - no bidders'
            });
        }

        res.json({ message });
    } catch (error) {
        console.error('[END_EARLY] Error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
    console.log('[SOCKET] User connected:', socket.id);

    // Join user to their personal room for notifications
    socket.on('joinUser', (userId) => {
        socket.join(`user_${userId}`);
        console.log(`[SOCKET] User ${socket.id} joined personal room user_${userId}`);
    });

    socket.on('joinAuction', (auctionId) => {
        socket.join(`auction_${auctionId}`);
        console.log(`[SOCKET] User ${socket.id} joined auction ${auctionId}`);
    });

    socket.on('leaveAuction', (auctionId) => {
        socket.leave(`auction_${auctionId}`);
        console.log(`[SOCKET] User ${socket.id} left auction ${auctionId}`);
    });

    socket.on('disconnect', () => {
        console.log('[SOCKET] User disconnected:', socket.id);
    });
});

// Auction expiry checker (runs every 5 minutes)
const auctionExpiryChecker = setInterval(async () => {
    try {
        const expiredAuctions = await Auction.find({
            isActive: true,
            endDate: { $lte: new Date() }
        }).populate('highestBidder', 'username displayName');

        for (const auction of expiredAuctions) {
            auction.isActive = false;
            await auction.save();
            
            const winnerDisplay = auction.highestBidder ? 
                (auction.highestBidder.displayName || auction.highestBidder.username) : 'No winner';
            const winnerMessage = auction.highestBidder 
                ? `Winner: ${winnerDisplay}`
                : 'No winner - no bids placed';
            
            // Create notifications for auction end
            if (auction.highestBidder) {
                // Notify winner
                await createNotification(
                    auction.highestBidder._id,
                    'auction_won',
                    'Congratulations! You won an auction!',
                    `You won "${auction.title}" with your bid of $${auction.currentBid.toFixed(2)}!`,
                    auction._id,
                    auction.title
                );
            }
            
            // Notify seller
            await createNotification(
                auction.seller,
                'auction_ended_seller',
                'Your auction has ended',
                auction.highestBidder 
                    ? `Your auction "${auction.title}" has ended with winner ${winnerDisplay} at $${auction.currentBid.toFixed(2)}.`
                    : `Your auction "${auction.title}" has ended with no bids.`,
                auction._id,
                auction.title
            );
            
            io.emit('auctionEnded', {
                auctionId: auction._id,
                winner: winnerDisplay,
                finalPrice: auction.currentBid,
                message: winnerMessage
            });
            
            console.log(`[EXPIRY] Auction expired: ${auction.title} - ${winnerMessage}`);
        }
        
        if (expiredAuctions.length > 0) {
            console.log(`[EXPIRY] Processed ${expiredAuctions.length} expired auction(s)`);
        }
    } catch (error) {
        console.error('[EXPIRY] Error checking expired auctions:', error);
    }
}, 300000); // Check every 5 minutes (300000ms)

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[SERVER] SIGTERM received, shutting down gracefully');
    clearInterval(auctionExpiryChecker);
    server.close(() => {
        console.log('[SERVER] Process terminated');
        mongoose.connection.close();
    });
});

// Catch-all handler for client-side routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('[ERROR] Unhandled error:', err);
    res.status(500).json({ 
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
    });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] VG Vault server running on port ${PORT}`);
    console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[SERVER] Serving static files from: ${path.join(__dirname, 'public')}`);
    console.log(`[SERVER] Health check available at: /health`);
});