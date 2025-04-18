document.addEventListener('DOMContentLoaded', () => {
    const menuItems = document.querySelectorAll('.admin-menu li');
    const sections = document.querySelectorAll('.admin-section');
    const totalUsersElement = document.getElementById('total-users');
    const totalRoomsElement = document.getElementById('total-rooms');
    const totalMessagesElement = document.getElementById('total-messages');
    const totalFilesElement = document.getElementById('total-files');
    const usersList = document.getElementById('users-list');
    const roomsList = document.getElementById('rooms-list');
    const messagesList = document.getElementById('messages-list');
    const filesList = document.getElementById('files-list');
    const createUserBtn = document.getElementById('create-user-btn');
    const createRoomBtn = document.getElementById('create-room-btn');
    const userModal = document.getElementById('user-modal');
    const roomModal = document.getElementById('room-modal');
    const userForm = document.getElementById('user-form');
    const roomForm = document.getElementById('room-form');
    const userCancelBtn = document.getElementById('user-cancel-btn');
    const roomCancelBtn = document.getElementById('room-cancel-btn');
    const userSearch = document.getElementById('user-search');
    const roomSearch = document.getElementById('room-search');
    const messageSearch = document.getElementById('message-search');
    const fileSearch = document.getElementById('file-search');
    const messageRoomFilter = document.getElementById('message-room-filter');
    const fileTypeFilter = document.getElementById('file-type-filter');
    const closeBtns = document.querySelectorAll('.close-btn');

    loadDashboardData();

    let users = [];
    let rooms = [];
    let messages = [];
    let files = [];
    let messageTotal = 0;
    let filesTotal = 0;
    let currentUserId = null;
    
    checkApiEndpoints();
        
    function checkApiEndpoints() {
        Promise.all([
            fetch('/api/admin/messages').then(res => res.ok),
            fetch('/api/admin/files').then(res => res.ok)
        ])
        .then(([messagesOk, filesOk]) => {
            if (!messagesOk) {
                showNotification('Message moderation API endpoint is not available. Some features may not work.', 'warning');
                document.querySelector('[data-section="messages"]').classList.add('disabled');
            }
            
            if (!filesOk) {
                showNotification('File management API endpoint is not available. Some features may not work.', 'warning');
                document.querySelector('[data-section="files"]').classList.add('disabled');
            }
        })
        .catch(() => {
            showNotification('Could not check API availability. Some features may not work.', 'warning');
        });
    }

    function loadDashboardData() {
        Promise.all([
            fetch('/api/admin/users').then(res => res.json()),
            fetch('/api/admin/rooms').then(res => res.json()),
            fetch('/api/admin/messages').then(res => res.json()).catch(() => ({ messages: [], total: 0 })),
            fetch('/api/admin/files').then(res => res.json()).catch(() => ({ files: [], total: 0 }))
        ])
        .then(([usersData, roomsData, messagesData, filesData]) => {
            users = usersData;
            rooms = roomsData;
            messages = messagesData.messages || [];
            messageTotal = messagesData.total || 0;
            files = filesData.files || [];
            filesTotal = filesData.total || 0;
            
            updateDashboard();
            updateUsersList();
            updateRoomsList();
            updateMessagesList();
            updateFilesList();
            updateRoomFilter();
        })
        .catch(error => {
            console.error('Error loading admin data:', error);
            showNotification('Failed to load admin data. Please refresh.', 'error');
        });
    }

    function updateDashboard() {
        totalUsersElement.textContent = users.length;
        totalRoomsElement.textContent = rooms.length;
        totalMessagesElement.textContent = messageTotal || 'N/A';
        totalFilesElement.textContent = filesTotal || 'N/A';
    }


    function updateUsersList() {
        usersList.innerHTML = '';
        
        const filteredUsers = userSearch.value ? 
            users.filter(user => 
                user.username.toLowerCase().includes(userSearch.value.toLowerCase()) ||
                user.email.toLowerCase().includes(userSearch.value.toLowerCase())
            ) : users;
        
        filteredUsers.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td>${user.email}</td>
                <td>${user.is_admin ? 'Admin' : 'User'}</td>
                <td>${user.created_at}</td>
                <td>
                    <button class="edit-btn" data-id="${user.id}">Edit</button>
                    <button class="delete-btn" data-id="${user.id}">Delete</button>
                </td>
            `;
            usersList.appendChild(row);
            
            row.querySelector('.edit-btn').addEventListener('click', () => editUser(user));
            row.querySelector('.delete-btn').addEventListener('click', () => deleteUser(user.id));
        });
    }


    function updateRoomsList() {
        roomsList.innerHTML = '';
        
        const filteredRooms = roomSearch.value ? 
            rooms.filter(room => 
                room.name.toLowerCase().includes(roomSearch.value.toLowerCase())
            ) : rooms;
        
        filteredRooms.forEach(room => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${room.id}</td>
                <td>${room.name}</td>
                <td>${room.is_private ? 'Private' : 'Public'}</td>
                <td>${room.created_at}</td>
                <td>${getUsernameById(room.created_by) || 'System'}</td>
                <td>
                    <button class="delete-btn" data-id="${room.id}">Delete</button>
                </td>
            `;
            roomsList.appendChild(row);
            
            row.querySelector('.delete-btn').addEventListener('click', () => deleteRoom(room.id));
        });
    }


    function updateMessagesList() {
        if (!messages.length) {
            messagesList.innerHTML = '<tr><td colspan="6">No messages data available</td></tr>';
            return;
        }
        
        messagesList.innerHTML = '';
        
        const roomFilter = messageRoomFilter.value;
        const searchTerm = messageSearch.value.toLowerCase();
        
        const filteredMessages = messages.filter(message => {
            const matchesRoom = !roomFilter || message.room_id === roomFilter;
            const matchesSearch = !searchTerm || 
                message.content.toLowerCase().includes(searchTerm) ||
                (message.username && message.username.toLowerCase().includes(searchTerm));
                
            return matchesRoom && matchesSearch;
        });
        
        filteredMessages.forEach(message => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${message.id}</td>
                <td>${message.username || 'Unknown'}</td>
                <td>${message.room ? message.room.name : getRoomNameById(message.room_id)}</td>
                <td>${message.content}</td>
                <td>${message.timestamp} ${message.date ? message.date : ''}</td>
                <td>
                    <button class="delete-btn" data-id="${message.id}">Delete</button>
                </td>
            `;
            messagesList.appendChild(row);
            
            row.querySelector('.delete-btn').addEventListener('click', () => deleteMessage(message.id));
        });
    }


    function updateFilesList() {
        if (!files.length) {
            filesList.innerHTML = '<tr><td colspan="7">No files data available</td></tr>';
            return;
        }
        
        filesList.innerHTML = '';
        
        const typeFilter = fileTypeFilter.value;
        const searchTerm = fileSearch.value.toLowerCase();
        
        const filteredFiles = files.filter(file => {
            const fileType = file.type || getFileTypeFromPath(file.filename || file.file_path || '');
            const matchesType = !typeFilter || fileType === typeFilter;
            const uploadedBy = file.uploaded_by || file.sender_username || file.username || 'Unknown';
            const matchesSearch = !searchTerm || 
                (file.name || file.original_name || '').toLowerCase().includes(searchTerm) ||
                uploadedBy.toLowerCase().includes(searchTerm);
                    
            return matchesType && matchesSearch;
        });
        
        filteredFiles.forEach(file => {
            
            const filename = file.filename || file.file_path || '';
            const name = file.name || file.original_name || filename;
            const uploadedBy = file.uploaded_by || file.sender_username || file.username || 'Unknown';
            const uploadedAt = file.uploaded_at || file.timestamp || file.date || '';
            const fileType = file.type || getFileTypeFromPath(filename);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${file.id}</td>
                <td>${name}</td>
                <td>${fileType}</td>
                <td>${file.size || 'N/A'}</td>
                <td>${uploadedBy}</td>
                <td>${uploadedAt}</td>
                <td>
                    <button class="view-btn" data-path="${filename}">View</button>
                    <button class="delete-btn" data-id="${file.id}">Delete</button>
                </td>
            `;
            filesList.appendChild(row);
            
            row.querySelector('.view-btn').addEventListener('click', () => viewFile(filename));
            row.querySelector('.delete-btn').addEventListener('click', () => deleteFile(file.id));
        });
    }

 
    function updateRoomFilter() {
        messageRoomFilter.innerHTML = '<option value="">All Rooms</option>';
        
        rooms.forEach(room => {
            const option = document.createElement('option');
            option.value = room.id;
            option.textContent = room.name;
            messageRoomFilter.appendChild(option);
        });
    }


    function getUsernameById(userId) {
        const user = users.find(user => user.id === userId);
        return user ? user.username : 'Unknown';
    }

 
    function getRoomNameById(roomId) {
        const room = rooms.find(room => room.id === roomId);
        return room ? room.name : 'Unknown';
    }


    function getFileTypeFromPath(path) {
        if (!path) return 'unknown';
        const ext = path.split('.').pop().toLowerCase();
        
        if (['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(ext)) {
            return 'image';
        } else if (['pdf', 'doc', 'docx', 'txt'].includes(ext)) {
            return 'document';
        } else {
            return 'other';
        }
    }

r
    function editUser(user) {
        document.getElementById('user-username').value = user.username;
        document.getElementById('user-email').value = user.email;
        document.getElementById('user-password').value = ''; 
        document.getElementById('user-role').value = user.is_admin ? 'admin' : 'user';
        document.getElementById('user-modal-title').textContent = 'Edit User';
        currentUserId = user.id;
        userModal.style.display = 'block';
    }


    function createUser() {
        document.getElementById('user-username').value = '';
        document.getElementById('user-email').value = '';
        document.getElementById('user-password').value = '';
        document.getElementById('user-role').value = 'user';
        document.getElementById('user-modal-title').textContent = 'Create User';
        currentUserId = null;
        
        userModal.style.display = 'block';
    }


    function saveUser(event) {
        event.preventDefault();
        
        const username = document.getElementById('user-username').value;
        const email = document.getElementById('user-email').value;
        const password = document.getElementById('user-password').value;
        const isAdmin = document.getElementById('user-role').value === 'admin';
        
        if (!username || !email) {
            showNotification('Username and email are required', 'error');
            return;
        }
        
        const userData = {
            username,
            email,
            is_admin: isAdmin
        };
        
        if (password) {
            userData.password = password;
        }
        
        const method = currentUserId ? 'PUT' : 'POST';
        const url = currentUserId ? `/api/admin/users/${currentUserId}` : '/api/admin/users';
        
        fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to save user');
            }
            return response.json();
        })
        .then(() => {
            loadDashboardData();
            userModal.style.display = 'none';
            showNotification(currentUserId ? 'User updated successfully' : 'User created successfully', 'success');
        })
        .catch(error => {
            console.error('Error saving user:', error);
            showNotification('Failed to save user. Please try again.', 'error');
        });
    }

    function deleteUser(userId) {
        if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
            fetch(`/api/admin/users/${userId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to delete user');
                }
                return response.json();
            })
            .then(data => {
                users = users.filter(user => user.id !== userId);
                updateUsersList();
                showNotification('User deleted successfully', 'success');
            })
            .catch(error => {
                console.error('Error deleting user:', error);
                showNotification('Failed to delete user', 'error');
            });
        }
    }


    function createRoom() {
        document.getElementById('room-name').value = '';
        document.getElementById('room-type').value = 'public';
        document.getElementById('room-modal-title').textContent = 'Create Room';
        roomModal.style.display = 'block';
    }

    function saveRoom(event) {
        event.preventDefault();
        
        const roomName = document.getElementById('room-name').value;
        const isPrivate = document.getElementById('room-type').value === 'private';
        
        if (!roomName) {
            showNotification('Room name is required', 'error');
            return;
        }
        
        const roomData = {
            room_name: roomName,
            is_private: isPrivate
        };
        
        fetch('/api/admin/rooms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(roomData)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to create room');
            }
            return response.json();
        })
        .then(() => {
            loadDashboardData();
            roomModal.style.display = 'none';
            showNotification('Room created successfully', 'success');
        })
        .catch(error => {
            console.error('Error creating room:', error);
            showNotification('Failed to create room. Please try again.', 'error');
        });
    }

    function deleteRoom(roomId) {
        if (!confirm('Are you sure you want to delete this room? All messages in this room will also be deleted. This action cannot be undone.')) {
            return;
        }
        
        fetch(`/api/admin/rooms/${roomId}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to delete room');
            }
            return response.json();
        })
        .then(() => {
            loadDashboardData();
            showNotification('Room deleted successfully', 'success');
        })
        .catch(error => {
            console.error('Error deleting room:', error);
            showNotification('Failed to delete room. Please try again.', 'error');
        });
    }


    function deleteMessage(messageId) {
        if (!confirm('Are you sure you want to delete this message? This action cannot be undone.')) {
            return;
        }
        
        fetch(`/api/admin/messages/${messageId}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to delete message');
            }
            return response.json();
        })
        .then(() => {
            loadDashboardData();
            showNotification('Message deleted successfully', 'success');
        })
        .catch(error => {
            console.error('Error deleting message:', error);
            showNotification('Failed to delete message. Please try again.', 'error');
        });
    }

    function viewFile(filePath) {
        window.open(`/uploads/${filePath}`, '_blank');
    }


    function deleteFile(fileId) {
        if (!confirm('Are you sure you want to delete this file? This action cannot be undone.')) {
            return;
        }
        
        fetch(`/api/admin/files/${fileId}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to delete file');
            }
            return response.json();
        })
        .then(() => {
            loadDashboardData();
            showNotification('File deleted successfully', 'success');
        })
        .catch(error => {
            console.error('Error deleting file:', error);
            showNotification('Failed to delete file. Please try again.', 'error');
        });
    }


    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        

        document.body.appendChild(notification);
        

        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 500);
        }, 3000);
    }


    menuItems.forEach(item => {
        item.addEventListener('click', () => {

            menuItems.forEach(i => i.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            item.classList.add('active');
            const sectionId = item.getAttribute('data-section');
            document.getElementById(sectionId).classList.add('active');
        });
    });


    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            userModal.style.display = 'none';
            roomModal.style.display = 'none';
        });
    });


    userCancelBtn.addEventListener('click', () => {
        userModal.style.display = 'none';
    });
    
    roomCancelBtn.addEventListener('click', () => {
        roomModal.style.display = 'none';
    });


    window.addEventListener('click', event => {
        if (event.target === userModal) {
            userModal.style.display = 'none';
        }
        if (event.target === roomModal) {
            roomModal.style.display = 'none';
        }
    });


    userSearch.addEventListener('input', updateUsersList);
    roomSearch.addEventListener('input', updateRoomsList);
    messageSearch.addEventListener('input', updateMessagesList);
    fileSearch.addEventListener('input', updateFilesList);

    messageRoomFilter.addEventListener('change', updateMessagesList);
    fileTypeFilter.addEventListener('change', updateFilesList);

    createUserBtn.addEventListener('click', createUser);
    createRoomBtn.addEventListener('click', createRoom);

    userForm.addEventListener('submit', saveUser);
    roomForm.addEventListener('submit', saveRoom);

    loadDashboardData();

    fetch('/api/admin/messages')
        .catch(() => {
            showNotification('Message moderation API endpoint is not implemented in the backend.', 'warning');
        });
        
    fetch('/api/admin/files')
        .catch(() => {
            showNotification('File management API endpoint is not implemented in the backend.', 'warning');
        });
});