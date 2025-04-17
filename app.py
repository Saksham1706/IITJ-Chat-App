from flask import Flask, render_template, request, jsonify, session, redirect, url_for, flash, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import os
import secrets
from datetime import datetime
import uuid
import hashlib
from collections import deque

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(16)
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///chat.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max upload
app.config['ALLOWED_EXTENSIONS'] = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx'}

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Initialize extensions
db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# Message cache using deque (DSA: Queue)
message_cache = {}  # Room-specific message queues
max_cache_size = 100

# User sessions cache (DSA: Hash table)
user_sessions = {}

# Room hierarchy (DSA: Tree structure)
class RoomNode:
    def __init__(self, name, parent=None):
        self.name = name
        self.parent = parent
        self.children = []
        self.users = set()
        
    def add_child(self, child):
        self.children.append(child)
        
    def add_user(self, user_id):
        self.users.add(user_id)
        
    def remove_user(self, user_id):
        if user_id in self.users:
            self.users.remove(user_id)

# Root of room tree
room_tree = RoomNode("Global")

# Database Models
class User(db.Model, UserMixin):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = db.Column(db.String(50), unique=True, nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationship with messages
    messages = db.relationship('Message', backref='author', lazy=True)
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
        
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'is_admin': self.is_admin,
            'created_at': self.created_at.strftime("%Y-%m-%d %H:%M:%S")
        }

class Room(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(50), unique=True, nullable=False)
    is_private = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=True)
    
    # Relationship with messages
    messages = db.relationship('Message', backref='room', lazy=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'is_private': self.is_private,
            'created_at': self.created_at.strftime("%Y-%m-%d %H:%M:%S")
        }

class Message(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    is_file = db.Column(db.Boolean, default=False)
    file_path = db.Column(db.String(255), nullable=True)
    
    # Foreign keys
    user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    room_id = db.Column(db.String(36), db.ForeignKey('room.id'), nullable=False)
    
    def to_dict(self):
        return {
            'id': self.id,
            'content': self.content,
            'timestamp': self.timestamp.strftime("%H:%M:%S"),
            'date': self.timestamp.strftime("%Y-%m-%d"),
            'username': self.author.username,
            'is_file': self.is_file,
            'file_path': self.file_path if self.is_file else None
        }

class DirectMessage(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    is_file = db.Column(db.Boolean, default=False)
    file_path = db.Column(db.String(255), nullable=True)
    is_read = db.Column(db.Boolean, default=False)
    
    # Foreign keys
    sender_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    recipient_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    
    sender = db.relationship('User', foreign_keys=[sender_id])
    recipient = db.relationship('User', foreign_keys=[recipient_id])
    
    def to_dict(self):
        return {
            'id': self.id,
            'content': self.content,
            'timestamp': self.timestamp.strftime("%H:%M:%S"),
            'date': self.timestamp.strftime("%Y-%m-%d"),
            'sender_username': self.sender.username,
            'recipient_username': self.recipient.username,
            'is_file': self.is_file,
            'file_path': self.file_path if self.is_file else None,
            'is_read': self.is_read
        }

# Helper functions
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def get_hash_for_file(file_path):
    """Generate SHA-256 hash for a file (DSA: Hashing)"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def get_unique_filename(filename):
    """Generate a unique filename to prevent overwriting"""
    name, ext = os.path.splitext(filename)
    return f"{name}_{uuid.uuid4().hex[:8]}{ext}"

def add_message_to_cache(room_id, message):
    """Add message to room-specific cache (DSA: Queue)"""
    if room_id not in message_cache:
        message_cache[room_id] = deque(maxlen=max_cache_size)
    message_cache[room_id].append(message)

def get_cached_messages(room_id, limit=50):
    """Get recent messages from cache"""
    if room_id in message_cache:
        messages = list(message_cache[room_id])
        return messages[-limit:] if len(messages) > limit else messages
    return []

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(user_id)

# Routes for authentication
@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
        
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)
            next_page = request.args.get('next')
            return redirect(next_page or url_for('index'))
        flash('Invalid username or password')
    
    return render_template('login.html')

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
        
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        
        if User.query.filter_by(username=username).first():
            flash('Username already exists')
            return render_template('signup.html')
            
        if User.query.filter_by(email=email).first():
            flash('Email already registered')
            return render_template('signup.html')
        
        user = User(username=username, email=email)
        user.set_password(password)
        
        # Make first user an admin
        if User.query.count() == 0:
            user.is_admin = True
            
        db.session.add(user)
        db.session.commit()
        
        flash('Account created successfully! Please log in.')
        return redirect(url_for('login'))
    
    return render_template('signup.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

# Main routes
@app.route('/')
@login_required
def index():
    return render_template('index.html')

# API routes
@app.route('/api/rooms', methods=['GET'])
@login_required
def get_rooms():
    public_rooms = Room.query.filter_by(is_private=False).all()
    return jsonify([room.to_dict() for room in public_rooms])

@app.route('/api/rooms', methods=['POST'])
@login_required
def create_room():
    data = request.json
    room_name = data.get('room_name')
    is_private = data.get('is_private', False)
    
    if not room_name:
        return jsonify({"error": "Room name is required"}), 400
    
    if Room.query.filter_by(name=room_name).first():
        return jsonify({"error": "Room already exists"}), 409
    
    room = Room(name=room_name, is_private=is_private, created_by=current_user.id)
    db.session.add(room)
    db.session.commit()
    
    # Add room to tree structure (DSA: Tree)
    new_room_node = RoomNode(room_name)
    room_tree.add_child(new_room_node)
    
    return jsonify({"message": f"Room {room_name} created successfully", "room_id": room.id}), 201

@app.route('/api/users', methods=['GET'])
@login_required
def get_users():
    users = User.query.all()
    return jsonify([user.to_dict() for user in users])

@app.route('/api/messages/<room_id>', methods=['GET'])
@login_required
def get_messages(room_id):
    room = Room.query.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404
        
    # Check cache first (DSA: Cache optimization)
    cached_messages = get_cached_messages(room_id)
    if cached_messages:
        return jsonify(cached_messages)
    
    # If not in cache, fetch from database
    messages = Message.query.filter_by(room_id=room_id).order_by(Message.timestamp).limit(50).all()
    result = [message.to_dict() for message in messages]
    
    # Update cache
    for message in result:
        add_message_to_cache(room_id, message)
        
    return jsonify(result)

@app.route('/api/direct-messages/<user_id>', methods=['GET'])
@login_required
def get_direct_messages(user_id):
    # Get messages where current user is either sender or recipient
    sent = DirectMessage.query.filter_by(sender_id=current_user.id, recipient_id=user_id).all()
    received = DirectMessage.query.filter_by(sender_id=user_id, recipient_id=current_user.id).all()
    
    # Mark received messages as read
    for msg in received:
        if not msg.is_read:
            msg.is_read = True
    
    db.session.commit()
    
    # Combine and sort messages
    all_messages = sorted([*sent, *received], key=lambda x: x.timestamp)
    return jsonify([message.to_dict() for message in all_messages])

@app.route('/api/direct-messages/unread', methods=['GET'])
@login_required
def get_unread_count():
    # Count unread messages for current user
    unread_counts = {}
    unread_messages = DirectMessage.query.filter_by(recipient_id=current_user.id, is_read=False).all()
    
    for msg in unread_messages:
        sender_id = msg.sender_id
        if sender_id in unread_counts:
            unread_counts[sender_id] += 1
        else:
            unread_counts[sender_id] = 1
    
    return jsonify(unread_counts)

@app.route('/api/upload', methods=['POST'])
@login_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
        
    file = request.files['file']
    room_id = request.form.get('room_id')
    recipient_id = request.form.get('recipient_id')
    
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
        
    if not allowed_file(file.filename):
        return jsonify({"error": "File type not allowed"}), 400
    
    # Create secure filename and save file
    filename = secure_filename(file.filename)
    unique_filename = get_unique_filename(filename)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
    file.save(file_path)
    
    # Generate hash for file verification (DSA: Hashing)
    file_hash = get_hash_for_file(file_path)
    
    # Create message depending on destination
    if room_id:
        room = Room.query.get(room_id)
        if not room:
            return jsonify({"error": "Room not found"}), 404
            
        message = Message(
            content=f"Shared file: {filename}",
            is_file=True,
            file_path=unique_filename,
            user_id=current_user.id,
            room_id=room_id
        )
        db.session.add(message)
        db.session.commit()
        
        # Emit socket event for real-time updates
        socketio.emit('message', message.to_dict(), room=room_id)
        
    elif recipient_id:
        recipient = User.query.get(recipient_id)
        if not recipient:
            return jsonify({"error": "Recipient not found"}), 404
            
        dm = DirectMessage(
            content=f"Shared file: {filename}",
            is_file=True,
            file_path=unique_filename,
            sender_id=current_user.id,
            recipient_id=recipient_id
        )
        db.session.add(dm)
        db.session.commit()
        
        # Emit socket event for real-time updates
        socketio.emit('direct_message', dm.to_dict(), room=recipient_id)
    
    return jsonify({
        "message": "File uploaded successfully",
        "file_path": unique_filename,
        "file_hash": file_hash
    }), 201

@app.route('/uploads/<filename>')
@login_required
def get_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# Admin routes
@app.route('/admin')
@login_required
def admin_panel():
    if not current_user.is_admin:
        flash('Access denied. Admin privileges required.')
        return redirect(url_for('index'))
        
    return render_template('admin.html')

@app.route('/api/admin/users', methods=['GET'])
@login_required
def admin_get_users():
    if not current_user.is_admin:
        return jsonify({"error": "Admin privileges required"}), 403
        
    users = User.query.all()
    return jsonify([user.to_dict() for user in users])

@app.route('/api/admin/users/<user_id>', methods=['PUT'])
@login_required
def admin_update_user(user_id):
    if not current_user.is_admin:
        return jsonify({"error": "Admin privileges required"}), 403
        
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
        
    data = request.json
    if 'username' in data:
        user.username = data['username']
    if 'email' in data:
        user.email = data['email']
    if 'is_admin' in data:
        user.is_admin = data['is_admin']
    if 'password' in data and data['password']:
        user.set_password(data['password'])
        
    db.session.commit()
    return jsonify({"message": "User updated successfully"})

@app.route('/api/admin/users/<user_id>', methods=['DELETE'])
@login_required
def admin_delete_user(user_id):
    if not current_user.is_admin:
        return jsonify({"error": "Admin privileges required"}), 403
        
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
        
    # Don't allow deleting yourself
    if user.id == current_user.id:
        return jsonify({"error": "Cannot delete your own account"}), 400
        
    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "User deleted successfully"})

@app.route('/api/admin/rooms', methods=['GET'])
@login_required
def admin_get_rooms():
    if not current_user.is_admin:
        return jsonify({"error": "Admin privileges required"}), 403
        
    rooms = Room.query.all()
    return jsonify([room.to_dict() for room in rooms])

@app.route('/api/admin/rooms/<room_id>', methods=['DELETE'])
@login_required
def admin_delete_room(room_id):
    if not current_user.is_admin:
        return jsonify({"error": "Admin privileges required"}), 403
        
    room = Room.query.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404
        
    # Delete all messages in the room
    Message.query.filter_by(room_id=room_id).delete()
    
    # Remove from cache
    if room_id in message_cache:
        del message_cache[room_id]
        
    db.session.delete(room)
    db.session.commit()
    return jsonify({"message": "Room deleted successfully"})
@app.route('/api/admin/messages', methods=['GET'])
@login_required
def admin_get_messages():
    if not current_user.is_admin:
        return jsonify({"error": "Admin privileges required"}), 403
        
    # Get messages with pagination
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    room_id = request.args.get('room_id')
    user_id = request.args.get('user_id')
    
    query = Message.query
    
    # Apply filters if provided
    if room_id:
        query = query.filter_by(room_id=room_id)
    if user_id:
        query = query.filter_by(user_id=user_id)
    
    # Order by timestamp descending (newest first)
    messages = query.order_by(Message.timestamp.desc()).paginate(page=page, per_page=per_page)
    
    result = {
        "messages": [message.to_dict() for message in messages.items],
        "total": messages.total,
        "pages": messages.pages,
        "current_page": page
    }
    
    return jsonify(result)

@app.route('/api/admin/files', methods=['GET'])
@login_required
def admin_get_files():
    if not current_user.is_admin:
        return jsonify({"error": "Admin privileges required"}), 403
        
    # Get files with pagination
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    
    # Query all messages and direct messages that contain files
    file_messages = Message.query.filter_by(is_file=True)
    file_dms = DirectMessage.query.filter_by(is_file=True)
    
    # Combine and paginate results
    # This is a simplified approach - for production you might want to use SQL UNION
    all_files = []
    
    for msg in file_messages.all():
        all_files.append({
            "id": msg.id,
            "type": "room_message",
            "filename": msg.file_path,
            "original_name": msg.content.replace("Shared file: ", ""),
            "timestamp": msg.timestamp,
            "user": msg.author.username,
            "room": msg.room.name if msg.room else None
        })
    
    for dm in file_dms.all():
        all_files.append({
            "id": dm.id,
            "type": "direct_message",
            "filename": dm.file_path,
            "original_name": dm.content.replace("Shared file: ", ""),
            "timestamp": dm.timestamp,
            "sender": dm.sender.username,
            "recipient": dm.recipient.username
        })
    
    # Sort by timestamp (newest first)
    all_files.sort(key=lambda x: x["timestamp"], reverse=True)
    
    # Manual pagination
    total = len(all_files)
    total_pages = (total + per_page - 1) // per_page
    start = (page - 1) * per_page
    end = min(start + per_page, total)
    
    result = {
        "files": all_files[start:end],
        "total": total,
        "pages": total_pages,
        "current_page": page
    }
    
    return jsonify(result)

@app.route('/api/admin/messages/<message_id>', methods=['DELETE'])
@login_required
def admin_delete_message(message_id):
    if not current_user.is_admin:
        return jsonify({"error": "Admin privileges required"}), 403
        
    message = Message.query.get(message_id)
    if not message:
        return jsonify({"error": "Message not found"}), 404
    
    # If it's a file message, delete the file too
    if message.is_file and message.file_path:
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], message.file_path)
        if os.path.exists(file_path):
            os.remove(file_path)
    
    # Remove from cache if present
    if message.room_id in message_cache:
        # Create a new cache without the deleted message
        message_cache[message.room_id] = deque(
            [m for m in message_cache[message.room_id] if m.get('id') != message_id],
            maxlen=max_cache_size
        )
    
    db.session.delete(message)
    db.session.commit()
    
    return jsonify({"message": "Message deleted successfully"})

@app.route('/api/admin/files/<file_id>', methods=['DELETE'])
@login_required
def admin_delete_file(file_id):
    if not current_user.is_admin:
        return jsonify({"error": "Admin privileges required"}), 403
    
    # Check if it's a message file
    message = Message.query.filter_by(id=file_id, is_file=True).first()
    
    if message:
        # Delete the physical file
        if message.file_path:
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], message.file_path)
            if os.path.exists(file_path):
                os.remove(file_path)
        
        # Delete the message
        db.session.delete(message)
        db.session.commit()
        
        return jsonify({"message": "File deleted successfully"})
    
    # Check if it's a direct message file
    dm = DirectMessage.query.filter_by(id=file_id, is_file=True).first()
    
    if dm:
        # Delete the physical file
        if dm.file_path:
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], dm.file_path)
            if os.path.exists(file_path):
                os.remove(file_path)
        
        # Delete the direct message
        db.session.delete(dm)
        db.session.commit()
        
        return jsonify({"message": "File deleted successfully"})
    
    return jsonify({"error": "File not found"}), 404

# Socket.IO event handlers
@socketio.on('connect')
def handle_connect():
    if not current_user.is_authenticated:
        return False
    
    user_id = current_user.id
    user_sessions[request.sid] = user_id
    
    # Associate socket with user's personal room for private messages
    join_room(user_id)
    emit('connected', {'user_id': user_id})

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    if sid in user_sessions:
        user_id = user_sessions[sid]
        room_id = session.get('current_room')
        
        if room_id:
            # Find room node in tree (DSA: Tree traversal)
            def find_room_node(node, room_name):
                if node.name == room_name:
                    return node
                for child in node.children:
                    result = find_room_node(child, room_name)
                    if result:
                        return result
                return None
                
            room = Room.query.get(room_id)
            if room:
                room_node = find_room_node(room_tree, room.name)
                if room_node:
                    room_node.remove_user(user_id)
                    
                leave_room(room_id)
                
                # Notify others in room
                system_message = {
                    'username': 'System',
                    'content': f"{current_user.username} has left the room.",
                    'timestamp': datetime.now().strftime("%H:%M:%S")
                }
                emit('message', system_message, room=room_id)
        
        # Remove from session tracking
        del user_sessions[sid]

@socketio.on('join')
def on_join(data):
    room_id = data['room_id']
    room = Room.query.get(room_id)
    
    if not room:
        emit('error', {'message': 'Room not found'})
        return
    
    # Store current room in session
    session['current_room'] = room_id
    
    # Join socket.io room
    join_room(room_id)
    
    # Update room tree (DSA: Tree)
    def find_or_create_room_node(node, room_name):
        for child in node.children:
            if child.name == room_name:
                return child
        
        # Room not found in tree, create it
        new_node = RoomNode(room_name, parent=node)
        node.add_child(new_node)
        return new_node
    
    room_node = find_or_create_room_node(room_tree, room.name)
    room_node.add_user(current_user.id)
    
    # Send chat history from cache if available
    cached_messages = get_cached_messages(room_id)
    if cached_messages:
        emit('chat_history', {'messages': cached_messages})
    else:
        # Fetch from database if not in cache
        messages = Message.query.filter_by(room_id=room_id).order_by(Message.timestamp).limit(50).all()
        message_list = [message.to_dict() for message in messages]
        
        # Update cache
        for message in message_list:
            add_message_to_cache(room_id, message)
            
        emit('chat_history', {'messages': message_list})
    
    # Notify room about new user
    system_message = Message(
        content=f"{current_user.username} has joined the room.",
        user_id=current_user.id,
        room_id=room_id
    )
    db.session.add(system_message)
    db.session.commit()
    
    emit('message', system_message.to_dict(), room=room_id)

@socketio.on('leave')
def on_leave():
    room_id = session.get('current_room')
    if not room_id:
        return
    
    room = Room.query.get(room_id)
    if not room:
        return
    
    # Update room tree (DSA: Tree)
    def find_room_node(node, room_name):
        if node.name == room_name:
            return node
        for child in node.children:
            result = find_room_node(child, room_name)
            if result:
                return result
        return None
    
    room_node = find_room_node(room_tree, room.name)
    if room_node:
        room_node.remove_user(current_user.id)
    
    # Leave socket.io room
    leave_room(room_id)
    
    # Clear current room from session
    session.pop('current_room', None)
    
    # Notify room
    system_message = Message(
        content=f"{current_user.username} has left the room.",
        user_id=current_user.id,
        room_id=room_id
    )
    db.session.add(system_message)
    db.session.commit()
    
    emit('message', system_message.to_dict(), room=room_id)

@socketio.on('message')
def handle_message(data):
    room_id = session.get('current_room')
    if not room_id:
        emit('error', {'message': 'Not in a room'})
        return
    
    text = data.get('text')
    if not text:
        return
    
    message = Message(
        content=text,
        user_id=current_user.id,
        room_id=room_id
    )
    db.session.add(message)
    db.session.commit()
    
    message_dict = message.to_dict()
    
    # Add to cache (DSA: Queue)
    add_message_to_cache(room_id, message_dict)
    
    emit('message', message_dict, room=room_id)

@socketio.on('direct_message')
def handle_direct_message(data):
    recipient_id = data.get('recipient_id')
    text = data.get('text')
    
    if not recipient_id or not text:
        emit('error', {'message': 'Missing required data'})
        return
    
    recipient = User.query.get(recipient_id)
    if not recipient:
        emit('error', {'message': 'Recipient not found'})
        return
    
    # Create direct message
    dm = DirectMessage(
        content=text,
        sender_id=current_user.id,
        recipient_id=recipient_id
    )
    db.session.add(dm)
    db.session.commit()
    
    dm_dict = dm.to_dict()
    
    # Send to recipient
    emit('direct_message', dm_dict, room=recipient_id)
    
    # Send back to sender
    emit('direct_message', dm_dict)

# Database initialization
with app.app_context():
    db.create_all()
    
    # Create default admin if none exists
    if not User.query.filter_by(is_admin=True).first():
        admin = User(
            username="admin",
            email="admin@example.com",
            is_admin=True
        )
        admin.set_password("admin123")  # Change this in production!
        db.session.add(admin)
        
        # Create default room
        general_room = Room(
            name="General",
            is_private=False,
            created_by=admin.id
        )
        db.session.add(general_room)
        db.session.commit()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)