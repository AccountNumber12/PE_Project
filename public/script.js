const socket = io();
let currentUser = null;
let currentAuction = null;
let notifications = [];
let unreadCount = 0;

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    checkAuthStatus();
    loadAuctions();
    setupEventListeners();
    setupSocketListeners();
});

// Socket listeners
function setupSocketListeners() {
    socket.on('bidUpdate', (data) => {
        updateBidDisplay(data);
    });

    socket.on('auctionEnded', (data) => {
        showAuctionEndedMessage(data);
    });

    socket.on('auctionEndedEarly', (data) => {
        showMessage(`${data.message} - Winner: ${data.winner} ($${data.finalPrice.toFixed(2)})`, 'success');
        if (currentAuction && currentAuction._id === data.auctionId) {
            setTimeout(() => showAuctionDetail(data.auctionId), 2000);
        }
    });

    socket.on('auctionTerminated', (data) => {
        showMessage(data.message, 'error');
        if (currentAuction && currentAuction._id === data.auctionId) {
            setTimeout(() => showHome(), 2000);
        }
    });

    socket.on('auctionDeleted', (data) => {
        showMessage(data.message, 'success');
        if (currentAuction && currentAuction._id === data.auctionId) {
            setTimeout(() => showHome(), 2000);
        }
    });

    socket.on('auctionCompletelyDeleted', (data) => {
        showMessage(data.message, 'success');
        if (currentAuction && currentAuction._id === data.auctionId) {
            setTimeout(() => showHome(), 2000);
        }
    });

    // Notification socket listeners
    socket.on('newNotification', (notification) => {
        handleNewNotification(notification);
    });

    // Handle connection errors
    socket.on('connect_error', (error) => {
        console.error('[SOCKET] Connection error:', error);
        showMessage('Connection lost. Reconnecting...', 'error');
    });

    socket.on('connect', () => {
        console.log('[SOCKET] Connected to server');
        // Join user room if logged in
        if (currentUser) {
            socket.emit('joinUser', currentUser.userId);
        }
    });

    socket.on('disconnect', () => {
        console.log('[SOCKET] Disconnected from server');
    });
}

// Notification functions
function handleNewNotification(notification) {
    console.log('[NOTIFICATION] Received new notification:', notification);
    notifications.unshift(notification);
    unreadCount++;
    updateNotificationBadge();
    showMessage(notification.title, 'success');
}

async function loadNotifications() {
    if (!currentUser) return;
    
    try {
        const response = await fetch('/api/notifications', {
            credentials: 'include'
        });
        
        if (response.ok) {
            notifications = await response.json();
            updateNotificationDisplay();
        }
    } catch (error) {
        console.error('[NOTIFICATION] Error loading notifications:', error);
    }
}

async function loadUnreadCount() {
    if (!currentUser) return;
    
    try {
        const response = await fetch('/api/notifications/unread-count', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            unreadCount = data.count;
            updateNotificationBadge();
        }
    } catch (error) {
        console.error('[NOTIFICATION] Error loading unread count:', error);
    }
}

function updateNotificationBadge() {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }
}

function updateNotificationDisplay() {
    const container = document.getElementById('notificationsList');
    if (!container) return;
    
    if (notifications.length === 0) {
        container.innerHTML = '<div class="no-notifications">No notifications yet</div>';
        return;
    }
    
    container.innerHTML = notifications.map(notification => {
        const timeAgo = formatTimeAgo(notification.createdAt);
        const typeIcon = getNotificationIcon(notification.type);
        
        return `
            <div class="notification-item ${notification.isRead ? 'read' : 'unread'}" 
                 onclick="handleNotificationClick('${notification._id}', '${notification.auctionId}')"
                 data-id="${notification._id}">
                <div class="notification-icon">${typeIcon}</div>
                <div class="notification-content">
                    <div class="notification-title">${escapeHtml(notification.title)}</div>
                    <div class="notification-message">${escapeHtml(notification.message)}</div>
                    <div class="notification-time">${timeAgo}</div>
                </div>
                ${!notification.isRead ? '<div class="notification-unread-dot"></div>' : ''}
            </div>
        `;
    }).join('');
}

function getNotificationIcon(type) {
    switch (type) {
        case 'outbid': return '⚡';
        case 'auction_won': return '🏆';
        case 'buy_now_purchase': return '💰';
        case 'auction_ended_seller': return '📝';
        default: return '🔔';
    }
}

function formatTimeAgo(dateString) {
    const now = new Date();
    const date = new Date(dateString);
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

async function handleNotificationClick(notificationId, auctionId) {
    // Mark as read
    try {
        const response = await fetch(`/api/notifications/${notificationId}/read`, {
            method: 'PUT',
            credentials: 'include'
        });
        
        if (response.ok) {
            // Update local notification state
            const notification = notifications.find(n => n._id === notificationId);
            if (notification && !notification.isRead) {
                notification.isRead = true;
                unreadCount = Math.max(0, unreadCount - 1);
                updateNotificationBadge();
                updateNotificationDisplay();
            }
        }
    } catch (error) {
        console.error('[NOTIFICATION] Error marking as read:', error);
    }
    
    // Close notification modal and navigate to auction
    hideNotifications();
    showAuctionDetail(auctionId);
}

async function markAllNotificationsRead() {
    try {
        const response = await fetch('/api/notifications/mark-all-read', {
            method: 'PUT',
            credentials: 'include'
        });
        
        if (response.ok) {
            notifications.forEach(n => n.isRead = true);
            unreadCount = 0;
            updateNotificationBadge();
            updateNotificationDisplay();
            showMessage('All notifications marked as read', 'success');
        }
    } catch (error) {
        console.error('[NOTIFICATION] Error marking all as read:', error);
        showMessage('Failed to mark notifications as read', 'error');
    }
}

function showNotifications() {
    loadNotifications();
    const modal = document.getElementById('notificationModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

function hideNotifications() {
    const modal = document.getElementById('notificationModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Event listeners
function setupEventListeners() {
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;
            
            if (!username || !password) {
                showMessage('Please fill in all fields', 'error');
                return;
            }
            
            await login(username, password);
        });
    }

    // Register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('registerUsername').value.trim();
            const displayName = document.getElementById('registerDisplayName').value.trim();
            const email = document.getElementById('registerEmail').value.trim();
            const password = document.getElementById('registerPassword').value;
            const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
            
            if (!username || !displayName || !email || !password || !passwordConfirm) {
                showMessage('Please fill in all fields', 'error');
                return;
            }
            
            if (password !== passwordConfirm) {
                showMessage('Passwords do not match', 'error');
                return;
            }
            
            await register(username, displayName, email, password);
        });
    }

    // Create auction form
    const createAuctionForm = document.getElementById('createAuctionForm');
    if (createAuctionForm) {
        createAuctionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await createAuction();
        });
    }

    // Close modals when clicking outside
    window.addEventListener('click', (e) => {
        const loginModal = document.getElementById('loginModal');
        const registerModal = document.getElementById('registerModal');
        const notificationModal = document.getElementById('notificationModal');
        
        if (e.target === loginModal) {
            hideLogin();
        }
        if (e.target === registerModal) {
            hideRegister();
        }
        if (e.target === notificationModal) {
            hideNotifications();
        }
    });

    // Enter key for search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchAuctions();
            }
        });
    }

    // Add error handling for images
    document.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG') {
            e.target.src = '/placeholder.jpg';
        }
    }, true);
}

// Authentication functions
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth-status', {
            credentials: 'include'
        });
        const data = await response.json();
        
        console.log('[AUTH] Auth status check:', data);
        
        if (data.authenticated) {
            currentUser = data.user;
            console.log('[AUTH] User authenticated:', currentUser);
            updateNavForLoggedInUser();
            // Join user socket room and load notifications
            socket.emit('joinUser', currentUser.userId);
            loadUnreadCount();
        } else {
            console.log('[AUTH] User not authenticated');
            currentUser = null;
            updateNavForLoggedOutUser();
        }
    } catch (error) {
        console.error('[AUTH] Error checking auth status:', error);
        currentUser = null;
        updateNavForLoggedOutUser();
    }
}

async function login(username, password) {
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json();
        
        if (response.ok) {
            currentUser = data.user;
            updateNavForLoggedInUser();
            hideLogin();
            showMessage('Login successful!', 'success');
            // Join user socket room and load notifications
            socket.emit('joinUser', currentUser.userId);
            loadUnreadCount();
        } else {
            showMessage(data.message || 'Login failed', 'error');
        }
    } catch (error) {
        console.error('[AUTH] Login error:', error);
        showMessage('Login failed - network error', 'error');
    }
}

async function register(username, displayName, email, password) {
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ username, displayName, email, password }),
        });

        const data = await response.json();
        
        if (response.ok) {
            currentUser = data.user;
            updateNavForLoggedInUser();
            hideRegister();
            showMessage('Registration successful!', 'success');
            // Join user socket room
            socket.emit('joinUser', currentUser.userId);
            loadUnreadCount();
        } else {
            showMessage(data.message || 'Registration failed', 'error');
        }
    } catch (error) {
        console.error('[AUTH] Registration error:', error);
        showMessage('Registration failed - network error', 'error');
    }
}

async function logout() {
    try {
        await fetch('/api/logout', { 
            method: 'POST',
            credentials: 'include'
        });
        currentUser = null;
        notifications = [];
        unreadCount = 0;
        updateNavForLoggedOutUser();
        showHome();
        showMessage('Logged out successfully', 'success');
    } catch (error) {
        console.error('[AUTH] Logout error:', error);
        showMessage('Logout failed', 'error');
    }
}

function updateNavForLoggedInUser() {
    const navAuth = document.getElementById('navAuth');
    if (navAuth && currentUser) {
        // Use displayName if available, fallback to username for compatibility
        const displayText = currentUser.displayName || currentUser.username;
        
        navAuth.innerHTML = `
            <div class="nav-notification" onclick="showNotifications()">
                <span class="notification-bell">🔔</span>
                <span id="notificationBadge" class="notification-badge" style="display: none;">0</span>
            </div>
            <span>Welcome, ${escapeHtml(displayText)}!</span>
            <button onclick="showDashboard()">Dashboard</button>
            ${currentUser.isAdmin ? '<button onclick="showAdmin()">Admin</button>' : ''}
            <button onclick="logout()">Logout</button>
        `;
    }
    
    const createBtn = document.getElementById('createAuctionBtn');
    if (createBtn) createBtn.style.display = 'inline-block';
}

function updateNavForLoggedOutUser() {
    const navAuth = document.getElementById('navAuth');
    if (navAuth) {
        navAuth.innerHTML = `
            <button onclick="showLogin()">Login</button>
            <button onclick="showRegister()">Sign Up</button>
        `;
    }
    
    const createBtn = document.getElementById('createAuctionBtn');
    if (createBtn) createBtn.style.display = 'none';
}

// Navigation functions
function showPage(pageId) {
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => page.classList.remove('active'));
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    }
}

function showHome() {
    showPage('homePage');
    loadAuctions();
}

function showCreateAuction() {
    if (!currentUser) {
        showLogin();
        return;
    }
    showPage('createAuctionPage');
}

function showDashboard() {
    if (!currentUser) {
        showLogin();
        return;
    }
    showPage('dashboardPage');
    showDashboardTab('bids');
}

function showAdmin() {
    if (!currentUser || !currentUser.isAdmin) {
        showMessage('Admin access required', 'error');
        return;
    }
    showPage('adminPage');
    loadAdminData();
}

function showLogin() {
    const loginModal = document.getElementById('loginModal');
    if (loginModal) {
        loginModal.style.display = 'block';
    }
}

function hideLogin() {
    const loginModal = document.getElementById('loginModal');
    const loginForm = document.getElementById('loginForm');
    if (loginModal) {
        loginModal.style.display = 'none';
    }
    if (loginForm) {
        loginForm.reset();
    }
}

function showRegister() {
    const registerModal = document.getElementById('registerModal');
    if (registerModal) {
        registerModal.style.display = 'block';
    }
}

function hideRegister() {
    const registerModal = document.getElementById('registerModal');
    const registerForm = document.getElementById('registerForm');
    if (registerModal) {
        registerModal.style.display = 'none';
    }
    if (registerForm) {
        registerForm.reset();
    }
}

// Auction functions
async function loadAuctions() {
    try {
        const response = await fetch('/api/auctions', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const auctions = await response.json();
        displayAuctions(auctions);
    } catch (error) {
        console.error('[AUCTION] Error loading auctions:', error);
        showMessage('Failed to load auctions', 'error');
        
        // Show empty state
        const grid = document.getElementById('auctionsGrid');
        if (grid) {
            grid.innerHTML = '<p class="no-auctions">Failed to load auctions. Please try again later.</p>';
        }
    }
}

function displayAuctions(auctions) {
    const grid = document.getElementById('auctionsGrid');
    if (!grid) return;
    
    if (!auctions || auctions.length === 0) {
        grid.innerHTML = '<p class="no-auctions">No active auctions at the moment.</p>';
        return;
    }

    grid.innerHTML = auctions.map(auction => {
        const imageUrl = (auction.images && auction.images.length > 0) ? auction.images[0] : '/placeholder.jpg';
        // Use display name if available, fallback to username
        const sellerDisplay = auction.seller.displayName || auction.seller.username;
        
        return `
            <div class="auction-card" onclick="showAuctionDetail('${auction._id}')">
                <img src="${imageUrl}" alt="${escapeHtml(auction.title)}" class="auction-image" onerror="this.src='/placeholder.jpg'">
                <div class="auction-info">
                    <div class="auction-title">${escapeHtml(auction.title)}</div>
                    <div class="auction-price">Current Bid: $${auction.currentBid.toFixed(2)}</div>
                    ${auction.hammerPrice ? `<div class="auction-buy-now">Buy Now: $${auction.hammerPrice.toFixed(2)}</div>` : ''}
                    <div class="auction-time">Ends: ${formatTimeRemaining(auction.endDate)}</div>
                    <div class="auction-seller">Seller: ${escapeHtml(sellerDisplay)}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function showAuctionDetail(auctionId) {
    try {
        const response = await fetch(`/api/auctions/${auctionId}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Auction not found - it may have been deleted');
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        currentAuction = await response.json();
        displayAuctionDetail(currentAuction);
        showPage('auctionDetailPage');
        
        // Join socket room for real-time updates
        socket.emit('joinAuction', auctionId);
    } catch (error) {
        console.error('[AUCTION] Error loading auction detail:', error);
        showMessage(error.message || 'Failed to load auction details', 'error');
        showHome(); // Redirect to home if auction can't be loaded
    }
}

function displayAuctionDetail(auction) {
    const container = document.getElementById('auctionDetail');
    if (!container) return;
    
    const timeRemaining = formatTimeRemaining(auction.endDate);
    const isActive = auction.isActive && new Date() < new Date(auction.endDate);
    const isOwner = currentUser && currentUser.userId === auction.seller._id;
    const isAdmin = currentUser && currentUser.isAdmin;
    
    // Use display names where available
    const sellerDisplay = auction.seller.displayName || auction.seller.username;
    const highestBidderDisplay = auction.highestBidder ? 
        (auction.highestBidder.displayName || auction.highestBidder.username) : null;
    
    container.innerHTML = `
        <button onclick="showHome()" class="btn btn-primary mb-1">← Back to Auctions</button>
        
        <div class="auction-detail-container">
            <div class="auction-images">
                ${auction.images && auction.images.length > 0 ? `
                    <img src="${auction.images[0]}" alt="${escapeHtml(auction.title)}" class="main-image" id="mainImage" onerror="this.src='/placeholder.jpg'">
                    ${auction.images.length > 1 ? `
                        <div class="thumbnail-images">
                            ${auction.images.map((img, index) => `
                                <img src="${img}" alt="Thumbnail ${index + 1}" class="thumbnail ${index === 0 ? 'active' : ''}" 
                                     onclick="changeMainImage('${img}', this)" onerror="this.src='/placeholder.jpg'">
                            `).join('')}
                        </div>
                    ` : ''}
                ` : `
                    <img src="/placeholder.jpg" alt="No image" class="main-image">
                `}
            </div>
            
            <div class="auction-details">
                <h1>${escapeHtml(auction.title)}</h1>
                <p><strong>Seller:</strong> ${escapeHtml(sellerDisplay)}</p>
                <p><strong>Starting Price:</strong> $${auction.startingPrice.toFixed(2)}</p>
                
                <div class="current-bid" id="currentBid">
                    Current Bid: $${auction.currentBid.toFixed(2)}
                    ${highestBidderDisplay ? `<br><small>Highest Bidder: ${escapeHtml(highestBidderDisplay)}</small>` : ''}
                </div>
                
                <p><strong>Time Remaining:</strong> <span id="timeRemaining">${timeRemaining}</span></p>
                <p><strong>Status:</strong> <span class="${isActive ? 'text-success' : 'text-danger'}">${isActive ? 'Active' : 'Ended'}</span></p>
                
                ${isActive && currentUser && !isOwner && !isAdmin ? `
                    <div class="bid-section">
                        <h3>Place a Bid</h3>
                        <p>Minimum bid: $<span id="minimumBid">${calculateMinimumBid(auction).toFixed(2)}</span></p>
                        <div class="bid-input">
                            <input type="number" id="bidAmount" min="${calculateMinimumBid(auction)}" step="0.01" placeholder="Enter bid amount">
                            <button onclick="placeBid()">Place Bid</button>
                        </div>
                        ${auction.hammerPrice ? `
                            <button class="buy-now-btn" onclick="buyNow()">
                                Buy Now - $${auction.hammerPrice.toFixed(2)}
                            </button>
                        ` : ''}
                    </div>
                ` : !currentUser && isActive ? '<p class="text-center"><button onclick="showLogin()" class="btn btn-primary">Login to Bid</button></p>' : ''}
                
                ${isOwner && isActive ? `
                    <div class="owner-controls">
                        <h3>Owner Controls</h3>
                        <button onclick="endAuctionEarly('${auction._id}')" class="btn btn-danger">
                            End Auction Early
                        </button>
                        <p><small>End now: ${auction.highestBidder ? 'Current highest bidder wins' : 'Auction will be deleted (no bidders)'}</small></p>
                    </div>
                ` : ''}
                
                ${isAdmin ? `
                    <div class="admin-controls">
                        <h3>Admin Controls</h3>
                        <button onclick="deleteAuctionFromDetail('${auction._id}')" class="btn btn-danger">
                            Delete Auction
                        </button>
                        <p><small>This will completely remove the auction, all bids, and images.</small></p>
                    </div>
                ` : ''}
                
                <div class="description">
                    <h3>Description</h3>
                    <p>${escapeHtml(auction.description).replace(/\n/g, '<br>')}</p>
                </div>
                
                ${auction.bids && auction.bids.length > 0 ? `
                    <div class="bid-history">
                        <h3>Bid History</h3>
                        <div class="bid-history-list">
                            ${auction.bids.slice().reverse().slice(0, 10).map(bid => {
                                const bidderDisplay = bid.bidder.displayName || bid.bidder.username;
                                return `
                                    <div class="bid-history-item">
                                        <strong>${escapeHtml(bidderDisplay)}</strong> bid $${bid.amount.toFixed(2)} 
                                        <small>(${new Date(bid.timestamp).toLocaleString()})</small>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function changeMainImage(imageSrc, thumbnail) {
    const mainImage = document.getElementById('mainImage');
    if (mainImage) {
        mainImage.src = imageSrc;
    }
    
    document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
    if (thumbnail) {
        thumbnail.classList.add('active');
    }
}

function calculateMinimumBid(auction) {
    const basePrice = auction.currentBid > 0 ? auction.currentBid : auction.startingPrice;
    const tenPercent = Math.ceil(basePrice * 0.1);
    return basePrice + Math.max(1, tenPercent);
}

async function placeBid() {
    if (!currentUser) {
        showLogin();
        return;
    }

    const bidAmountInput = document.getElementById('bidAmount');
    if (!bidAmountInput) return;
    
    const amount = parseFloat(bidAmountInput.value);
    const minBid = calculateMinimumBid(currentAuction);
    
    if (!amount || amount < minBid) {
        showMessage(`Minimum bid is $${minBid.toFixed(2)}`, 'error');
        return;
    }

    try {
        const response = await fetch(`/api/auctions/${currentAuction._id}/bid`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ amount }),
        });

        const data = await response.json();
        
        if (response.ok) {
            showMessage('Bid placed successfully!', 'success');
            bidAmountInput.value = '';
            // Refresh auction detail
            await showAuctionDetail(currentAuction._id);
        } else {
            showMessage(data.message || 'Failed to place bid', 'error');
        }
    } catch (error) {
        console.error('[BID] Error placing bid:', error);
        showMessage('Failed to place bid - network error', 'error');
    }
}

async function buyNow() {
    if (!currentUser) {
        showLogin();
        return;
    }

    if (!confirm(`Are you sure you want to buy this item for $${currentAuction.hammerPrice.toFixed(2)}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/auctions/${currentAuction._id}/buy-now`, {
            method: 'POST',
            credentials: 'include'
        });

        const data = await response.json();
        
        if (response.ok) {
            showMessage(data.message, 'success');
            // Refresh auction detail
            await showAuctionDetail(currentAuction._id);
        } else {
            showMessage(data.message || 'Failed to purchase item', 'error');
        }
    } catch (error) {
        console.error('[BUY_NOW] Error:', error);
        showMessage('Failed to purchase item - network error', 'error');
    }
}

async function createAuction() {
    const form = document.getElementById('createAuctionForm');
    if (!form) return;
    
    const formData = new FormData(form);

    // Validate form
    const title = formData.get('title');
    const description = formData.get('description');
    const startingPrice = formData.get('startingPrice');
    const duration = formData.get('duration');
    
    if (!title || !description || !startingPrice || !duration) {
        showMessage('Please fill in all required fields', 'error');
        return;
    }

    if (parseFloat(startingPrice) < 0) {
        showMessage('Starting price must be 0 or greater', 'error');
        return;
    }

    try {
        const response = await fetch('/api/auctions', {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });

        const data = await response.json();
        
        if (response.ok) {
            showMessage('Auction created successfully!', 'success');
            form.reset();
            showHome();
        } else {
            showMessage(data.message || 'Failed to create auction', 'error');
        }
    } catch (error) {
        console.error('[AUCTION] Creation error:', error);
        showMessage('Failed to create auction - network error', 'error');
    }
}

// Admin delete auction from detail page
async function deleteAuctionFromDetail(auctionId) {
    if (!currentUser || !currentUser.isAdmin) {
        showMessage('Admin access required', 'error');
        return;
    }

    if (!confirm('Are you sure you want to completely delete this auction? This action cannot be undone and will remove all bids and images.')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/auctions/${auctionId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await response.json();
        
        if (response.ok) {
            showMessage('Auction deleted successfully', 'success');
            // Redirect to home page after successful deletion
            setTimeout(() => {
                showHome();
            }, 2000);
        } else {
            showMessage(data.message || 'Failed to delete auction', 'error');
        }
    } catch (error) {
        console.error('[ADMIN] Error deleting auction:', error);
        showMessage('Failed to delete auction - network error', 'error');
    }
}

// Dashboard functions
async function showDashboardTab(tab) {
    // Update active tab
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(tab.toLowerCase())) {
            btn.classList.add('active');
        }
    });

    if (tab === 'bids') {
        await loadUserBids();
    } else if (tab === 'listings') {
        await loadUserListings();
    }
}

async function loadUserBids() {
    try {
        const response = await fetch('/api/user/bids', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const bids = await response.json();
        
        // Filter out bids for deleted auctions (auction will be null)
        const validBids = bids.filter(bid => bid.auction !== null);
        
        const content = document.getElementById('dashboardContent');
        if (!content) return;
        
        content.innerHTML = `
            <h3>My Bid History (${validBids.length})</h3>
            ${validBids.length === 0 ? '<p>No bids yet.</p>' : `
                <div class="dashboard-list">
                    ${validBids.map(bid => {
                        // Use display name if available
                        const sellerDisplay = bid.auction.seller ? 
                            (bid.auction.seller.displayName || bid.auction.seller.username) : 'Unknown';
                        
                        return `
                            <div class="dashboard-item">
                                <strong>${escapeHtml(bid.auction.title)}</strong><br>
                                Seller: ${escapeHtml(sellerDisplay)}<br>
                                Your bid: $${bid.amount.toFixed(2)}<br>
                                Current bid: $${bid.auction.currentBid.toFixed(2)}<br>
                                Status: <span class="${bid.auction.isActive ? 'text-success' : 'text-danger'}">
                                    ${bid.auction.isActive ? 'Active' : 'Ended'}
                                </span><br>
                                ${bid.auction.isActive ? `Ends: ${formatTimeRemaining(bid.auction.endDate)}<br>` : ''}
                                <small>Bid placed: ${new Date(bid.timestamp).toLocaleString()}</small><br>
                                <button onclick="showAuctionDetail('${bid.auction._id}')" class="btn btn-primary mt-1">View Auction</button>
                            </div>
                        `;
                    }).join('')}
                </div>
            `}
        `;
    } catch (error) {
        console.error('[DASHBOARD] Error loading user bids:', error);
        showMessage('Failed to load bid history', 'error');
        
        const content = document.getElementById('dashboardContent');
        if (content) {
            content.innerHTML = '<p>Failed to load bid history. Please try again later.</p>';
        }
    }
}

async function loadUserListings() {
    try {
        const response = await fetch('/api/user/listings', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const listings = await response.json();
        
        const content = document.getElementById('dashboardContent');
        if (!content) return;
        
        content.innerHTML = `
            <h3>My Listings (${listings.length})</h3>
            ${listings.length === 0 ? '<p>No listings yet.</p>' : `
                <div class="dashboard-list">
                    ${listings.map(listing => {
                        // Use display name for highest bidder if available
                        const bidderDisplay = listing.highestBidder ? 
                            (listing.highestBidder.displayName || listing.highestBidder.username) : null;
                        
                        return `
                            <div class="dashboard-item">
                                <strong>${escapeHtml(listing.title)}</strong><br>
                                Starting price: $${listing.startingPrice.toFixed(2)}<br>
                                Current bid: $${listing.currentBid.toFixed(2)}<br>
                                ${bidderDisplay ? `Highest bidder: ${escapeHtml(bidderDisplay)}<br>` : 'No bids yet<br>'}
                                Status: <span class="${listing.isActive ? 'text-success' : 'text-danger'}">
                                    ${listing.isActive ? 'Active' : 'Ended'}
                                </span><br>
                                ${listing.isActive ? `Ends: ${formatTimeRemaining(listing.endDate)}<br>` : ''}
                                Images: ${listing.images ? listing.images.length : 0}<br>
                                <small>Created: ${new Date(listing.createdAt).toLocaleString()}</small><br>
                                <div class="listing-actions">
                                    <button onclick="showAuctionDetail('${listing._id}')" class="btn btn-primary mt-1">View</button>
                                    ${listing.isActive ? `
                                        <button onclick="endAuctionEarly('${listing._id}')" class="btn btn-warning mt-1" title="End early: Winner chosen if bids exist, deleted if no bids">End Early</button>
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `}
        `;
    } catch (error) {
        console.error('[DASHBOARD] Error loading user listings:', error);
        showMessage('Failed to load listings', 'error');
        
        const content = document.getElementById('dashboardContent');
        if (content) {
            content.innerHTML = '<p>Failed to load listings. Please try again later.</p>';
        }
    }
}

// Admin functions
async function loadAdminData() {
    try {
        const response = await fetch('/api/admin/auctions', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            if (response.status === 403) {
                throw new Error('Admin access required');
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const auctions = await response.json();
        
        const content = document.getElementById('adminContent');
        if (!content) return;
        
        content.innerHTML = `
            <h3>All Auctions (${auctions.length})</h3>
            <div class="admin-auctions">
                ${auctions.map(auction => {
                    // Use display names where available
                    const sellerDisplay = auction.seller.displayName || auction.seller.username;
                    const bidderDisplay = auction.highestBidder ? 
                        (auction.highestBidder.displayName || auction.highestBidder.username) : null;
                    
                    return `
                        <div class="admin-item">
                            <strong>${escapeHtml(auction.title)}</strong><br>
                            Seller: ${escapeHtml(sellerDisplay)} (${escapeHtml(auction.seller.username)})<br>
                            Current bid: $${auction.currentBid.toFixed(2)}<br>
                            ${bidderDisplay ? `Highest bidder: ${escapeHtml(bidderDisplay)} (${escapeHtml(auction.highestBidder.username)})<br>` : 'No bids<br>'}
                            Status: <span class="${auction.isActive ? 'text-success' : 'text-danger'}">
                                ${auction.isActive ? 'Active' : 'Ended'}
                            </span><br>
                            Created: ${new Date(auction.createdAt).toLocaleString()}<br>
                            <div class="admin-actions">
                                <button onclick="showAuctionDetail('${auction._id}')" class="btn btn-primary">View</button>
                                <button onclick="deleteAuction('${auction._id}')" class="btn btn-danger">Delete</button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } catch (error) {
        console.error('[ADMIN] Error loading admin data:', error);
        showMessage(error.message || 'Failed to load admin data', 'error');
        
        const content = document.getElementById('adminContent');
        if (content) {
            content.innerHTML = '<p>Failed to load admin data. Please check your permissions.</p>';
        }
    }
}

async function deleteAuction(auctionId) {
    if (!confirm('Are you sure you want to delete this auction? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/auctions/${auctionId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await response.json();
        
        if (response.ok) {
            showMessage('Auction deleted successfully', 'success');
            loadAdminData(); // Refresh the admin list
        } else {
            showMessage(data.message || 'Failed to delete auction', 'error');
        }
    } catch (error) {
        console.error('[ADMIN] Error deleting auction:', error);
        showMessage('Failed to delete auction - network error', 'error');
    }
}

async function endAuctionEarly(auctionId) {
    if (!confirm('Are you sure you want to end this auction early?')) {
        return;
    }

    try {
        const response = await fetch(`/api/auctions/${auctionId}/end-early`, {
            method: 'POST',
            credentials: 'include'
        });

        const data = await response.json();
        
        if (response.ok) {
            showMessage(data.message, 'success');
            // Refresh current view
            const dashboardPage = document.getElementById('dashboardPage');
            if (dashboardPage && dashboardPage.classList.contains('active')) {
                loadUserListings();
            } else if (currentAuction && currentAuction._id === auctionId) {
                setTimeout(() => showHome(), 2000);
            }
        } else {
            showMessage(data.message || 'Failed to end auction early', 'error');
        }
    } catch (error) {
        console.error('[END_EARLY] Error:', error);
        showMessage('Failed to end auction early - network error', 'error');
    }
}

// Utility functions
function formatTimeRemaining(endDate) {
    const now = new Date();
    const end = new Date(endDate);
    const diff = end - now;

    if (diff <= 0) {
        return 'Auction ended';
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

function updateBidDisplay(data) {
    if (currentAuction && currentAuction._id === data.auctionId) {
        const currentBidEl = document.getElementById('currentBid');
        const minimumBidEl = document.getElementById('minimumBid');
        
        if (currentBidEl) {
            // Use display name for the highest bidder display
            const bidderDisplay = data.highestBidderDisplay || data.highestBidder;
            currentBidEl.innerHTML = `
                Current Bid: $${data.currentBid.toFixed(2)}
                <br><small>Highest Bidder: ${escapeHtml(bidderDisplay)}</small>
            `;
        }
        
        if (minimumBidEl) {
            const newMinimum = data.currentBid + Math.max(1, Math.ceil(data.currentBid * 0.1));
            minimumBidEl.textContent = newMinimum.toFixed(2);
            const bidAmountInput = document.getElementById('bidAmount');
            if (bidAmountInput) {
                bidAmountInput.min = newMinimum;
            }
        }
        
        // Update current auction object
        currentAuction.currentBid = data.currentBid;
    }
}

function showAuctionEndedMessage(data) {
    if (currentAuction && currentAuction._id === data.auctionId) {
        showMessage(`Auction ended! Winner: ${data.winner} - Final price: $${data.finalPrice.toFixed(2)}`, 'success');
        // Refresh the auction detail to show updated status
        setTimeout(() => {
            showAuctionDetail(data.auctionId);
        }, 2000);
    }
}

function showMessage(message, type) {
    // Remove existing messages
    const existingMessages = document.querySelectorAll('.message');
    existingMessages.forEach(msg => msg.remove());
    
    // Create message element
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}`;
    messageEl.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem;
        border-radius: 4px;
        color: white;
        z-index: 1001;
        max-width: 300px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        animation: slideIn 0.3s ease-out;
        pointer-events: auto;
    `;
    
    if (type === 'success') {
        messageEl.style.backgroundColor = '#28a745';
    } else if (type === 'error') {
        messageEl.style.backgroundColor = '#dc3545';
    } else if (type === 'warning') {
        messageEl.style.backgroundColor = '#ffc107';
        messageEl.style.color = '#212529';
    }
    
    messageEl.textContent = message;
    document.body.appendChild(messageEl);
    
    // Remove after 5 seconds
    setTimeout(() => {
        if (messageEl.parentNode) {
            messageEl.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => {
                if (messageEl.parentNode) {
                    messageEl.parentNode.removeChild(messageEl);
                }
            }, 300);
        }
    }, 5000);
}

async function searchAuctions() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    
    const searchTerm = searchInput.value.toLowerCase().trim();
    
    if (!searchTerm) {
        loadAuctions();
        return;
    }
    
    try {
        const response = await fetch('/api/auctions', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const auctions = await response.json();
        
        const filteredAuctions = auctions.filter(auction => 
            auction.title.toLowerCase().includes(searchTerm) ||
            auction.description.toLowerCase().includes(searchTerm) ||
            auction.seller.username.toLowerCase().includes(searchTerm) ||
            (auction.seller.displayName && auction.seller.displayName.toLowerCase().includes(searchTerm))
        );
        
        displayAuctions(filteredAuctions);
        
        if (filteredAuctions.length === 0) {
            const grid = document.getElementById('auctionsGrid');
            if (grid) {
                grid.innerHTML = `<p class="no-results">No auctions found matching "${escapeHtml(searchTerm)}"</p>`;
            }
        }
    } catch (error) {
        console.error('[SEARCH] Error searching auctions:', error);
        showMessage('Search failed - please try again', 'error');
    }
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Update time remaining every minute
setInterval(() => {
    const timeElements = document.querySelectorAll('#timeRemaining');
    timeElements.forEach(el => {
        if (currentAuction) {
            el.textContent = formatTimeRemaining(currentAuction.endDate);
        }
    });
}, 60000);

// Page visibility API to handle when tab becomes visible again
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentAuction) {
        // Refresh auction detail when user comes back to tab
        showAuctionDetail(currentAuction._id);
    }
});