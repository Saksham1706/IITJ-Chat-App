document.addEventListener('DOMContentLoaded', () => {
    const roomsList = document.getElementById('rooms-list');
    const usersList = document.getElementById('users-list');
    const tabButtons = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const createRoomBtn = document.getElementById('create-room-btn');
    const createRoomModal = document.getElementById('create-room-modal');
    const createRoomForm = document.getElementById('create-room-form');
    const closeModalBtns = document.querySelectorAll('.close-modal-btn');
    const cancelBtns = document.querySelectorAll('.cancel-btn');
    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const roomInfoElement = document.getElementById('room-info');
    const chatContainer = document.getElementById('chat-container');
    const backBtn = document.getElementById('back-btn');
    const currentChatName = document.getElementById('current-chat-name');
    const currentChatUsers = document.getElementById('current-chat-users');
    const messageInputContainer = document.getElementById('message-input-container');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    const roomInfoBtn = document.getElementById('room-info-btn');
    const roomInfoModal = document.getElementById('room-info-modal');
    const roomUsersListElement = document.getElementById('room-users-list');
    const roomCreatedDate = document.getElementById('room-created-date');
    const roomCreatedBy = document.getElementById('room-created-by');
    const roomType = document.getElementById('room-type');
    const roomSearch = document.getElementById('room-search');
    const userSearch = document.getElementById('user-search');
    const attachmentBtn = document.getElementById('attachment-btn');
    const fileUploadMenu = document.getElementById('file-upload-menu');
    const closeUploadBtn = document.getElementById('close-upload-btn');
    const fileUploadForm = document.getElementById('file-upload-form');
    const fileInput = document.getElementById('file-input');


    let currentUser = null;
    let currentRoom = null;
    let currentDMUser = null;
    let activeTab = 'rooms';
    let rooms = [];
    let users = [];
    let unreadCounts = {};
    let socket = null;

    function initializeSocket() {
        socket = io();

        socket.on('connect', () => {
            console.log('Connected to server');
            loadRooms();
            loadUsers();
            loadUnreadCounts();
        });

        socket.on('connected', (data) => {
            currentUser = data.user_id;
        });

        socket.on('message', (data) => {
            if (currentRoom) {
                appendMessage(data);
                scrollToBottom();
            }
        });

        socket.on('direct_message', (data) => {
            const currentUsername = document.querySelector('.username').textContent;
            
            if (currentDMUser) {
                if ((data.sender_username === currentDMUser.username && data.recipient_username === currentUsername) ||
                    (data.recipient_username === currentDMUser.username && data.sender_username === currentUsername)) {
                    appendDirectMessage(data);
                    scrollToBottom();
                }
            } else {
                loadUnreadCounts();
                updateUsersList();
            }
        });

        socket.on('chat_history', (data) => {
            displayMessages(data.messages);
        });

        socket.on('error', (data) => {
            showNotification(data.message, 'error');
        });
    }


    function loadRooms() {
        fetch('/api/rooms')
            .then(response => response.json())
            .then(data => {
                rooms = data;
                updateRoomsList();
            })
            .catch(error => {
                console.error('Error loading rooms:', error);
                showNotification('Failed to load rooms', 'error');
            });
    }


    function loadUsers() {
        fetch('/api/users')
            .then(response => response.json())
            .then(data => {
                users = data;
                updateUsersList();
            })
            .catch(error => {
                console.error('Error loading users:', error);
                showNotification('Failed to load users', 'error');
            });
    }


    function loadUnreadCounts() {
        fetch('/api/direct-messages/unread')
            .then(response => response.json())
            .then(data => {
                unreadCounts = data;
                updateUsersList();
            })
            .catch(error => {
                console.error('Error loading unread counts:', error);
            });
    }


    function updateRoomsList() {
        roomsList.innerHTML = '';
        
        const filteredRooms = roomSearch.value ? 
            rooms.filter(room => room.name.toLowerCase().includes(roomSearch.value.toLowerCase())) : 
            rooms;
        
        filteredRooms.forEach(room => {
            const roomElement = document.createElement('div');
            roomElement.className = 'room-item';
            if (currentRoom && currentRoom.id === room.id) {
                roomElement.classList.add('active');
            }
            
            roomElement.innerHTML = `
                <div class="room-name">${room.name}</div>
                <div class="room-meta">
                    <span class="room-type">${room.is_private ? 'Private' : 'Public'}</span>
                </div>
            `;
            
            roomElement.addEventListener('click', () => {
                joinRoom(room);
            });
            
            roomsList.appendChild(roomElement);
        });
    }


    function updateUsersList() {
        usersList.innerHTML = '';
        
        const filteredUsers = userSearch.value ? 
            users.filter(user => user.username.toLowerCase().includes(userSearch.value.toLowerCase())) : 
            users;
        
        filteredUsers.forEach(user => {
            if (user.id === currentUser) return;
            
            const userElement = document.createElement('div');
            userElement.className = 'user-item';
            if (currentDMUser && currentDMUser.id === user.id) {
                userElement.classList.add('active');
            }
            
            const unreadCount = unreadCounts[user.id] || 0;
            const unreadBadge = unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : '';
            
            userElement.innerHTML = `
                <div class="user-name">${user.username}</div>
                ${unreadBadge}
            `;
            
            userElement.addEventListener('click', () => {
                startDirectMessage(user);
            });
            
            usersList.appendChild(userElement);
        });
    }


    function joinRoom(room) {
        currentRoom = room;
        currentDMUser = null;
        

        messagesContainer.innerHTML = '';
        
        roomInfoElement.style.display = 'flex';
        messageInputContainer.style.display = 'flex';
        currentChatName.textContent = room.name;
        

        socket.emit('join', { room_id: room.id });
        

        updateRoomsList();
        
  
        document.querySelector('.welcome-message').style.display = 'none';
    }

 
    function startDirectMessage(user) {
        currentDMUser = user;
        currentRoom = null;
        
 
        messagesContainer.innerHTML = '';
        

        roomInfoElement.style.display = 'flex';
        messageInputContainer.style.display = 'flex';
        currentChatName.textContent = user.username;
        currentChatUsers.textContent = 'Direct Message';
        
  
        loadDirectMessages(user.id);
        

        updateUsersList();
        

        document.querySelector('.welcome-message').style.display = 'none';
    }

 
    function loadDirectMessages(userId) {
        fetch(`/api/direct-messages/${userId}`)
            .then(response => response.json())
            .then(data => {
                displayDirectMessages(data);
            })
            .catch(error => {
                console.error('Error loading direct messages:', error);
                showNotification('Failed to load messages', 'error');
            });
    }


    function displayMessages(messages) {
        messagesContainer.innerHTML = '';
        messages.forEach(message => {
            appendMessage(message);
        });
        scrollToBottom();
    }

 
    function displayDirectMessages(messages) {
        messagesContainer.innerHTML = '';
        messages.forEach(message => {
            appendDirectMessage(message);
        });
        scrollToBottom();
    }


    function appendMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        
        const isCurrentUser = message.username === document.querySelector('.username').textContent;
        if (isCurrentUser) {
            messageElement.classList.add('own-message');
        }
        
        let messageContent = '';
        if (message.is_file) {
            const fileExtension = message.file_path.split('.').pop().toLowerCase();
            const isImage = ['jpg', 'jpeg', 'png', 'gif'].includes(fileExtension);
            
            if (isImage) {
                messageContent = `
                    <a href="/uploads/${message.file_path}" target="_blank" class="image-link">
                        <img src="/uploads/${message.file_path}" alt="Shared image" class="shared-image" 
                            onclick="openImageModal('/uploads/${message.file_path}'); return false;">
                    </a>
                `;
            } else {
                messageContent = `
                    <div class="file-attachment">
                        <span class="file-icon">📎</span>
                        <a href="/uploads/${message.file_path}" target="_blank">${message.content.replace('Shared file: ', '')}</a>
                    </div>
                `;
            }
        } else {
            messageContent = `<p>${message.content}</p>`;
        }
        
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-author">${message.username}</span>
                <span class="message-time">${message.timestamp}</span>
            </div>
            <div class="message-content">
                ${messageContent}
            </div>
        `;
        
        messagesContainer.appendChild(messageElement);
    }


    function appendDirectMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        
        const isCurrentUser = message.sender_username === document.querySelector('.username').textContent;
        if (isCurrentUser) {
            messageElement.classList.add('own-message');
        }
        
        let messageContent = '';
        if (message.is_file) {
            const fileExtension = message.file_path.split('.').pop().toLowerCase();
            const isImage = ['jpg', 'jpeg', 'png', 'gif'].includes(fileExtension);
            
            if (isImage) {
                messageContent = `
                    <a href="/uploads/${message.file_path}" target="_blank" class="image-link">
                        <img src="/uploads/${message.file_path}" alt="Shared image" class="shared-image" 
                            onclick="openImageModal('/uploads/${message.file_path}'); return false;">
                    </a>
                `;
            } else {
                messageContent = `
                    <div class="file-attachment">
                        <span class="file-icon">📎</span>
                        <a href="/uploads/${message.file_path}" target="_blank">${message.content.replace('Shared file: ', '')}</a>
                    </div>
                `;
            }
        } else {
            messageContent = `<p>${message.content}</p>`;
        }
        
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-author">${message.sender_username}</span>
                <span class="message-time">${message.timestamp}</span>
            </div>
            <div class="message-content">
                ${messageContent}
            </div>
        `;
        
        messagesContainer.appendChild(messageElement);
    }
    function appendDirectMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        
        const isCurrentUser = message.sender_username === document.querySelector('.username').textContent;
        if (isCurrentUser) {
            messageElement.classList.add('own-message');
        }
        
        let messageContent = '';
        if (message.is_file) {
            const fileExtension = message.file_path.split('.').pop().toLowerCase();
            const isImage = ['jpg', 'jpeg', 'png', 'gif'].includes(fileExtension);
            
            if (isImage) {
                messageContent = `
                    <a href="/uploads/${message.file_path}" target="_blank" class="image-link">
                        <img src="/uploads/${message.file_path}" alt="Shared image" class="shared-image" 
                             onclick="openImageModal('/uploads/${message.file_path}'); return false;">
                    </a>
                `;
            } else {
                messageContent = `
                    <div class="file-attachment">
                        <span class="file-icon">📎</span>
                        <a href="/uploads/${message.file_path}" target="_blank">${message.content.replace('Shared file: ', '')}</a>
                    </div>
                `;
            }
        } else {
            messageContent = `<p>${message.content}</p>`;
        }
        
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-author">${message.sender_username}</span>
                <span class="message-time">${message.timestamp}</span>
            </div>
            <div class="message-content">
                ${messageContent}
            </div>
        `;
        
        messagesContainer.appendChild(messageElement);
    }


    function sendMessage() {
        const messageText = messageInput.value.trim();
        if (!messageText) return;
        
        if (currentRoom) {
            socket.emit('message', { text: messageText });
        } else if (currentDMUser) {
            socket.emit('direct_message', { recipient_id: currentDMUser.id, text: messageText });
        }
        
        messageInput.value = '';
    }

    function uploadFile(event) {
        event.preventDefault();
        
        const file = fileInput.files[0];
        if (!file) {
            showNotification('No file selected', 'error');
            return;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        
 
        const tempMessageId = 'temp-' + Date.now();
        const loadingMessage = document.createElement('div');
        loadingMessage.className = 'message own-message';
        loadingMessage.id = tempMessageId;
        loadingMessage.innerHTML = `
            <div class="message-header">
                <span class="message-author">${document.querySelector('.username').textContent}</span>
                <span class="message-time">Uploading...</span>
            </div>
            <div class="message-content">
                <div class="file-uploading">
                    <span class="file-icon">📤</span>
                    <span>Uploading ${file.name}...</span>
                </div>
            </div>
        `;
        messagesContainer.appendChild(loadingMessage);
        scrollToBottom();
        
        if (currentRoom) {
            formData.append('room_id', currentRoom.id);
        } else if (currentDMUser) {
            formData.append('recipient_id', currentDMUser.id);
        }
        
        fetch('/api/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            const loadingElement = document.getElementById(tempMessageId);
            if (loadingElement) {
                messagesContainer.removeChild(loadingElement);
            }
            
            fileUploadMenu.style.display = 'none';
            fileInput.value = '';
            showNotification('File uploaded successfully', 'success');
        })
        .catch(error => {
            console.error('Error uploading file:', error);
            const loadingElement = document.getElementById(tempMessageId);
            if (loadingElement) {
                messagesContainer.removeChild(loadingElement);
            }
            showNotification('Failed to upload file', 'error');
        });
    }
    

    function createRoom(event) {
        event.preventDefault();
        
        const roomName = document.getElementById('new-room-name').value.trim();
        const isPrivate = document.getElementById('is-private-room').checked;
        
        if (!roomName) return;
        
        fetch('/api/rooms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                room_name: roomName,
                is_private: isPrivate
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Room creation failed');
            }
            return response.json();
        })
        .then(data => {
            createRoomModal.style.display = 'none';
            document.getElementById('new-room-name').value = '';
            document.getElementById('is-private-room').checked = false;
            showNotification('Room created successfully', 'success');
            loadRooms();
        })
        .catch(error => {
            console.error('Error creating room:', error);
            showNotification('Failed to create room', 'error');
        });
    }

   
    function leaveRoom() {
        if (currentRoom) {
            socket.emit('leave');
            currentRoom = null;
            resetChatView();
        }
    }


    function showRoomInfo() {
        if (!currentRoom) return;
        

        const room = rooms.find(r => r.id === currentRoom.id);
        if (!room) return;
        
        roomCreatedDate.textContent = room.created_at;
        roomType.textContent = room.is_private ? 'Private' : 'Public';
        roomCreatedBy.textContent = 'Unknown'; 
        roomUsersListElement.innerHTML = '<li>Loading users...</li>';
        
        roomInfoModal.style.display = 'block';
    }


    function resetChatView() {
        roomInfoElement.style.display = 'none';
        messageInputContainer.style.display = 'none';
        document.querySelector('.welcome-message').style.display = 'block';
        messagesContainer.innerHTML = '';
        messagesContainer.appendChild(document.querySelector('.welcome-message'));
    }


    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }


    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }


    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tab = button.getAttribute('data-tab');
            
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            button.classList.add('active');
            document.getElementById(`${tab}-tab`).classList.add('active');
            
            activeTab = tab;
        });
    });
    

    createRoomBtn.addEventListener('click', () => {
        createRoomModal.style.display = 'block';
    });
    

    closeModalBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(modal => {
                modal.style.display = 'none';
            });
        });
    });
    
 
    cancelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').style.display = 'none';
        });
    });
    

    createRoomForm.addEventListener('submit', createRoom);
    

    sendBtn.addEventListener('click', sendMessage);
    

    messageInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            sendMessage();
        }
    });
    
  
    backBtn.addEventListener('click', () => {
        if (currentRoom) {
            leaveRoom();
        } else if (currentDMUser) {
            currentDMUser = null;
            resetChatView();
        }
    });
    
    
    leaveRoomBtn.addEventListener('click', (event) => {
        event.preventDefault();
        if (currentRoom) {
            leaveRoom();
        }
    });
    

    roomInfoBtn.addEventListener('click', (event) => {
        event.preventDefault();
        showRoomInfo();
    });
    
 
    roomSearch.addEventListener('input', updateRoomsList);
    

    userSearch.addEventListener('input', updateUsersList);
    

    attachmentBtn.addEventListener('click', () => {
        fileUploadMenu.style.display = 'block';
    });
    

    closeUploadBtn.addEventListener('click', () => {
        fileUploadMenu.style.display = 'none';
    });
    
 
    fileUploadForm.addEventListener('submit', uploadFile);
    
    window.addEventListener('click', (event) => {
        document.querySelectorAll('.modal').forEach(modal => {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    });


    window.openImageModal = function(imageSrc) {
        const modal = document.getElementById('image-modal');
        const modalImage = document.getElementById('modal-image');
        modalImage.src = imageSrc;
        modal.style.display = 'flex';
        event.stopPropagation();
    };

    window.closeImageModal = function() {
        const modal = document.getElementById('image-modal');
        modal.style.display = 'none';
    };

    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            closeImageModal();
        }
    });

    initializeSocket();
});