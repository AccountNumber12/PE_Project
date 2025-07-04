// Updated modal functions to work with the new responsive design

function showLogin() {
    const loginModal = document.getElementById('loginModal');
    if (loginModal) {
        loginModal.style.display = 'flex'; // Use flex instead of block
        loginModal.classList.add('active');
        // Prevent body scroll when modal is open
        document.body.style.overflow = 'hidden';
    }
}

function hideLogin() {
    const loginModal = document.getElementById('loginModal');
    const loginForm = document.getElementById('loginForm');
    if (loginModal) {
        loginModal.style.display = 'none';
        loginModal.classList.remove('active');
        // Restore body scroll
        document.body.style.overflow = '';
    }
    if (loginForm) {
        loginForm.reset();
    }
}

function showRegister() {
    const registerModal = document.getElementById('registerModal');
    if (registerModal) {
        registerModal.style.display = 'flex'; // Use flex instead of block
        registerModal.classList.add('active');
        // Prevent body scroll when modal is open
        document.body.style.overflow = 'hidden';
    }
}

function hideRegister() {
    const registerModal = document.getElementById('registerModal');
    const registerForm = document.getElementById('registerForm');
    if (registerModal) {
        registerModal.style.display = 'none';
        registerModal.classList.remove('active');
        // Restore body scroll
        document.body.style.overflow = '';
    }
    if (registerForm) {
        registerForm.reset();
    }
}

function showNotifications() {
    loadNotifications();
    const modal = document.getElementById('notificationModal');
    if (modal) {
        modal.style.display = 'flex'; // Use flex for consistent behavior
        modal.classList.add('active');
        // Prevent body scroll when modal is open
        document.body.style.overflow = 'hidden';
    }
}

function hideNotifications() {
    const modal = document.getElementById('notificationModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
        // Restore body scroll
        document.body.style.overflow = '';
    }
}

// Updated event listener for closing modals when clicking outside
function setupEventListeners() {
    // ... existing code ...

    // Close modals when clicking outside - updated for new system
    window.addEventListener('click', (e) => {
        const loginModal = document.getElementById('loginModal');
        const registerModal = document.getElementById('registerModal');
        const notificationModal = document.getElementById('notificationModal');
        
        // Check if click is on the modal backdrop (not the content)
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

    // ... rest of existing code ...
}

// Add keyboard event listener for ESC key to close modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const activeModals = document.querySelectorAll('.modal.active');
        activeModals.forEach(modal => {
            if (modal.id === 'loginModal') hideLogin();
            if (modal.id === 'registerModal') hideRegister();
            if (modal.id === 'notificationModal') hideNotifications();
        });
    }
});

// Handle orientation change and resize events for better mobile experience
window.addEventListener('resize', () => {
    // Force height recalculation on resize
    const activeModals = document.querySelectorAll('.modal.active');
    activeModals.forEach(modal => {
        // Trigger a reflow to ensure proper height calculation
        modal.style.display = 'none';
        modal.offsetHeight; // Force reflow
        modal.style.display = 'flex';
    });
});

// Handle iOS Safari viewport height changes (when keyboard appears/disappears)
if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            const activeModals = document.querySelectorAll('.modal.active');
            activeModals.forEach(modal => {
                const modalContent = modal.querySelector('.modal-content');
                if (modalContent) {
                    modalContent.style.maxHeight = `calc(100vh - 40px)`;
                }
            });
        }, 100);
    });
}