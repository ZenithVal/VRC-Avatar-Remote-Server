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
		this.socketCounter = true;

		this.config = config

		//Sounds
		this.soundsEnabled = false
		this.soundvolume = 0.5;
		this.connectSound = null; 
		this.disconnectSound = null;

	}

	_addSocket(socket, socketCounter) {
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

		console.log(`Added socket ${socket.id} for board ${board.id}`);

		if (this.soundsEnabled && this.connectSound != null) {
			sound.play(this.connectSound,this.soundvolume);
		}

		if (socketCounter) {
			this._usersConnected = this._usersConnected + 1;
			console.log(`\x1b[32m${this._usersConnected} users connected \x1b[0m`);
		}

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

	_removeSocket(socket, socketCounter) {
		delete this._sockets[socket.id];

		if (this.soundsEnabled && this.disconnectSound != null) {
			sound.play(this.disconnectSound,this.soundvolume);
		}
	
		console.log(`Removed socket ${socket.id}`);

		if (socketCounter) {
			this._usersConnected = this._usersConnected - 1;
			console.log(`\x1b[33m${this._usersConnected} users connected \x1b[0m`);
		}

		
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

		this.socketCounter = this.config.getKey("consoleLogs","socketCounter");

		this._io.on("connection", socket => {
			this._addSocket(socket,this.socketCounter);

			socket.on("disconnect", () => {
				this._removeSocket(socket,this.socketCounter);
			});
		});

		this.soundsEnabled = this.config.getKey("sounds", "enabled")
		if (this.soundsEnabled) //Check if sounds are enabled
		{
			this.soundvolume = parseFloat(this.config.getKey("sounds", "volume"))
			this.connectSound = this.config.getKey("sounds", "connectPath");
			this.disconnectSound = this.config.getKey("sounds", "disconnectPath");

			console.log (`Sounds enabled: \n\tVolume set to ${this.soundvolume*100}%`)
			if (this.connectSound != null) {
				console.log(`\tConnect Sound: ${this.connectSound}`)
			}

			if (this.disconnectSound != null) {
				console.log(`\tDisconnect Sound: ${this.disconnectSound}\n`)
			}

		} else {
			console.log (`Sounds disabled\n`)
		}

	}

	boardUpdate(board_id) {
		this._io.to(`board::${board_id}`).emit("board-update");
	}
}

module.exports = { SocketManager };