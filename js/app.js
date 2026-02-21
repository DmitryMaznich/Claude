// Header scroll effect
const header = document.getElementById('header');
window.addEventListener('scroll', () => {
    if (window.pageYOffset > 50) {
        header.classList.add('scrolled');
    } else {
        header.classList.remove('scrolled');
    }
});

// Language switcher
const langBtns = document.querySelectorAll('.lang-btn');
const body = document.body;

langBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        body.setAttribute('data-lang', lang);
        langBtns.forEach(b => b.classList.remove('active'));

        // Update all language buttons (desktop and mobile)
        document.querySelectorAll('.lang-btn').forEach(b => {
            if (b.dataset.lang === lang) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });

        // Update slider position
        document.querySelectorAll('.lang-switcher').forEach(switcher => {
            switcher.setAttribute('data-active', lang);
        });
    });
});

// Mobile menu toggle
function toggleMobileMenu() {
    const mobileMenu = document.getElementById('mobileMenu');
    const menuBtn = document.querySelector('.mobile-menu-btn');
    const menuTab = document.getElementById('menuTab');
    mobileMenu.classList.toggle('active');
    menuBtn.classList.toggle('active');
    if (menuTab) menuTab.classList.toggle('active');
    document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
}

// Close mobile menu when clicking on overlay
function closeMobileMenuOnOverlay(event) {
    if (event.target.id === 'mobileMenu') {
        toggleMobileMenu();
    }
}

// Swipe handler for menu tab
let touchStartY = 0;
let touchEndY = 0;

const menuTab = document.getElementById('menuTab');
if (menuTab) {
    menuTab.addEventListener('touchstart', (e) => {
        touchStartY = e.changedTouches[0].screenY;
    });

    menuTab.addEventListener('touchend', (e) => {
        touchEndY = e.changedTouches[0].screenY;
        handleSwipe();
    });

    function handleSwipe() {
        const swipeDistance = touchEndY - touchStartY;
        // Свайп вниз (расстояние больше 30px)
        if (swipeDistance > 30) {
            toggleMobileMenu();
        }
    }
}

// Switch language (for mobile menu)
function switchLanguage(lang) {
    body.setAttribute('data-lang', lang);
    document.querySelectorAll('.lang-btn').forEach(btn => {
        if (btn.dataset.lang === lang) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    // Update slider position
    document.querySelectorAll('.lang-switcher').forEach(switcher => {
        switcher.setAttribute('data-active', lang);
    });
}

// Initialize Google Analytics (GDPR-compliant)
function initGoogleAnalytics() {
    // REPLACE 'G-XXXXXXXXXX' with your actual Google Analytics Measurement ID
    const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';

    // Load Google Analytics script
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);

    // Initialize gtag
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID, {
        'anonymize_ip': true,  // Anonymize IP for better privacy
        'cookie_flags': 'SameSite=None;Secure'
    });

    console.log('Google Analytics initialized with consent');
}

// Cookie Notice functionality
function acceptCookies() {
    localStorage.setItem('cookieConsent', 'accepted');
    document.getElementById('cookieNotice').classList.remove('show');

    // Initialize Google Analytics after consent
    initGoogleAnalytics();
}

function declineCookies() {
    localStorage.setItem('cookieConsent', 'declined');
    document.getElementById('cookieNotice').classList.remove('show');

    // Do NOT load Google Analytics
    console.log('User declined cookies - Analytics not loaded');
}

// Show cookie notice if not previously accepted or declined
window.addEventListener('load', function () {
    const cookieConsent = localStorage.getItem('cookieConsent');
    if (!cookieConsent) {
        // Show cookie banner if no choice made yet
        setTimeout(function () {
            document.getElementById('cookieNotice').classList.add('show');
        }, 1000);
    } else if (cookieConsent === 'accepted') {
        // If consent was previously given, load Analytics
        initGoogleAnalytics();
    }
    // If declined, do nothing (no analytics)
});

// Feature Steps Animation (Looping)
let animationInterval = null;

function animateFeatureSteps() {
    const featureItems = document.querySelectorAll('.hero-card-features .feature-item');
    const priceTag = document.querySelector('.price-tag');

    if (!featureItems.length) return;

    // Reset all states
    featureItems.forEach(item => {
        item.classList.remove('animate-active', 'animate-complete');
    });

    let delay = 0;

    featureItems.forEach((item, index) => {
        setTimeout(() => {
            // Remove previous active states
            featureItems.forEach(fi => fi.classList.remove('animate-active'));

            // Mark previous items as complete
            featureItems.forEach((fi, i) => {
                if (i < index) {
                    fi.classList.add('animate-complete');
                    fi.classList.remove('animate-active');
                }
            });

            // Add active animation to current item
            item.classList.add('animate-active');

            // On last item, also animate the price tag
            if (index === featureItems.length - 1) {
                setTimeout(() => {
                    if (priceTag) {
                        priceTag.classList.add('animate-bounce');
                        setTimeout(() => {
                            priceTag.classList.remove('animate-bounce');
                        }, 800);
                    }
                }, 800);
            }
        }, delay);

        delay += 1500; // 1.5 seconds between each step
    });

    // Keep final state briefly
    setTimeout(() => {
        featureItems.forEach(item => {
            item.classList.add('animate-complete');
        });
    }, delay);

    // Return total animation duration
    return delay;
}

function startAnimationLoop() {
    const featureItems = document.querySelectorAll('.hero-card-features .feature-item');
    if (!featureItems.length) return;

    // Initial animation
    const animationDuration = animateFeatureSteps();

    // Loop: restart after animation completes + pause
    animationInterval = setInterval(() => {
        animateFeatureSteps();
    }, animationDuration + 2000); // Animation duration + 2 second pause
}

function stopAnimationLoop() {
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
    }
}

// Trigger animation when hero card is in viewport
const observerOptions = {
    threshold: 0.3,
    rootMargin: '0px'
};

const heroCardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            // Start looping animation when visible
            if (!animationInterval) {
                setTimeout(() => {
                    startAnimationLoop();
                }, 500);
            }
        } else {
            // Stop animation when not visible (save performance)
            stopAnimationLoop();
        }
    });
}, observerOptions);

// Observe the hero card
window.addEventListener('load', () => {
    const heroCard = document.querySelector('.hero-card-features');
    if (heroCard) {
        heroCardObserver.observe(heroCard.parentElement);
    }
});

// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const headerHeight = header.offsetHeight;
            const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight - 20;
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
    });
});

// Chat Widget Toggle
const chatButton = document.getElementById('chatButton');
const chatWidget = document.getElementById('chatWidget');
const closeChatBtn = document.getElementById('closeChat');
const chatInput = document.getElementById('chatInput');
const sendMessageBtn = document.getElementById('sendMessage');
const chatMessages = document.getElementById('chatMessages');
const photoButton = document.getElementById('photoButton');
const photoInput = document.getElementById('photoInput');

chatButton.addEventListener('click', function () {
    chatWidget.classList.add('active');
    chatButton.style.display = 'none';
    chatInput.focus();
});

closeChatBtn.addEventListener('click', function () {
    chatWidget.classList.remove('active');
    chatButton.style.display = 'flex';
});

// Chat configuration
const API_URL = 'https://claude-production-e0ea.up.railway.app'; // Railway production server

// Generate or retrieve session ID from localStorage
function generateSessionId() {
    let sessionId = localStorage.getItem('smartwash_session_id');
    if (!sessionId) {
        sessionId = 'session-' + Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);
        localStorage.setItem('smartwash_session_id', sessionId);
    }
    return sessionId;
}

const SESSION_ID = generateSessionId();
let isOperatorMode = false;
let lastMessageTime = new Date().toISOString();
let pollingInterval = null;
let isPolling = false; // Prevent concurrent polling requests
let notificationPermission = 'default';

// Notification sound (notification beep)
const notificationSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjaQ1fPPejAFI3PD8t6UTAsRVrDl6KZUE');

// Request notification permission
async function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        try {
            notificationPermission = await Notification.requestPermission();
            console.log('Notification permission:', notificationPermission);
        } catch (error) {
            console.error('Error requesting notification permission:', error);
        }
    } else if ('Notification' in window) {
        notificationPermission = Notification.permission;
    }
}

// Show browser notification
function showNotification(title, body, icon = null) {
    if ('Notification' in window && notificationPermission === 'granted') {
        const notification = new Notification(title, {
            body: body,
            icon: icon || 'https://smart-wash.si/logo_smart_wash.svg',
            badge: 'https://smart-wash.si/logo_smart_wash.svg',
            tag: 'smartwash-message',
            requireInteraction: false,
            silent: false
        });

        // Auto close after 5 seconds
        setTimeout(() => notification.close(), 5000);

        // Click on notification opens/focuses chat
        notification.onclick = function () {
            window.focus();
            if (!chatWidget.classList.contains('active')) {
                chatWidget.classList.add('active');
                chatButton.style.display = 'none';
            }
            notification.close();
        };
    }
}

// Play notification sound
function playNotificationSound() {
    try {
        notificationSound.currentTime = 0;
        notificationSound.volume = 0.5;
        notificationSound.play().catch(e => console.log('Could not play sound:', e));
    } catch (error) {
        console.error('Error playing notification sound:', error);
    }
}

// Animate chat button (bounce effect)
function animateChatButton() {
    if (!chatWidget.classList.contains('active')) {
        chatButton.classList.add('bounce');
        setTimeout(() => chatButton.classList.remove('bounce'), 1000);
    }
}

// Send message to server
async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    // Request notification permission on first message
    if (notificationPermission === 'default') {
        requestNotificationPermission();
    }

    // Add user message and keep reference
    const userMessageElement = addMessage(message, 'user');
    chatInput.value = '';

    // Show typing indicator
    showTyping();

    try {
        const response = await fetch(`${API_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                sessionId: SESSION_ID
            })
        });

        const data = await response.json();

        hideTyping();

        if (data.error) {
            addMessage('Prišlo je do napake. Prosimo, poskusite znova.\\nAn error occurred. Please try again.', 'bot');
            return;
        }

        // Update operator mode status BEFORE adding message
        const wasOperatorMode = isOperatorMode;
        if (data.operatorMode && !isOperatorMode) {
            // Operator connected
            console.log('🟢 OPERATOR MODE: Activated');
            console.log(`   - lastMessageTime before: ${lastMessageTime}`);
            isOperatorMode = true;
            updateChatStatus('Operator');
            startPolling(); // Start polling for operator messages
            console.log('🔄 POLLING: Started');
        } else if (!data.operatorMode && isOperatorMode) {
            // Operator disconnected
            console.log('🔴 OPERATOR MODE: Deactivated');
            isOperatorMode = false;
            updateChatStatus('AI online');
            stopPolling();
        }

        // If response is just checkmarks, add them to user's message instead of creating new message
        if (data.response === '✓✓') {
            const statusSpan = userMessageElement.querySelector('.message-status');
            if (statusSpan) {
                statusSpan.textContent = ' ✓✓';
                statusSpan.style.color = '#34b7f1';
                statusSpan.style.marginLeft = '4px';
            }
        } else {
            // Don't update lastMessageTime when operator just connected (to avoid missing first operator message)
            const shouldUpdateTimestamp = !(data.operatorMode && !wasOperatorMode);
            console.log(`💬 Adding bot message, updateTimestamp: ${shouldUpdateTimestamp}`);
            if (!shouldUpdateTimestamp) {
                console.log('⚠️ NOT updating lastMessageTime to prevent missing operator messages');
            }
            addMessage(data.response, 'bot', shouldUpdateTimestamp);
            console.log(`   - lastMessageTime after: ${lastMessageTime}`);
        }

    } catch (error) {
        hideTyping();
        console.error('Error sending message:', error);
        addMessage('Povezava s strežnikom ni uspela. Prosimo, preverite ali je strežnik zagnan.\\nConnection to server failed. Please check if server is running.', 'bot');
    }
}

function addMessage(text, sender, updateTimestamp = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    messageDiv.innerHTML = `
                <div class="message-bubble">
                    <p>${linkifyUrls(text)}</p>
                    <span class="message-time">${new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })}<span class="message-status"></span></span>
                </div>
            `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    if (updateTimestamp) {
        lastMessageTime = new Date().toISOString();
    }
    return messageDiv; // Return the created element
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function linkifyUrls(text) {
    // Find all URLs first
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
        // Add escaped text before URL
        if (match.index > lastIndex) {
            parts.push(escapeHtml(text.substring(lastIndex, match.index)));
        }
        // Add URL as link (escaped)
        const url = match[0];
        parts.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: var(--primary-blue); text-decoration: underline; word-break: break-all;">${escapeHtml(url)}</a>`);
        lastIndex = urlRegex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
        parts.push(escapeHtml(text.substring(lastIndex)));
    }

    return parts.join('');
}

let typingIndicator = null;

function showTyping() {
    if (typingIndicator) return;

    typingIndicator = document.createElement('div');
    typingIndicator.className = 'chat-message bot typing-indicator';
    typingIndicator.innerHTML = `
                <div class="message-bubble">
                    <div class="typing-dots">
                        <span></span><span></span><span></span>
                    </div>
                </div>
            `;
    chatMessages.appendChild(typingIndicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideTyping() {
    if (typingIndicator) {
        typingIndicator.remove();
        typingIndicator = null;
    }
}

function updateChatStatus(status) {
    const statusElement = document.querySelector('.chat-status');
    if (statusElement) {
        statusElement.textContent = status;
    }
}

// Poll for new messages from operator
function startPolling() {
    if (pollingInterval) return;

    pollingInterval = setInterval(async () => {
        // Prevent concurrent requests
        if (isPolling) {
            console.log('Skipping poll - previous request still in progress');
            return;
        }

        isPolling = true;
        try {
            console.log(`🔄 POLLING: Requesting messages since ${lastMessageTime}, current operatorMode: ${isOperatorMode}`);
            const response = await fetch(`${API_URL}/api/messages/${SESSION_ID}?lastMessageTime=${lastMessageTime}`);
            const data = await response.json();

            console.log(`📥 POLLING: Received ${data.messages ? data.messages.length : 0} messages, operatorMode from server: ${data.operatorMode}`);
            if (data.messages && data.messages.length > 0) {
                console.log('📨 Messages:', data.messages.map(m => ({
                    content: m.content.substring(0, 30) + '...',
                    timestamp: m.timestamp
                })));

                // Show notification for new operator messages (wrapped in try-catch to prevent breaking message display)
                try {
                    playNotificationSound();
                    animateChatButton();

                    const firstMessage = data.messages[0].content.substring(0, 100);
                    showNotification(
                        '💬 Smart Wash',
                        `Novo sporočilo od operaterja\n${firstMessage}${firstMessage.length >= 100 ? '...' : ''}`,
                        'https://smart-wash.si/logo_smart_wash.svg'
                    );
                } catch (notificationError) {
                    console.error('❌ Notification error (non-critical):', notificationError);
                }

                data.messages.forEach(msg => {
                    // Add message without updating lastMessageTime
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'chat-message bot-message';

                    let content = '';
                    if (msg.photo) {
                        content = `
                                    <div class="message-bubble">
                                        <img src="${API_URL}${msg.photo}" alt="Photo" style="max-width: 100%; border-radius: 8px;">
                                        ${msg.content ? `<p>${linkifyUrls(msg.content)}</p>` : ''}
                                        <span class="message-time"><span class="operator-badge">👨‍💼 Operator</span> ${new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                `;
                    } else {
                        content = `
                                    <div class="message-bubble">
                                        <p>${linkifyUrls(msg.content)}</p>
                                        <span class="message-time"><span class="operator-badge">👨‍💼 Operator</span> ${new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                `;
                    }

                    messageDiv.innerHTML = content;
                    chatMessages.appendChild(messageDiv);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                });
                // Update lastMessageTime to the last message's timestamp
                const newLastMessageTime = data.messages[data.messages.length - 1].timestamp;
                console.log(`⏰ UPDATING lastMessageTime: ${lastMessageTime} → ${newLastMessageTime}`);
                lastMessageTime = newLastMessageTime;
                console.log(`✅ lastMessageTime updated to: ${lastMessageTime}`);
            }

            // Check if operator mode changed
            if (typeof data.operatorMode !== 'undefined') {
                console.log(`🔍 POLLING: Checking operatorMode - server: ${data.operatorMode}, client: ${isOperatorMode}`);

                if (data.operatorMode && !isOperatorMode) {
                    // Operator connected
                    console.log('🟢 POLLING: Operator connected');
                    isOperatorMode = true;
                    updateChatStatus('Operator');
                } else if (!data.operatorMode && isOperatorMode) {
                    // Operator disconnected
                    console.log('🔴 POLLING: Operator disconnected - updating status and stopping polling');
                    isOperatorMode = false;
                    updateChatStatus('AI online');
                    stopPolling();
                } else {
                    console.log(`✓ POLLING: Operator mode unchanged (${data.operatorMode})`);
                }
            } else {
                console.log('⚠️ POLLING: operatorMode not in response');
            }
        } catch (error) {
            console.error('Polling error:', error);
        } finally {
            isPolling = false; // Always reset the flag
        }
    }, 2000); // Poll every 2 seconds
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

// Photo upload function
async function sendPhoto(file) {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('sessionId', SESSION_ID);

    // Show preview in chat
    const reader = new FileReader();
    reader.onload = function (e) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message user photo-message';
        messageDiv.innerHTML = `
                    <div class="message-bubble">
                        <img src="${e.target.result}" alt="Photo" style="max-width: 100%; border-radius: 8px;">
                        <span class="message-time">${new Date().toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                `;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    reader.readAsDataURL(file);

    try {
        const response = await fetch(`${API_URL}/api/upload`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.error) {
            // Show specific error message if available
            const errorMsg = data.message || data.error || 'Napaka pri nalaganju fotografije / Error uploading photo';
            addMessage(errorMsg, 'bot');
            return;
        }

        // Update operator mode status
        if (data.operatorMode && !isOperatorMode) {
            // Operator connected
            isOperatorMode = true;
            updateChatStatus('Operator');
            startPolling();
        } else if (!data.operatorMode && isOperatorMode) {
            // Operator disconnected
            isOperatorMode = false;
            updateChatStatus('AI online');
            stopPolling();
        }
    } catch (error) {
        console.error('Error uploading photo:', error);
        addMessage('Napaka pri pošiljanju fotografije / Error sending photo', 'bot');
    }
}

// Photo button event listeners
photoButton.addEventListener('click', function () {
    photoInput.click();
});

photoInput.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) {
        sendPhoto(file);
        photoInput.value = ''; // Reset input
    }
});

sendMessageBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Initial greeting message
setTimeout(() => {
    addMessage('👋 Dobrodošli v Smart Wash!\n\nKako vam lahko pomagam? Pišite v katerem koli jeziku.\n\nHow can I help you? Write in any language.\n\nЧем могу помочь? Пишите на любом языке.', 'bot');
}, 500);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopPolling();
});

// Tab switching function
function switchTab(event, tabId) {
    // Remove active class from all tabs and content
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    // Add active class to clicked tab and corresponding content
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
        // Update URL hash without scrolling (if possible) or just set it
        // Using history.pushState to avoid default jump if we want smooth scroll, 
        // but user wants "relative addresses", so setting hash is good.
        // However, setting hash triggers hashchange, which calls handleQRCodeNavigation.
        // handleQRCodeNavigation calls switchTab. We need to avoid infinite loop.
        if (window.location.hash !== '#' + tabId) {
            history.pushState(null, null, '#' + tabId);
        }
    } else {
        // If called programmatically, find the button for this tab
        const targetButton = Array.from(tabButtons).find(btn =>
            btn.getAttribute('onclick')?.includes(`'${tabId}'`)
        );
        if (targetButton) targetButton.classList.add('active');
    }
    document.getElementById(tabId).classList.add('active');
}

// QR Code Handler - Auto-open tabs from URL hash
function handleQRCodeNavigation() {
    const hash = window.location.hash.substring(1); // Remove #
    const validTabs = ['washing', 'drying', 'disinfection', 'tokens', 'rules', 'problems'];

    console.log('QR Handler: hash =', hash);

    if (validTabs.includes(hash)) {
        console.log('QR Handler: Activating tab:', hash);

        // Wait for DOM to be ready, then activate tab
        setTimeout(() => {
            // Call switchTab programmatically (null first arg)
            switchTab(null, hash);

            // Verify tab was activated
            const tabContent = document.getElementById(hash);
            console.log('Tab element:', tabContent);
            console.log('Has active class:', tabContent?.classList.contains('active'));

            // Scroll to instructions section
            setTimeout(() => {
                const instructionsSection = document.getElementById('instructions');
                if (instructionsSection) {
                    instructionsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
        }, 100);
    }
}

// Handle QR codes on page load
window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, checking hash...');
    handleQRCodeNavigation();
});

// Also try on full load as backup
window.addEventListener('load', () => {
    console.log('Window loaded, checking hash again...');
    handleQRCodeNavigation();
});

// Handle QR codes when hash changes (e.g., clicking links)
window.addEventListener('hashchange', () => {
    console.log('Hash changed');
    handleQRCodeNavigation();
});
// Helper for service card links
function navigateToInstruction(tabId) {
    console.log('Navigating to instruction:', tabId);
    // 1. Switch tab
    switchTab(null, tabId);

    // 2. Scroll active tab button into view (Horizontal centering)
    setTimeout(() => {
        const activeBtn = document.querySelector('.tab-button.active');
        if (activeBtn) {
            activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, 100);

    // 3. Scroll to instructions section (Vertical centering)
    setTimeout(() => {
        const instructionsContainer = document.querySelector('.instructions-container');
        if (instructionsContainer) {
            // Scroll to center of viewport
            instructionsContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 100);

    // 4. Update hash if needed
    if (window.location.hash !== '#' + tabId) {
        // history.pushState(null, null, '#' + tabId);
    }
}
// Mobile Menu Swipe Gesture
document.addEventListener('DOMContentLoaded', function () {
    const menuTab = document.getElementById('menuTab');
    const mobileMenu = document.getElementById('mobileMenu');
    const mobileMenuContent = mobileMenu ? mobileMenu.querySelector('.mobile-menu-content') : null;
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const header = document.querySelector('header');

    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    let dragStartTime = 0;
    const threshold = 100; // px to snap open

    if (!menuTab || !mobileMenu || !mobileMenuContent) return;

    // Prevent default touch actions to allow custom drag
    menuTab.style.touchAction = 'none';

    // Ensure menu tab click works as toggle if not dragged
    menuTab.addEventListener('click', function (e) {
        if (isDragging) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (typeof toggleMobileMenu === 'function') {
            toggleMobileMenu();
        }
    });

    menuTab.addEventListener('touchstart', function (e) {
        // If menu is already open, ignore (or implement close swipe later)
        if (mobileMenu.classList.contains('active')) return;

        startY = e.touches[0].clientY;
        currentY = startY;
        dragStartTime = Date.now();
        isDragging = false;

        // Disable transitions for instant follow
        mobileMenuContent.style.transition = 'none';
        menuTab.style.transition = 'none';
    }, { passive: false });

    menuTab.addEventListener('touchmove', function (e) {
        // Prevent browser scrolling
        if (e.cancelable) e.preventDefault();

        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;

        // Only allow pulling down (positive delta)
        if (deltaY < 5) return;

        isDragging = true;

        // Make menu visible so we can see it sliding in
        if (!mobileMenu.classList.contains('active')) {
            mobileMenu.style.visibility = 'visible';
            mobileMenu.style.height = 'auto';
            mobileMenu.style.pointerEvents = 'none'; // Prevent clicks while dragging
        }

        // Move menu content (starts at -100%)
        // We add deltaY px to the negative percentage
        mobileMenuContent.style.transform = ranslateY(calc(-100 % + px));

        // Move tab (starts at translateY(100%) relative to header)
        // We add deltaY to its initial position
        menuTab.style.transform = ranslateY(calc(100 % + px));

    }, { passive: false });

    menuTab.addEventListener('touchend', function (e) {
        // Determine if we were dragging
        if (!isDragging) {
            // It was a tap, let click handler deal with it
            // But we still need to cleanup any started drag state
            mobileMenuContent.style.transition = '';
            menuTab.style.transition = '';
            mobileMenuContent.style.transform = '';
            menuTab.style.transform = '';
            mobileMenu.style.visibility = '';
            mobileMenu.style.height = '';
            mobileMenu.style.pointerEvents = '';
            return;
        }

        const deltaY = currentY - startY;
        const dragDuration = Date.now() - dragStartTime;

        // Determine if it was a valid 'open' gesture
        // Either moved a significant distance OR a quick flick
        const isSignificantDrag = deltaY > threshold;
        const isQuickFlick = (dragDuration < 300 && deltaY > 30);
        const shouldOpen = isSignificantDrag || isQuickFlick;

        // Animate to final state with ease-out for 'auto-closer' feel
        mobileMenuContent.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        menuTab.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

        if (shouldOpen) {
            // Animate to Open (0%)
            mobileMenuContent.style.transform = 'translateY(0)';

            // Animate tab back to top (original position) smoothly
            menuTab.style.transform = 'translateY(100%)';

            // After animation, set active class and cleanup
            setTimeout(() => {
                if (typeof toggleMobileMenu === 'function') {
                    // Ensure it's open
                    if (!mobileMenu.classList.contains('active')) {
                        toggleMobileMenu();
                    }
                } else {
                    mobileMenu.classList.add('active');
                    menuTab.classList.add('active');
                    if (mobileMenuBtn) mobileMenuBtn.classList.add('active');
                    document.body.style.overflow = 'hidden';
                }

                // Clear inline styles
                mobileMenuContent.style.transition = '';
                mobileMenuContent.style.transform = '';
                menuTab.style.transition = '';
                menuTab.style.transform = '';

                // Reset visibility/pointer-events handled by toggleMobileMenu/CSS
                mobileMenu.style.visibility = '';
                mobileMenu.style.height = '';
                mobileMenu.style.pointerEvents = '';
            }, 400); // Wait for transition
        } else {
            // Animate back to Closed (-100%)
            mobileMenuContent.style.transform = 'translateY(-100%)';
            menuTab.style.transform = 'translateY(100%)';

            // After animation, cleanup
            setTimeout(() => {
                mobileMenu.style.visibility = '';
                mobileMenu.style.height = '';
                mobileMenu.style.pointerEvents = '';

                mobileMenuContent.style.transition = '';
                mobileMenuContent.style.transform = '';
                menuTab.style.transition = '';
                menuTab.style.transform = '';
            }, 400);
        }

        // Reset dragging flag after a short delay to block click
        setTimeout(() => {
            isDragging = false;
        }, 100);
    });
});

// Laundry Machine Status Logic
document.addEventListener('DOMContentLoaded', () => {
    function updateMachineIcons(machines) {
        Object.values(machines).forEach(machine => {
            const iconEls = document.querySelectorAll(`[data-machine-id="${machine.id}"]`);
            iconEls.forEach(el => {
                const svg = el.querySelector('svg');
                if (machine.isRunning) {
                    el.classList.remove('machine-free');
                    el.classList.add('machine-busy');
                    if (svg) svg.unpauseAnimations();
                } else {
                    el.classList.remove('machine-busy');
                    el.classList.add('machine-free');
                    if (svg) svg.pauseAnimations();
                }
            });
        });
    }

    async function fetchMachineStatus() {
        try {
            const response = await fetch(`${API_URL}/api/laundry-status`);
            if (!response.ok) throw new Error('Network response was not ok');
            const machines = await response.json();
            updateMachineIcons(machines);
        } catch (error) {
            console.error('Error fetching machine status:', error);
        }
    }

    // Initial fetch
    fetchMachineStatus();

    // Fetch every 10 seconds
    setInterval(fetchMachineStatus, 10000);
});

