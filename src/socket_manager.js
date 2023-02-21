const { Server } = require("socket.io");

const { VrcAvatarManager } = require("./vrc_avatar_manager");
const { BoardManager } = require("./board_manager");

const sound = require("sound-play")

class SocketManager {
	/**
	 * 
	 * @param {Server} io 
	 * @param {BoardManager} boardManager
	 * @param {VrcAvatarManager} avatarManager 
	 */
	constructor(io, boardManager, avatarManager, config) {
		this._io = io;
		this._boardManager = boardManager;
		this._avatarManager = avatarManager;
		this._usersConnected = 0;

		this._sockets = {};

		this.config = config
		this.connectSound = null; //Sound stuff
		this.disconnectSound = null;
	}

	_addSocket(socket) {
		let board;
		try {
			board = this._boardManager.getBoard(socket.data.boardId);
		} catch(err) {
			console.log(`Adding socket failed for board ${socket.data.boardId}: `, err);
			socket.disconnect(true);
			return;
		}

		this._sockets[socket.id] = {
			socket,
			board,
			params: []
		};

		console.log(`Add socket ${socket.id} for board ${board.id}`);
		this._usersConnected = this._usersConnected + 1;
		if (this.connectSound != null) sound.play(this.connectSound);

		console.log(`${this._usersConnected} users connected`);

		socket.join(`board::${board.id}`); // join room for board update notifications

		// put the socket in all the correct rooms
		for (let p of board.getAllParametersOfAllAvatars()) {
			const key = `parameter::${p.avatar}::${p.parameter}`;
			socket.join(key); // join the parameters room
		}

		// msg = { avatar, controlId, value }
		socket.on("set-parameter", (msg, callback) => {
			if (msg == undefined || typeof msg !== "object" || !("avatar" in msg && "controlId" in msg && "value" in msg)) {
				return callback({ success: false, error: "Invalid data" });
			}

			const avatar = this._boardManager.resolveHashedAvatarId(msg.avatar);
			if (avatar == null) {
				return callback({ success: false, error: "Unknown avatar id" });
			}

			if (!board.hasControl(avatar, msg.controlId)) {
				return callback({ success: false, error: "Control doesn't exist" });
			}

			if (avatar != this._avatarManager.getCurrentAvatarId()) {
				return callback({ success: false, error: "This avatar is not currently active" });
			}

			const paramController = board.getControl(avatar, msg.controlId);
			paramController.setValue(this._avatarManager, msg.value).then(() => {
				callback({ success: true });
			}, err => {
				callback({ success: false, error: err.message });
			});
		});

		// msg = { avatar, controlId }
		socket.on("perform-action", (msg, callback) => {
			if (msg == undefined || typeof msg !== "object" || !("avatar" in msg && "controlId" in msg)) {
				return callback({ success: false, error: "Invalid data" });
			}

			const avatar = this._boardManager.resolveHashedAvatarId(msg.avatar);
			if (avatar == null) {
				return callback({ success: false, error: "Unknown avatar id" });
			}

			if (!board.hasControl(avatar, msg.controlId)) {
				return callback({ success: false, error: "Parameter doesn't exist" });
			}

			const paramController = board.getControl(avatar, msg.controlId);
			paramController.performAction(this._avatarManager).then(() => {
				callback({ success: true });
			}, err => {
				callback({ success: false, error: err.message });
			});
		});

		// emit an initial avatar event if neccessary
		const currentAvatar = this._avatarManager.getCurrentAvatarId();
		if (board.hasAvatar(currentAvatar)) {
			socket.emit("avatar", { id: this._avatarManager.hashAvatarId(currentAvatar) });

			for (let p of board.getParametersForAvatar(currentAvatar)) {
				socket.emit("parameter", {
					name: p.parameter,
					avatar: p.avatar,
					value: this._avatarManager.getParameter(p.parameter),
				});
			}
		}
	}

	_removeSocket(socket) {
		delete this._sockets[socket.id];
		console.log(`Removed socket ${socket.id}`);
		this._usersConnected = this._usersConnected - 1;
		if (this.disconnectSound != null) sound.play(this.disconnectSound);

		console.log(`${this._usersConnected} users connected`);
	}

	init() {
		// evt = { name, value, avatar }
		this._avatarManager.on("parameter", evt => {
			const key = `parameter::${evt.avatar}::${evt.name}`;
			
			evt.avatar = this._avatarManager.hashAvatarId(evt.avatar);
			this._io.to(key).emit("parameter", evt);
		});

		// evt = { id }
		this._avatarManager.on("avatar", evt => {
			for (let socketId in this._sockets) {
				if (this._sockets[socketId].board.hasAvatar(evt.id)) {
					evt.id = this._avatarManager.hashAvatarId(evt.id);
					this._sockets[socketId].socket.emit("avatar", evt);
				} else {
					this._sockets[socketId].socket.emit("avatar", null); // tell this socket that we are now in an unknown avatar
				}
			}
		});

		this._io.on("connection", socket => {
			this._addSocket(socket);

			socket.on("disconnect", () => {
				this._removeSocket(socket);
			});
		});

		this.connectSound = this.config.getKey("sounds", "connectPath");
		this.disconnectSound = this.config.getKey("sounds", "disconnectPath");

	}

	boardUpdate(board_id) {
		this._io.to(`board::${board_id}`).emit("board-update");
	}
}

module.exports = { SocketManager };